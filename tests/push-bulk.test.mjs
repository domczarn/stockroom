import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {environment,serviceHeaders} from './support.mjs';
import app from '../dist/server/app.js';

const env=environment();
const pending=[];
const context={waitUntil:work=>pending.push(work)};
const origin='https://stockroom.test';
const owner=['owner','dom.czr11@gmail.com'];
const visitor=['visitor','visitor@example.test'];
async function call(path,who=owner,method='GET',body){
  const headers=who?{'oai-authenticated-user-id':who[0],'oai-authenticated-user-email':who[1]}:{};
  if(body)Object.assign(headers,{'content-type':'application/json',origin});
  const res=await app.fetch(new Request(origin+path,{method,headers,body:body?JSON.stringify(body):undefined}),env,context);
  return {status:res.status,data:await res.json()};
}
assert.equal((await call('/api/push/config',null)).status,401);
const {data:config}=await call('/api/push/config');
assert.deepEqual(Object.keys(config),['publicKey']);
assert.equal(config.publicKey.length,87);
assert.equal((await call('/api/push/config')).data.publicKey,config.publicKey);
const receiver=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
const keys={p256dh:Buffer.from(await crypto.subtle.exportKey('raw',receiver.publicKey)).toString('base64url'),
  auth:Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url')};
const endpoint='https://web.push.apple.com/test-device';
assert.equal((await call('/api/push/device',owner,'PUT',{endpoint:'https://web.push.apple.com.untrusted.test/foo',keys})).status,400);
assert.equal((await call('/api/push/device',owner,'PUT',{endpoint,keys})).status,200);
await call('/api/admin/members',owner,'POST',{email:visitor[1]});
assert.equal((await call('/api/push/test',visitor,'POST',{endpoint})).status,404);
let delivered=0;
const fetchOriginal=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
  assert.equal(url,endpoint);
  assert.equal(init.redirect,'manual');
  assert.equal(init.headers['content-encoding'],'aes128gcm');
  assert.match(init.headers.authorization,/^vapid t=/);
  assert.ok(init.body.byteLength>100);
  delivered++;
  return new Response(null,{status:201});
};
try{
  assert.equal((await call('/api/push/test',owner,'POST',{endpoint})).status,200);
  assert.equal(delivered,1);
  await call('/api/profile',owner,'PUT',{username:'owner_test',shareRevenue:false});
  await call('/api/profile',visitor,'PUT',{username:'friend_test',shareRevenue:false});
  assert.equal((await call('/api/friends',visitor,'POST',{username:'owner_test'})).status,200);
  await Promise.all(pending.splice(0));
  const id=(await call('/api/friends',owner)).data.friends[0].id;
  assert.equal((await call('/api/push/test',owner,'POST',{endpoint,chat:'invalid'})).status,400);
  assert.equal((await call('/api/push/test',owner,'POST',{endpoint,chat:id})).status,404);
  assert.equal((await call('/api/friends/'+id,owner,'PUT',{action:'accept'})).status,200);
  assert.equal((await call('/api/push/test',owner,'POST',{endpoint,chat:'a'.repeat(64)})).status,404);
  assert.equal((await call('/api/push/test',owner,'POST',{endpoint,chat:id})).status,200);
  assert.equal(env.sql.prepare('SELECT count(*) AS n FROM messages').get().n,0);
  const message={id:crypto.randomUUID(),message:'Synthetic test message'};
  await call('/api/friends/'+id+'/messages',visitor,'POST',message);
  await call('/api/friends/'+id+'/messages',visitor,'POST',message);
  await Promise.all(pending.splice(0));
  assert.equal(delivered,4);
  assert.equal((await call('/api/sync-status',visitor)).status,403);
  assert.equal((await call('/api/sync-status',owner,'POST',{state:'connected',mailbox:'example@test.local'})).status,403);
  const sourceHeaders={'content-type':'application/json',...serviceHeaders()};
  const write=async(path,body)=>{
    const response=await app.fetch(new Request(origin+path,{method:'POST',headers:sourceHeaders,body:JSON.stringify(body)}),env,context);
    return {status:response.status,data:await response.json()};
  };
  assert.equal((await write('/api/sync-status',{state:'connected',mailbox:'receipts@example.test'})).data.email.state,'connected');
  assert.equal((await call('/api/sync-status',owner,'PUT',{enabled:false})).data.email.enabled,false);
  const receipt={transactionId:'123456789',receiptId:'test-verified',name:'Test shirt',stage:'sold',date:'2026-11-05',amount:19};
  assert.equal((await write('/api/sale-imports',{events:[receipt]})).status,409);
  await call('/api/sync-status',owner,'PUT',{enabled:true});
  assert.equal((await write('/api/sale-imports',{events:[receipt]})).status,200);
  assert.equal((await write('/api/sale-imports',{events:[receipt]})).status,200);
  const purchase={transactionId:'987654321',name:'Test jumper',brand:'Test brand',cost:9,purchasedAt:'2026-11-05',imageUrls:[]};
  assert.equal((await write('/api/purchases',{purchases:[purchase]})).status,200);
  assert.equal((await write('/api/purchases',{purchases:[purchase]})).status,200);
  await Promise.all(pending.splice(0));
  assert.equal(delivered,6);

}finally{globalThis.fetch=fetchOriginal;}
assert.equal((await call('/api/push/device',visitor,'DELETE',{endpoint})).status,200);
assert.equal(env.sql.prepare('SELECT count(*) AS n FROM push_devices').get().n,1);
await call('/api/push/device',owner,'DELETE',{endpoint});
assert.equal(env.sql.prepare('SELECT count(*) AS n FROM push_devices').get().n,0);

const listeners={};
const opened=[];
const posted=[];
const displayed=[];
let openClient=null;
const self={
  addEventListener(name,handler){listeners[name]=handler;},
  registration:{showNotification(title,data){displayed.push(data);}},
  clients:{matchAll:async()=>openClient?[openClient]:[],openWindow:async path=>opened.push(path)},
  location:{origin}
};
vm.runInNewContext(readFileSync('web/stockroom-sw.js','utf8'),{self,URL});
async function workerEvent(type,fields){
  let work;
  listeners[type]({...fields,waitUntil(promise){work=promise;}});
  await work;
}
const chat='b'.repeat(64);
await workerEvent('push',{data:{json:()=>({body:'Test push',tab:'Profile',tag:'stockroom-testmessage-'+chat,chat})}});
assert.equal(displayed[0].data.chat,chat);
assert.equal(displayed[0].tag,'stockroom-testmessage-'+chat);
const notification={...displayed[0],close(){}};
await workerEvent('notificationclick',{notification});
assert.equal(opened[0],'/?open=Profile&chat='+chat);
openClient={url:origin+'/',async focus(){return this;},postMessage:message=>posted.push(message)};
await workerEvent('notificationclick',{notification});
assert.equal(posted[0].type,'stockroom-notification');
assert.equal(posted[0].chat,chat);
openClient.focus=async()=>{throw Error('Window no longer available');};
await workerEvent('notificationclick',{notification});
assert.deepEqual(opened,['/?open=Profile&chat='+chat,'/?open=Profile&chat='+chat]);

const box=vm.createContext({cents:n=>Math.round(n*100),proceeds:item=>item.sale,profit:item=>item.sale-item.cost});
vm.runInContext(readFileSync('web/bulk.js','utf8')+'\nthis.totals=selectionTotals;',box);
const result=box.totals([{id:'a',status:'In Stock',cost:15.50,price:25},{id:'b',status:'In Stock',cost:5.99,price:null},
  {id:'c',status:'Sold',cost:8,sale:13},{id:'d',status:'Refund pending',cost:10}],[['Postage',1.22,null,null,null,null,'a']]);
assert.equal(result.cost,3949);
assert.equal(result.projectedPrice,2500);
assert.equal(result.projectedProfit,828);
assert.equal(result.actualProceeds,1300);
assert.equal(result.realisedProfit,500);
assert.equal(result.unpriced,1);
assert.equal(result.pending,1);
console.log('Passed: encrypted push delivery, account device isolation, replay protection and mixed-stock bulk totals.');
