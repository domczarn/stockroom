import {buildPushPayload} from '@block65/webcrypto-web-push';
import {HttpError,readBody} from './security.js';

const options = {
  message:{body:'You have a new message in Stockroom.',tab:'Profile'},
  friend:{body:'There’s an update to your Stockroom friends.',tab:'Profile'},
  purchase:{body:'Verified Vinted purchase details were updated in Stockroom.',tab:'Stock'},
  receipt:{body:'A verified Vinted sale receipt is ready to review.',tab:'Sale receipts'},
  gmail:{body:'New Vinted email updates are ready to review.',tab:'Vinted updates'},
  access:{body:'Someone requested access to Stockroom. Open Admin to review.',tab:'Admin'},
  testmessage:{body:'Stockroom test. Tap to open your selected conversation.',tab:'Profile'},
  test:{body:'Stockroom notifications are working on this device.',tab:'Dashboard'}
};
const subject='https://stockroom.bookednpaid.com';
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const keyPattern=/^[A-Za-z0-9_-]+$/;

function endpointAllowed(value){
  if(typeof value!=='string'||value.length>2500)return false;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||url.pathname==='/')return false;
    const host=url.hostname;
    return ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(host)
      || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
  }catch{return false;}
}
function validKeys(keys){
  return keys&&typeof keys.p256dh==='string'&&keys.p256dh.length===87&&keyPattern.test(keys.p256dh)
    &&typeof keys.auth==='string'&&keys.auth.length===22&&keyPattern.test(keys.auth);
}
async function vapidKeys(env,create=false){
  const query=()=>env.DB.prepare("SELECT public_key,private_key FROM push_keys WHERE id='default'").first();
  let keys=await query();
  if(!keys&&create){
    const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const publicKey=b64url(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)));
    const privateKey=(await crypto.subtle.exportKey('jwk',pair.privateKey)).d;
    await env.DB.prepare("INSERT INTO push_keys(id,public_key,private_key) VALUES ('default',?,?) ON CONFLICT(id) DO NOTHING")
      .bind(publicKey,privateKey).run();
    keys=await query();
  }
  return keys&&{subject,publicKey:keys.public_key,privateKey:keys.private_key};
}

async function deliver(env,row,keys,kind,chat){
  try{
    const subscription=JSON.parse(row.subscription);
    if(!endpointAllowed(subscription.endpoint)||!validKeys(subscription.keys))return false;
    const conversation=(kind==='message'||kind==='testmessage')&&/^[a-f0-9]{64}$/.test(chat||'')?chat:null;
    const data=JSON.stringify({body:options[kind].body,tab:options[kind].tab,tag:'stockroom-'+kind+(conversation?'-'+conversation:''),...(conversation?{chat:conversation}:{})});
    const payload=await buildPushPayload({data,options:{ttl:3600}},subscription,keys);
    const response=await fetch(subscription.endpoint,{...payload,redirect:'manual',signal:AbortSignal.timeout(8000)});
    if([404,410].includes(response.status)){
      await env.DB.prepare('DELETE FROM push_devices WHERE endpoint=? AND owner_id=? AND updated_at=?')
        .bind(subscription.endpoint,row.owner_id,row.updated_at).run();
    }
    await response.body?.cancel();
    return response.ok;
  }catch{return false;}
}

async function deliverToAccount(env,ownerId,kind,chat){
  if(!ownerId)return;
  const rows=await env.DB.prepare('SELECT * FROM push_devices WHERE owner_id=? ORDER BY updated_at DESC LIMIT 8').bind(ownerId).all();
  if(!rows.results.length)return;
  const keys=await vapidKeys(env);
  if(!keys)return;
  const results=await Promise.all(rows.results.map(row=>deliver(env,row,keys,kind,chat)));
  console.info('stockroom-push',kind,{accepted:results.filter(Boolean).length,attempted:results.length});
}

export function notifyAccount(context,env,ownerId,kind,chat){
  if(context?.waitUntil)context.waitUntil(deliverToAccount(env,ownerId,kind,chat).catch(()=>{}));
}
export function notifyOwner(context,env,kind){
  if(!context?.waitUntil)return;
  context.waitUntil((async()=>{
    const owner=await env.DB.prepare('SELECT user_id FROM profiles WHERE owner=1 LIMIT 1').first();
    await deliverToAccount(env,owner?.user_id,kind);
  })().catch(()=>{}));
}

export async function pushRoute(request,url,env,user,findConnection){
  if(url.pathname==='/api/push/config'&&request.method==='GET'){
    const {publicKey}=await vapidKeys(env,true);
    return {publicKey};
  }
  if(url.pathname!=='/api/push/device'&&url.pathname!=='/api/push/test')throw new HttpError(404,'Not found.');
  if(!['PUT','POST','DELETE'].includes(request.method))throw new HttpError(405,'Method not allowed.');
  const body=await readBody(request,5500);
  if(!endpointAllowed(body?.endpoint))throw new HttpError(400,'This browser’s push service is unsupported.');
  if(url.pathname==='/api/push/test'&&request.method==='POST'){
    const row=await env.DB.prepare('SELECT * FROM push_devices WHERE endpoint=? AND owner_id=?').bind(body.endpoint,user.id).first();
    if(!row)throw new HttpError(404,'Enable notifications on this device first.');
    const chat=body.chat;
    if(chat!==undefined){
      if(typeof chat!=='string'||!/^[a-f0-9]{64}$/.test(chat))throw new HttpError(400,'Choose a valid conversation.');
      const connection=await findConnection(env,user.id,chat);
      if(connection?.state!=='accepted')throw new HttpError(404,'Conversation unavailable.');
    }
    const keys=await vapidKeys(env);
    if(!keys||!await deliver(env,row,keys,chat?'testmessage':'test',chat))throw new HttpError(502,'The push service did not accept this notification. Re-enable notifications and try again.');
    return {ok:true};
  }
  if(url.pathname!=='/api/push/device')throw new HttpError(405,'Method not allowed.');
  if(request.method==='DELETE'){
    await env.DB.prepare('DELETE FROM push_devices WHERE endpoint=? AND owner_id=?').bind(body.endpoint,user.id).run();
    return {ok:true};
  }
  if(request.method!=='PUT')throw new HttpError(405,'Method not allowed.');
  if(!validKeys(body.keys))throw new HttpError(400,'Invalid push subscription.');
  const subscription=JSON.stringify({endpoint:body.endpoint,expirationTime:null,keys:{p256dh:body.keys.p256dh,auth:body.keys.auth}});
  await env.DB.prepare('INSERT INTO push_devices(endpoint,owner_id,subscription,updated_at) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET owner_id=excluded.owner_id,subscription=excluded.subscription,updated_at=excluded.updated_at')
    .bind(body.endpoint,user.id,subscription,new Date().toISOString()).run();
  const overflow=await env.DB.prepare('SELECT endpoint FROM push_devices WHERE owner_id=? ORDER BY updated_at DESC,endpoint DESC LIMIT 100 OFFSET 8').bind(user.id).all();
  for(const row of overflow.results)await env.DB.prepare('DELETE FROM push_devices WHERE endpoint=? AND owner_id=?').bind(row.endpoint,user.id).run();
  return {ok:true};
}
