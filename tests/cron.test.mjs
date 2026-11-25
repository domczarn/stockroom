import assert from 'node:assert/strict';
import {pickDue,DUE_MS} from '../worker/gmail.js';

const now=Date.parse('2026-11-26T12:00:00Z');
const ago=ms=>new Date(now-ms).toISOString();
// Nothing due: nobody is checked.
assert.equal(pickDue([{owner_id:'a',pro:1,checked_at:ago(60000),lease:0},{owner_id:'b',pro:0,checked_at:ago(5*60000),lease:0}],now),null);
// Never-checked mailboxes go first.
assert.equal(pickDue([{owner_id:'a',pro:1,checked_at:ago(DUE_MS.pro+1),lease:0},{owner_id:'new',pro:0,checked_at:null,lease:0}],now).owner_id,'new');
// A due Pro mailbox beats a due free one that is only slightly later.
assert.equal(pickDue([{owner_id:'free',pro:0,checked_at:ago(DUE_MS.free+60000),lease:0},{owner_id:'pro',pro:1,checked_at:ago(DUE_MS.pro+1000),lease:0}],now).owner_id,'pro');
// A mailbox mid-check (lease held) is skipped.
assert.equal(pickDue([{owner_id:'busy',pro:1,checked_at:null,lease:now+50000}],now),null);
// Free accounts are not starved: a long-overdue free mailbox wins over a just-due Pro one.
assert.equal(pickDue([{owner_id:'free',pro:0,checked_at:ago(DUE_MS.free+30*60000),lease:0},{owner_id:'pro',pro:1,checked_at:ago(DUE_MS.pro+1000),lease:0}],now).owner_id,'free');
console.log('cron ok');
import {capFreeSales,FREE_GMAIL_SALES} from '../worker/gmail.js';
{
  const sales=Array.from({length:FREE_GMAIL_SALES+3},(_,i)=>({id:'m'+i,receivedAt:'2026-11-'+String(1+i).padStart(2,'0')+'T10:00:00Z',event:{type:'sold',date:'2026-11-'+String(1+i).padStart(2,'0')}}));
  const label={id:'l',receivedAt:'2026-11-29T10:00:00Z',event:{type:'label'}};
  const free=capFreeSales([...sales,label],false);
  assert.equal(free.filter(r=>r.capped).length,3);
  assert.ok(!free.find(r=>r.id==='m0').capped&&free.find(r=>r.id==='m'+(FREE_GMAIL_SALES+2)).capped);
  assert.ok(!free.find(r=>r.id==='l').capped);
  // Next month starts fresh; Pro clears every mark.
  assert.equal(capFreeSales([{id:'d',receivedAt:'2026-12-01T09:00:00Z',event:{type:'sold',date:'2026-12-01'}},...free],false).filter(r=>r.capped).length,3);
  assert.equal(capFreeSales(free,true).filter(r=>r.capped).length,0);
  console.log('free gmail cap ok');
}
import {verifyGoogleJwt} from '../worker/gmail.js';
{
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'k1'};
  const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  const sign=async claims=>{const head=enc({alg:'RS256',kid:'k1'})+'.'+enc(claims);
    return head+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(head))).toString('base64url');};
  const env={GMAIL_PUSH_SERVICE_ACCOUNT:'push@proj.iam.gserviceaccount.com',GMAIL_PUSH_AUDIENCE:'https://x.test/hooks/gmail'};
  const now=Date.now(), good={iss:'https://accounts.google.com',aud:env.GMAIL_PUSH_AUDIENCE,email:env.GMAIL_PUSH_SERVICE_ACCOUNT,email_verified:true,exp:Math.floor(now/1000)+600};
  const keys=async()=>[jwk];
  assert.ok(await verifyGoogleJwt(await sign(good),env,now,keys));
  assert.equal(await verifyGoogleJwt(await sign({...good,aud:'https://evil.test'}),env,now,keys),null);
  assert.equal(await verifyGoogleJwt(await sign({...good,email:'someone@else.test'}),env,now,keys),null);
  assert.equal(await verifyGoogleJwt(await sign({...good,exp:Math.floor(now/1000)-5}),env,now,keys),null);
  const t=await sign(good);assert.equal(await verifyGoogleJwt(t.slice(0,-4)+'AAAA',env,now,keys),null);
  console.log('google push token check ok');
}
