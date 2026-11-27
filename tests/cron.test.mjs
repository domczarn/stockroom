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
import {rateLimit} from '../worker/security.js';
{
  let calls=0;const env={SAVE_LIMITER:{async limit({key}){calls++;return {success:key!=='blocked'};}}};
  await rateLimit(env,'someone');
  await assert.rejects(rateLimit(env,'blocked'),e=>e.status===429);
  assert.equal(calls,2);
  console.log('edge rate limit ok');
}
import {platformSaleEvent,receiptUpdate,verifiedSender} from '../worker/gmail.js';
{
  const auth = d => 'mx.google.com; dkim=pass; spf=pass; dmarc=pass (p=REJECT) header.from=' + d;
  assert.equal(verifiedSender('eBay <ebay@ebay.com>', auth('ebay.com')), 'ebay.com');
  assert.equal(verifiedSender('Depop <sold@alerts.depop.com>', auth('depop.com')), 'alerts.depop.com');
  assert.equal(verifiedSender('eBay - someone <x@members.ebay.co.uk>', auth('members.ebay.co.uk')), null, 'member messages are ignored');
  assert.equal(verifiedSender('eBay <ebay@ebay.com>', 'mx.google.com; dmarc=fail header.from=ebay.com'), null);
  const msg = (from, d, subject) => ({id: '197a1365344ca3d7', internalDate: String(Date.parse('2026-11-20T09:13:00Z')), snippet: '', payload: {headers: [{name: 'From', value: from}, {name: 'Subject', value: subject}, {name: 'Authentication-Results', value: auth(d)}]}});
  const e = receiptUpdate(msg('eBay <ebay@ebay.com>', 'ebay.com', 'You made the sale for Nike Tech Fleece Hoodie Grey M'), 30, Date.parse('2026-11-21T00:00:00Z'));
  assert.equal(e.category, 'Sale'); assert.equal(e.platformSale.platform, 'eBay'); assert.equal(e.platformSale.title, 'Nike Tech Fleece Hoodie Grey M'); assert.ok(e.needsBody);
  assert.equal(receiptUpdate(msg('eBay <ebay@ebay.com>', 'ebay.com', 'Nike Tech... has been listed'), 30, Date.parse('2026-11-21T00:00:00Z')), null);
  const ebay = platformSaleEvent(e.platformSale, '# Great news – your item has sold.\n| #### Sold: | £350.00 |\n| #### Date sold: | 24 Jun 2025 10:12 |\n| #### Buyer: | mariam8820[](https://x) |', '2026-11-20T09:13:00Z');
  assert.deepEqual([ebay.type, ebay.amount, ebay.buyer, ebay.platform], ['sold', 350, 'mariam8820', 'eBay']);
  const d = receiptUpdate(msg('Depop <sold@alerts.depop.com>', 'depop.com', 'Your Evri shipping label and sale confirmation for @ponte290.'), 30, Date.parse('2026-11-21T00:00:00Z'));
  assert.equal(d.platformSale.buyer, 'ponte290');
  const depop = platformSaleEvent(d.platformSale, ' Order details\n\n Item\n:\nBlack north face puffer jacket\nWomen’s\nSize M\n...\n Item price\n:\n£65.00\n\n Payment details', '2026-11-20T09:13:00Z');
  assert.deepEqual([depop.title, depop.amount, depop.platform], ['Black north face puffer jacket', 65, 'Depop']);
  console.log('eBay and Depop sale emails ok');
}
import {vintedFormatAlert} from '../worker/alerts.js';
import {environment as envFor} from './support.mjs';
{
  const sent = [];
  const env = {...envFor(), RESEND_API_KEY: 're', RESEND_FETCH: async (u, o) => { sent.push(JSON.parse(o.body)); return new Response('{}'); }};
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare("INSERT INTO usage_daily (day, feature, count) VALUES (?, 'mail:vinted-seen', 9)").bind(day).run();
  assert.equal(await vintedFormatAlert(env), true);
  assert.match(sent[0].subject, /Vinted emails/);
  assert.equal(await vintedFormatAlert(env), false, 'not twice in two days');
  const ok = {...envFor(), RESEND_API_KEY: 're', RESEND_FETCH: async () => { throw new Error('should not send'); }};
  await ok.DB.prepare("INSERT INTO usage_daily (day, feature, count) VALUES (?, 'mail:vinted-seen', 9), (?, 'mail:vinted-understood', 3)").bind(day, day).run();
  assert.equal(await vintedFormatAlert(ok), false);
  console.log('vinted format alert ok');
}
