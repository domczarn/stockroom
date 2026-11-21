import assert from 'node:assert/strict';
import {environment,serviceHeaders} from './support.mjs';
import app from '../dist/server/app.js';
const env=environment();
const users={admin:['owner-test','dom.czr11@gmail.com'],a:['member-a','a@example.com'],b:['member-b','b@example.com'],spoof:['different-id','a@example.com']};
async function call(path,who,method='GET',body,headers={}){
 const h={...headers};if(who){h['oai-authenticated-user-id']=users[who][0];h['oai-authenticated-user-email']=users[who][1];}if(body!==undefined)h['content-type']='application/json';
 const response=await app.fetch(new Request('https://test.local'+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),env);let data;try{data=await response.clone().json();}catch{data=null;}return {status:response.status,data,response};
}
const empty=()=>({items:[],sales:[],expenses:[],research:[],sources:[]});
assert.equal((await call('/api/me')).status,401);
// Identity-bearing requests represent viewers already admitted by the private Sites edge.
assert.equal((await call('/api/me','a')).status,200);
assert.equal((await call('/api/workspace','a')).data.data,null);
assert.equal((await call('/api/me','a')).data.user.role,'member');
assert.equal((await call('/api/me','spoof')).status,403);
assert.equal((await call('/api/me','b')).status,200);
assert.equal((await call('/api/admin/members','a')).status,403);
assert.equal((await call('/seed.json','a')).status,403);
assert.deepEqual((await call('/api/purchases','a')).data,{purchases:[]});
assert.equal((await call('/api/notification-reads','a','PUT',{keys:['friend:test']})).status,200);
assert.deepEqual((await call('/api/notification-reads','a')).data.keys,['friend:test']);
assert.deepEqual((await call('/api/notification-reads','b')).data.keys,[]);
assert.equal((await call('/api/notification-reads')).status,401);
const data=empty();data.items.push({id:'item1',name:'Test',brand:'Test',cost:10,price:25,status:'In Stock',photos:[],purchasedAt:'2026-11-04'});
const saved=await call('/api/workspace','a','PUT',{data,revision:null});assert.equal(saved.status,200);
assert.equal((await call('/api/workspace','a')).data.data.items.length,1);
assert.equal((await call('/api/workspace','b')).data.data,null);
assert.equal((await call('/api/workspace?owner=member-a','b')).status,403);
assert.equal((await call('/api/workspace?owner=member-a','admin')).data.data.items[0].cost,10);
assert.equal((await call('/api/workspace?owner=member-a','admin','PUT',{data,revision:saved.data.revision})).status,403);
assert.equal((await call('/api/workspace','a','PUT',{data,revision:null})).status,409);
assert.equal((await call('/api/workspace','a','PUT',{data,revision:saved.data.revision},{origin:'https://evil.example'})).status,403);
const malicious=structuredClone(data);malicious.items[0].photos=['/api/media/member-b/00000000-0000-0000-0000-000000000000'];
assert.equal((await call('/api/workspace','a','PUT',{data:malicious,revision:saved.data.revision})).status,400);
malicious.items[0].photos=[];malicious.research=[['Test','<img src=x onerror=alert(1)>',1,2,3,4]];
assert.equal((await call('/api/workspace','a','PUT',{data:malicious,revision:saved.data.revision})).status,400);
const image=structuredClone(data);image.items[0].photos=['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='];
const withPhoto=await call('/api/workspace','a','PUT',{data:image,revision:saved.data.revision});assert.equal(withPhoto.status,200);
const photo=withPhoto.data.data.items[0].photos[0];assert.match(photo,/^\/api\/media\/member-a\//);
assert.equal((await call(photo,'a')).status,200);assert.equal((await call(photo,'b')).status,403);assert.equal((await call(photo,'admin')).status,200);assert.equal((await call(photo)).status,401);
// Two devices reading the same revision: exactly one write wins.
const writes=await Promise.all([call('/api/workspace','a','PUT',{data:withPhoto.data.data,revision:withPhoto.data.revision}),call('/api/workspace','a','PUT',{data:withPhoto.data.data,revision:withPhoto.data.revision})]);assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
await call('/api/admin/members','admin','POST',{email:'a@example.com',status:'suspended'});
assert.equal((await call('/api/workspace','a')).status,403);assert.equal((await call(photo,'a')).status,403);
assert.equal((await call('/api/workspace?owner=member-a','admin')).status,200);
assert.ok((await call('/api/admin/audit','admin')).data.events.length>0);
for(let i=0;i<61;i++)await call('/api/admin/members','b','POST',{email:'nobody@example.com'});
assert.equal((await call('/api/workspace','b','PUT',{data:empty(),revision:null})).status,429);
assert.equal((await call('/pip-icon.png','admin')).response.headers.get('content-type'),'image/png');
console.log('Passed: account isolation, admin authorization, identity binding, suspension, protected photos, validation, CSRF, concurrent-save conflicts and write limits.');

for(const path of ['/api/purchases','/api/sale-imports','/api/sync-status','/api/market-research']){
 const endpoint='https://stockroom.test'+path;
 for(const headers of [{},serviceHeaders(Math.floor(Date.now()/1000)-1)]){
  assert.equal((await app.fetch(new Request(endpoint,{headers}),env)).status,401);
 }
 assert.equal((await app.fetch(new Request(endpoint,{headers:serviceHeaders()}),env)).status,200);
}
assert.equal((await app.fetch(new Request('https://stockroom.test/api/admin/members',{headers:serviceHeaders()}),env)).status,401);
assert.match(await (await app.fetch(new Request('https://stockroom.test/'),env)).text(),/Sign in/);
