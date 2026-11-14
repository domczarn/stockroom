import assert from 'node:assert/strict';
import app from '../dist/server/app.js';
import {environment,serviceHeaders} from './support.mjs';

const env=environment();
const origin='https://stockroom.bookednpaid.com';
const scope='https://www.googleapis.com/auth/gmail.readonly';
const users={alice:'alice@example.test',bob:'bob@example.test'};
function call(path,who,method='GET',body,headers={}){
  return app.fetch(new Request(origin+path,{method,headers:{
    ...headers,...(who?{'oai-authenticated-user-id':who,'oai-authenticated-user-email':users[who]}:{}),
    ...(body?{'content-type':'application/json'}:{})
  },...(body?{body:JSON.stringify(body)}:{})}),env);
}
assert.equal((await call('/api/gmail')).status,401);
assert.equal((await call('/api/gmail',null,'GET',null,serviceHeaders())).status,401);
assert.equal((await (await call('/api/gmail','alice')).json()).available,false);
assert.equal((await call('/api/gmail/connect','alice','POST')).status,503);

env.GOOGLE_GMAIL_CLIENT_ID='fixture-client';
env.GOOGLE_GMAIL_CLIENT_SECRET='fixture-secret';
const id='abcdef1234567';
const fake='abcdef1234568';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
  const url=new URL(input);
  assert.equal(options.redirect,'error');
  if(url.hostname==='oauth2.googleapis.com'){
    assert.equal(options.body.get('client_secret'),'fixture-secret');
    if(options.body.get('grant_type')==='authorization_code'){
      assert.ok(options.body.get('code_verifier').length>=43);
      return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',scope});
    }
    assert.equal(options.body.get('refresh_token'),'fixture-refresh');
    return Response.json({access_token:'fixture-access'});
  }
  assert.equal(url.hostname,'gmail.googleapis.com');
  assert.equal(options.headers.Authorization,'Bearer fixture-access');
  if(url.pathname.endsWith('/profile'))return Response.json({emailAddress:'vinted-inbox@example.test'});
  if(url.pathname.endsWith('/messages')){
    assert.equal(url.searchParams.get('q'),'from:no-reply@vinted.co.uk newer_than:7d');
    return Response.json({messages:[{id},{id:fake}]});
  }
  assert.equal(url.searchParams.get('format'),'metadata');
  assert.deepEqual(url.searchParams.getAll('metadataHeaders'),['From','Subject','Authentication-Results']);
  const genuine=url.pathname.endsWith(id);
  return Response.json({id:genuine?id:fake,internalDate:String(Date.now()),payload:{headers:[
    {name:'From',value:'Vinted <no-reply@vinted.co.uk>'},
    {name:'Subject',value:'Your order has been delivered'},
    {name:'Authentication-Results',value:'mx.google.com; dmarc='+(genuine?'pass':'fail')+' header.from=vinted.co.uk'}
  ]}});
};
try{
  const start=await (await call('/api/gmail/connect','alice','POST')).json();
  const url=new URL(start.authorizeUrl);
  assert.equal(url.origin,'https://accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'),origin+'/api/gmail/callback');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('scope'),scope);
  const path='/api/gmail/callback?state='+url.searchParams.get('state')+'&code=fixture';
  assert.equal((await call(path,'bob')).headers.get('location'),'/?gmail=expired');
  assert.equal((await call(path,'alice')).headers.get('location'),'/?gmail=connected');
  assert.equal((await call(path,'alice')).headers.get('location'),'/?gmail=expired');
  const row=env.sql.prepare('SELECT token FROM gmail_connections WHERE owner_id=?').get('alice');
  assert.ok(row.token&&!row.token.includes('fixture-refresh'));
  const checked=await (await call('/api/gmail/check','alice','POST')).json();
  assert.equal(checked.added,1);
  assert.equal(checked.connection.mailbox,'vinted-inbox@example.test');
  assert.equal(checked.connection.receipts[0].category,'Delivery');
  assert.equal(checked.connection.receipts.length,1);
  assert.ok(!JSON.stringify(checked).includes('fixture-refresh'));
  assert.equal((await (await call('/api/gmail','bob')).json()).connection,null);
  assert.equal((await call('/api/gmail/review','bob','PUT',{id,reviewed:true})).status,409);
  const review=await (await call('/api/gmail/review','alice','PUT',{id,reviewed:true})).json();
  assert.equal(review.connection.receipts[0].reviewed,true);
  const pause=await (await call('/api/gmail','alice','PUT',{enabled:false,alerts:true,days:3})).json();
  assert.equal(pause.connection.enabled,false);
  assert.equal(pause.connection.days,3);
  assert.equal((await call('/api/gmail/check','alice','POST')).status,409);
  assert.equal((await (await call('/api/gmail','alice','DELETE')).json()).connection,null);
  assert.equal(env.sql.prepare('SELECT COUNT(*) AS count FROM gmail_connections').get().count,0);
}finally{globalThis.fetch=originalFetch;}
