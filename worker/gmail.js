import {HttpError,readBody} from './security.js';
import {notifyAccount} from './push.js';

const origin='https://stockroom.bookednpaid.com';
const callback=origin+'/api/gmail/callback';
const scope='https://www.googleapis.com/auth/gmail.readonly';
const encoder=new TextEncoder();
const mailboxPattern=/^[^\s@]{1,190}@[^\s@]{1,60}$/;
const messageId=/^[a-f0-9]{10,40}$/;
const dayMs=86400000;
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const b64url=bytes=>b64(bytes).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
const configured=env=>Boolean(env.GOOGLE_GMAIL_CLIENT_ID&&env.GOOGLE_GMAIL_CLIENT_SECRET&&env.STOCKROOM_SERVICE_KEY);
const connection=(env,id)=>env.DB.prepare('SELECT * FROM gmail_connections WHERE owner_id=?').bind(id).first();

async function encryptionKey(env){
  const base=await crypto.subtle.importKey('raw',encoder.encode(env.STOCKROOM_SERVICE_KEY),'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode('stockroom-gmail'),info:encoder.encode('refresh-token-v1')},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function protect(env,id,value){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(id)},await encryptionKey(env),encoder.encode(value));
  return b64(iv)+'.'+b64(new Uint8Array(data));
}
async function unprotect(env,id,value){
  try{
    const [iv,data]=value.split('.').map(decode);
    return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode(id)},await encryptionKey(env),data));
  }catch{throw new HttpError(409,'Reconnect Gmail to continue.');}
}
function publicConnection(row,env){
  return {available:configured(env),url:origin,connection:row?{
    mailbox:row.mailbox,enabled:!!row.enabled,alerts:!!row.alerts,days:row.days,
    state:row.state,checkedAt:row.checked_at,receipts:JSON.parse(row.receipts)
  }:null};
}
async function googleJSON(url,options={}){
  let res;
  try{res=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(9000)});}
  catch{throw new HttpError(502,'Google could not be reached. Try again shortly.');}
  let data;
  try{data=await res.json();}catch{throw new HttpError(502,'Google returned an unexpected response.');}
  if(res.status===401||data?.error==='invalid_grant'){console.error('Google auth rejected',String(url).split('?')[0],res.status,data?.error||'',String(data?.error_description||'').slice(0,200));
    throw new HttpError(409,'Reconnect Gmail to continue.');}
  if(!res.ok){console.error('Google request failed',String(url).split('?')[0],res.status,data?.error||'',String(data?.error_description||data?.error?.message||'').slice(0,200));
    throw new HttpError(502,'Google could not complete the Gmail check. Try again shortly.');}
  return data;
}
function getGmail(path,token,query={}){
  const url=new URL('https://gmail.googleapis.com/gmail/v1/users/me/'+path);
  for(const [key,value] of Object.entries(query))for(const entry of [value].flat())url.searchParams.append(key,entry);
  return googleJSON(url,{headers:{Authorization:'Bearer '+token}});
}
async function googleToken(env,args){
  const body=new URLSearchParams({client_id:env.GOOGLE_GMAIL_CLIENT_ID,client_secret:env.GOOGLE_GMAIL_CLIENT_SECRET,...args});
  const tokens=await googleJSON('https://oauth2.googleapis.com/token',{method:'POST',body});
  if(typeof tokens.access_token!=='string'||!tokens.access_token)throw new HttpError(502,'Google did not return an access token.');
  return tokens;
}
const redirect=result=>new Response(null,{status:303,headers:{Location:'/?gmail='+result,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
async function start(env,user,url){
  if(url.origin!==origin)throw new HttpError(400,'Open Stockroom on stockroom.bookednpaid.com to connect Gmail.');
  const state=random(), verifier=random(), expires=Date.now()+600000;
  await env.DB.prepare(`INSERT INTO gmail_oauth_states (owner_id,state,verifier,expires_at) VALUES (?,?,?,?)
    ON CONFLICT(owner_id) DO UPDATE SET state=excluded.state,verifier=excluded.verifier,expires_at=excluded.expires_at`)
    .bind(user.id,state,verifier,expires).run();
  const challenge=b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(verifier))));
  const google=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.search=new URLSearchParams({client_id:env.GOOGLE_GMAIL_CLIENT_ID,redirect_uri:callback,response_type:'code',
    scope,access_type:'offline',prompt:'consent select_account',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
  return {authorizeUrl:google.href};
}
async function finish(env,user,url){
  if(url.origin!==origin)return redirect('failed');
  const state=url.searchParams.get('state')||'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(state))return redirect('expired');
  const pending=await env.DB.prepare('UPDATE gmail_oauth_states SET expires_at=-expires_at WHERE owner_id=? AND state=? AND expires_at>? RETURNING verifier')
    .bind(user.id,state,Date.now()).first();
  if(!pending)return redirect('expired');
  try{
    if(url.searchParams.get('error'))return redirect('cancelled');
    const code=url.searchParams.get('code');
    if(!code||code.length>3000)return redirect('failed');
    const tokens=await googleToken(env,{code,code_verifier:pending.verifier,redirect_uri:callback,grant_type:'authorization_code'});
    if(!tokens.scope?.split(' ').includes(scope)||typeof tokens.refresh_token!=='string'||!tokens.refresh_token)return redirect('permission');
    const profile=await getGmail('profile',tokens.access_token);
    const mailbox=profile.emailAddress?.trim().toLowerCase();
    if(!mailboxPattern.test(mailbox||''))return redirect('failed');
    const sealed=await protect(env,user.id,tokens.refresh_token);
    const connected=await env.DB.prepare(`INSERT INTO gmail_connections (owner_id,connection_id,mailbox,token)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM gmail_oauth_states WHERE owner_id=? AND state=? AND expires_at<0)
      ON CONFLICT(owner_id) DO UPDATE SET connection_id=excluded.connection_id,token=excluded.token,
        receipts=CASE WHEN mailbox=excluded.mailbox THEN receipts ELSE '[]' END,mailbox=excluded.mailbox,
        state='connected',checked_at=NULL,lease=0`)
      .bind(user.id,random(),mailbox,sealed,user.id,state).run();
    return redirect(connected.meta.changes?'connected':'expired');
  }catch(error){console.error('Gmail connect failed',error?.status||'',String(error?.message||error).slice(0,200));return redirect('failed');}
  finally{await env.DB.prepare('DELETE FROM gmail_oauth_states WHERE owner_id=? AND state=?').bind(user.id,state).run();}
}

export function receiptUpdate(message,days,now=Date.now()){
  if(!messageId.test(message?.id||''))return null;
  const headers=message.payload?.headers;
  if(!Array.isArray(headers))return null;
  const header=name=>headers.find(h=>h.name?.toLowerCase()===name)?.value||'';
  if(!/^(?:[^<>]*<no-reply@vinted\.co\.uk>|no-reply@vinted\.co\.uk)$/i.test(header('from').trim()))return null;
  const auth=header('authentication-results');
  if(!/^mx\.google\.com\s*;/i.test(auth)||!/(?:^|[;\s])dmarc=pass\b[^;]*\bheader\.from=vinted\.co\.uk(?:\s|;|$)/i.test(auth))return null;
  const received=Number(message.internalDate);
  if(!Number.isFinite(received)||received<now-days*dayMs||received>now+60000)return null;
  const subject=header('subject').replace(/\s+/g,' ').trim().slice(0,230);
  let category;
  if(/offer|favou?rite|password|sign.in|new message|verification code/i.test(subject))return null;
  if(/\b(?:refund(?:ed)?|cancel(?:led|ed|lation))\b/i.test(subject))category='Refund / cancellation';
  else if(/\b(?:you sold|item sold|sale (?:confirmed|complete|completed)|sold an item)\b/i.test(subject))category='Sale';
  else if(/\b(?:purchase (?:confirmed|successful|confirmation)|you (?:just )?bought|order confirmed|payment successful)\b/i.test(subject))category='Purchase';
  else if(/\b(?:delivered|delivery|shipped|posted|on its way|parcel|confirmation needed|ready for (?:pickup|collection))\b/i.test(subject))category='Delivery';
  else if(/\b(?:payout|paid|payment|order|purchase|sale|transaction)\b/i.test(subject))category='Order update';
  else return null;
  return {id:message.id,subject,category,receivedAt:new Date(received).toISOString(),reviewed:false};
}

async function check(env,user,context,row){
  if(!row.enabled)throw new HttpError(409,'Resume Gmail sync before checking.');
  if(row.state==='reconnect')throw new HttpError(409,'Reconnect Gmail to continue.');
  const now=Date.now();
  if(row.checked_at&&now-Date.parse(row.checked_at)<60000)return {added:0,...publicConnection(row,env)};
  const lease=now+90000;
  const locked=await env.DB.prepare('UPDATE gmail_connections SET lease=? WHERE owner_id=? AND connection_id=? AND lease<? AND enabled=1')
    .bind(lease,user.id,row.connection_id,now).run();
  if(!locked.meta.changes)throw new HttpError(409,'A Gmail check is already running.');
  const update=async(state,receipts)=>{
    const current=await connection(env,user.id);
    if(current?.connection_id!==row.connection_id||current.lease!==lease)return false;
    const before=JSON.parse(current.receipts);
    const merged=new Map(before.map(receipt=>[receipt.id,receipt]));
    for(const receipt of receipts)if(!merged.has(receipt.id))merged.set(receipt.id,receipt);
    const recent=[...merged.values()].sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)).slice(0,75);
    const result=await env.DB.prepare('UPDATE gmail_connections SET state=?,checked_at=?,receipts=?,lease=0 WHERE owner_id=? AND connection_id=? AND lease=? AND enabled=1 AND receipts=?')
      .bind(state,new Date().toISOString(),JSON.stringify(recent),user.id,row.connection_id,lease,current.receipts).run();
    const added=recent.filter(receipt=>!before.some(existing=>existing.id===receipt.id)).length;
    if(result.meta.changes&&current.alerts&&current.checked_at&&added)notifyAccount(context,env,user.id,'gmail');
    return result.meta.changes?added:false;
  };
  try{
    const token=await unprotect(env,user.id,row.token);
    const {access_token}=await googleToken(env,{refresh_token:token,grant_type:'refresh_token'});
    const list=await getGmail('messages',access_token,{q:'from:no-reply@vinted.co.uk newer_than:'+row.days+'d',maxResults:'24',fields:'messages(id)'});
    const ids=(list.messages||[]).filter(m=>messageId.test(m.id)).slice(0,24);
    const results=[];
    for(let i=0;i<ids.length;i+=6){
      const batch=await Promise.all(ids.slice(i,i+6).map(({id})=>getGmail('messages/'+id,access_token,{
        format:'metadata',metadataHeaders:['From','Subject','Authentication-Results'],fields:'id,internalDate,payload(headers)'
      })));
      results.push(...batch.map(message=>receiptUpdate(message,row.days,now)).filter(Boolean));
    }
    const added=await update('connected',results);
    return {added:added||0,...publicConnection(await connection(env,user.id),env)};
  }catch(error){
    await update(error.status===409?'reconnect':'check_failed',[]);
    throw error;
  }finally{
    await env.DB.prepare('UPDATE gmail_connections SET lease=0 WHERE owner_id=? AND connection_id=? AND lease=?')
      .bind(user.id,row.connection_id,lease).run();
  }
}

export async function gmailRoute(request,url,env,user,context){
  const path=url.pathname, method=request.method;
  if(path==='/api/gmail'&&method==='GET')return publicConnection(await connection(env,user.id),env);
  if(path==='/api/gmail'&&method==='DELETE'){
    await env.DB.prepare('DELETE FROM gmail_oauth_states WHERE owner_id=?').bind(user.id).run();
    await env.DB.prepare('DELETE FROM gmail_connections WHERE owner_id=?').bind(user.id).run();
    return publicConnection(null,env);
  }
  if(!configured(env))throw new HttpError(503,'Google authorization has not been configured for Stockroom.');
  if(path==='/api/gmail/connect'&&method==='POST')return start(env,user,url);
  if(path==='/api/gmail/callback'&&method==='GET')return finish(env,user,url);
  const row=await connection(env,user.id);
  if(!row)throw new HttpError(409,'Connect the Gmail inbox that receives your Vinted emails.');
  if(path==='/api/gmail/check'&&method==='POST')return check(env,user,context,row);
  if(path==='/api/gmail'&&method==='PUT'){
    const {enabled,alerts,days}=await readBody(request,1000);
    if(typeof enabled!=='boolean'||typeof alerts!=='boolean'||![1,3,7].includes(days))throw new HttpError(400,'Choose valid Gmail sync options.');
    const reset=Number(enabled)!==row.enabled||days!==row.days;
    await env.DB.prepare('UPDATE gmail_connections SET enabled=?,alerts=?,days=?,checked_at=CASE WHEN ? THEN NULL ELSE checked_at END,lease=CASE WHEN ? THEN 0 ELSE lease END WHERE owner_id=? AND connection_id=?')
      .bind(Number(enabled),Number(alerts),days,Number(reset),Number(reset),user.id,row.connection_id).run();
  }else if(path==='/api/gmail/review'&&method==='PUT'){
    const {id,reviewed}=await readBody(request,1000);
    if(!messageId.test(id||'')||typeof reviewed!=='boolean')throw new HttpError(400,'Choose a valid Vinted update.');
    const receipts=JSON.parse(row.receipts);
    if(!receipts.some(receipt=>receipt.id===id))throw new HttpError(404,'Vinted update not found.');
    const changed=await env.DB.prepare('UPDATE gmail_connections SET receipts=? WHERE owner_id=? AND connection_id=? AND receipts=?')
      .bind(JSON.stringify(receipts.map(receipt=>receipt.id===id?{...receipt,reviewed}:receipt)),user.id,row.connection_id,row.receipts).run();
    if(!changed.meta.changes)throw new HttpError(409,'The inbox changed. Refresh it and try again.');
  }else throw new HttpError(405,'Method not allowed.');
  return publicConnection(await connection(env,user.id),env);
}

