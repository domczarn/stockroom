import {isPro} from './billing.js';
import {HttpError,readBody} from './security.js';
import {notifyAccount} from './push.js';

const origin='https://stockroom.bookednpaid.com';
const callback=origin+'/api/gmail/callback';
const scope='https://www.googleapis.com/auth/gmail.readonly';
const encoder=new TextEncoder();
const mailboxPattern=/^[^\s@]{1,190}@[^\s@]{1,60}$/;
const messageId=/^[a-f0-9]{10,40}$/;
const dayMs=86400000;
const BACKFILL_DAYS=45;
// Label and courier emails need one full read; older saved ones that already have a tracking number count as read.
const needsFullRead=r=>(!r.read&&(r.courier||(r.event?.type==='label'&&!r.event.tracking)))||(r.event?.type==='label'&&(r.read||0)<2&&!r.event.qrMedia);
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
  // Cloudflare Workers only supports redirect 'follow' or 'manual', so refuse redirects by hand.
  try{res=await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(9000)});}
  catch(error){console.error('Google fetch failed',String(error?.message||error).slice(0,200));throw new HttpError(502,'Google could not be reached. Try again shortly.');}
  if(res.status>=300&&res.status<400)throw new HttpError(502,'Google returned an unexpected redirect.');
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
  const sender=verifiedSender(header('from'),header('authentication-results'));
  if(!sender)return null;
  const received=Number(message.internalDate);
  if(!Number.isFinite(received)||received<now-days*dayMs||received>now+60000)return null;
  const subject=header('subject').replace(/\s+/g,' ').trim().slice(0,230);
  // Courier emails (InPost via Vinted, Evri, Royal Mail…) are read in full later and matched by tracking number.
  if(sender!=='vinted.co.uk'){
    if(!/(drop|locker|posted|ready|collect|deliver|on its way|heading|qr code|received your parcel|in transit|label)/i.test(subject))return null;
    return {id:message.id,subject,category:'Delivery',receivedAt:new Date(received).toISOString(),reviewed:true,quiet:true,courier:sender,needsBody:true};
  }
  let category, quiet=false;
  // Only the steps that move money or stock: bought, sold, posted/delivered, refunds. Confirmation and reminder emails are ignored.
  if(/offer|favou?rite|password|sign.in|new message|verification code|reminder|review|rate your|feedback|promo|newsletter|tips?\b|survey/i.test(subject))return null;
  if(/\b(?:order confirmed|payment (?:successful|confirmed|received)|purchase (?:confirmed|successful|confirmation)|sale confirmed|booking confirmed)\b/i.test(subject))return null;
  if(/^your receipt for\b/i.test(subject)||/\byou (?:just )?bought\b/i.test(subject))category='Purchase';
  else if(/\b(?:refund(?:ed)?|cancel(?:led|ed|lation)|return completed)\b/i.test(subject))category='Refund / cancellation';
  else if(/\b(?:you.ve sold|you sold|item sold|sold an item|sale (?:complete|completed)|this order is completed)\b/i.test(subject))category='Sale';
  else if(/\bconfirmation needed\b/i.test(subject)){category='Delivery';quiet=true;} // your purchase arrived: used to mark stock received, not shown
  else if(/\b(?:delivered|shipped|posted|on its way|shipping label|ready for (?:pickup|collection)|dropped off|in transit)\b/i.test(subject))category='Delivery';
  else return null;
  const receivedAt=new Date(received).toISOString();
  const event=vintedEvent(subject,message.snippet,receivedAt);
  return {id:message.id,subject,category,receivedAt,reviewed:quiet,...(quiet?{quiet:true}:{}),...(event?{event}:{}),...(event?.type==='label'?{needsBody:true}:{})};
}

// Who sent it, but only if Gmail confirms the sender's domain (DMARC pass). Vinted and the couriers Vinted uses in the UK.
export const COURIER_DOMAINS=['relay.vinted.com','evri.com','royalmail.com','inpost.co.uk','yodel.co.uk','dpd.co.uk','dpdlocal.co.uk','parcelforce.com','ups.com'];
export function verifiedSender(from,auth){
  const address=(String(from).match(/<([^<>\s]+@[^<>\s]+)>\s*$/)||String(from).trim().match(/^([^<>\s]+@[^<>\s]+)$/)||[])[1]?.toLowerCase();
  if(!address)return null;
  const domain=address.split('@')[1];
  if(!(domain==='vinted.co.uk'&&address==='no-reply@vinted.co.uk')&&!COURIER_DOMAINS.includes(domain))return null;
  if(!/^mx\.google\.com\s*;/i.test(auth||''))return null;
  const passed=[...String(auth).matchAll(/(?:^|[;\s])dmarc=pass\b[^;]*\bheader\.from=([a-z0-9.-]+)/gi)].map(m=>m[1].toLowerCase());
  return passed.some(d=>d===domain||domain.endsWith('.'+d))?domain:null;
}

// Tracking numbers: InPost JJD…, Evri H…, Royal Mail AB123456789GB, or anything labelled as a tracking/parcel number.
export function trackingFrom(text){
  const t=String(text||'');
  const m=t.match(/\b(JJD\d{10,24})\b/)||t.match(/\b(H\d{2}[A-Z0-9]{11,15})\b/)||t.match(/\b([A-Z]{2}\d{9}GB)\b/)||t.match(/(?:tracking (?:code|number)|parcel number|reference)[:\s]+([A-Z0-9]{8,30})\b/i);
  return m?m[1].toUpperCase():'';
}
// Courier email → a step in the parcel's journey.
export function courierEvent(subject,text,receivedAt,courier){
  const tracking=trackingFrom(text);
  if(!tracking)return null;
  const s=subject+' '+String(text).slice(0,1200), date=ukDate(receivedAt);
  const carrier=courier==='relay.vinted.com'?(/inpost/i.test(text)?'InPost':'Vinted'):courier.split('.')[0].replace(/^./,c=>c.toUpperCase());
  if(/qr code is ready|your qr code/i.test(subject)){const code=(String(text).match(/enter this code instead\s*([\d ]{6,20}\d)/i)||[])[1]?.trim()||'';return {type:'qr',tracking,code,carrier,date};}
  if(/ready for them to collect|been collected|picked up by your buyer|delivered to (?:your )?buyer/i.test(s))return {type:'parcel-delivered',tracking,carrier,date};
  if(/locker-?ed up|thanks for dropping off|drop.?off confirmation|dropped off your parcel|heading their way|on its way to your buyer|picked up from the drop-off/i.test(s))return {type:'posted',tracking,carrier,date};
  return null;
}
// Plain text of a full Gmail message, and its attachments.
export function messageParts(payload){
  const out={text:'',html:'',files:[]};
  const walk=part=>{
    if(!part)return;
    const data=part.body?.data;
    if(part.filename&&part.body?.attachmentId)out.files.push({name:part.filename,type:part.mimeType,id:part.body.attachmentId,size:part.body.size||0});
    else if(data&&part.mimeType==='text/plain'&&!out.text)out.text=b64urlText(data);
    else if(data&&part.mimeType==='text/html'&&!out.html)out.html=b64urlText(data);
    (part.parts||[]).forEach(walk);
  };
  walk(payload);
  if(!out.text&&out.html)out.text=out.html.replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
  return out;
}
const b64urlText=data=>{try{return new TextDecoder().decode(Uint8Array.from(atob(data.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)));}catch{return '';}};
async function saveAttachment(env,owner,access_token,messageId,file,onQr){
  if(!file||file.size>2_000_000||!['application/pdf','image/png','image/jpeg'].includes(file.type))return '';
  const body=await getGmail('messages/'+messageId+'/attachments/'+file.id,access_token);
  if(typeof body?.data!=='string')return '';
  const bytes=Uint8Array.from(atob(body.data.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const pdf=bytes[0]===37&&bytes[1]===80&&bytes[2]===68&&bytes[3]===70, png=bytes[0]===137&&bytes[1]===80, jpeg=bytes[0]===255&&bytes[1]===216;
  if(!((file.type==='application/pdf'&&pdf)||(file.type==='image/png'&&png)||(file.type==='image/jpeg'&&jpeg)))return '';
  const id=crypto.randomUUID();
  await env.BUCKET.put('users/'+owner+'/'+id,bytes,{httpMetadata:{contentType:file.type}});
  const path='/api/media/'+encodeURIComponent(owner)+'/'+id;
  // Relay / Vinted Go labels carry the scan code inside the PDF: save it as its own picture too.
  if(pdf&&onQr){const png=pdfCodeImage(bytes);if(png){const qid=crypto.randomUUID();await env.BUCKET.put('users/'+owner+'/'+qid,png,{httpMetadata:{contentType:'image/png'}});onQr('/api/media/'+encodeURIComponent(owner)+'/'+qid);}}
  return path;
}

// The scan code in a Vinted digital label PDF is one greyscale picture stored with PNG row filters
// (FlateDecode + Predictor 15), which is exactly PNG's own format: wrap it in a PNG, no decoding needed.
export function pdfCodeImage(bytes){
  const text=new TextDecoder('latin1').decode(bytes);
  const re=/\d+\s+\d+\s+obj\s*<<((?:(?!endobj)[\s\S]){0,1500}?)>>\s*stream\r?\n/g;
  let best=null,m;
  while((m=re.exec(text))){
    const dict=m[1];
    if(!/\/Subtype\s*\/Image/.test(dict))continue;
    const num=k=>Number((dict.match(new RegExp('/'+k+'\\s+(\\d+)'))||[])[1]);
    const w=num('Width'),h=num('Height'),len=num('Length');
    if(!/\/DeviceGray/.test(dict)||!/\/FlateDecode/.test(dict)||!/\/Predictor\s+1[0-5]/.test(dict)||![1,8].includes(num('BitsPerComponent'))||/\/SMask|\/Decode\s*\[/.test(dict))continue;
    if(!(w>=200&&h>=200&&w<=3000&&h<=3000&&len>100))continue;
    const start=m.index+m[0].length;
    if(!best||w*h>best.w*best.h)best={w,h,bits:num('BitsPerComponent'),data:bytes.slice(start,start+len)};
  }
  if(!best)return null;
  const crcTable=pdfCodeImage.table||=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
  const crc=buf=>{let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const out=new Uint8Array(12+data.length),dv=new DataView(out.buffer);dv.setUint32(0,data.length);const t=new TextEncoder().encode(type);out.set(t,4);out.set(data,8);dv.setUint32(8+data.length,crc(out.subarray(4,8+data.length)));return out;};
  const ihdr=new Uint8Array(13),dv=new DataView(ihdr.buffer);dv.setUint32(0,best.w);dv.setUint32(4,best.h);ihdr.set([best.bits,0,0,0,0],8);
  const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',best.data),chunk('IEND',new Uint8Array(0))];
  const png=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){png.set(p,o);o+=p.length;}
  return png;
}
// Read the full email for label and courier messages: tracking number, label PDF, InPost QR code.
async function enrichReceipt(env,owner,access_token,receipt){
  const full=await getGmail('messages/'+receipt.id,access_token,{format:'full'});
  const {text,files}=messageParts(full.payload);
  if(receipt.courier){
    const event=courierEvent(receipt.subject,text,receipt.receivedAt,receipt.courier);
    if(event?.type==='qr'){const qr=files.find(f=>/^image\//.test(f.type)&&/qr/i.test(f.name))||files.find(f=>/^image\//.test(f.type));event.qrMedia=await saveAttachment(env,owner,access_token,receipt.id,qr);}
    return {...receipt,needsBody:undefined,...(event?{event}:{})};
  }
  if(receipt.event?.type==='label'){
    const tracking=(text.match(/tracking code:?\s*\|?\s*([A-Z0-9]{8,30})/i)||[])[1]?.toUpperCase()||trackingFrom(text);
    const deadline=(receipt.subject.match(/use by (\d{2})\/(\d{2})\/(\d{4})/)||[]);
    const pdf=files.find(f=>f.type==='application/pdf');
    let qrMedia='';
    const labelMedia=pdf?await saveAttachment(env,owner,access_token,receipt.id,pdf,path=>{qrMedia=path;}):'';
    return {...receipt,needsBody:undefined,event:{...receipt.event,tracking,...(deadline[0]?{deadline:deadline[3]+'-'+deadline[2]+'-'+deadline[1]}:{}),...(labelMedia?{labelMedia}:{}),...(qrMedia?{qrMedia}:{})}};
  }
  return {...receipt,needsBody:undefined};
}

// Turn a Vinted email (subject + Gmail's text preview) into a stock update Stockroom can apply.
const snippetEntities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',pound:'£'};
const decodeSnippet=text=>String(text||'').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&([a-z]+);/gi,(m,n)=>snippetEntities[n.toLowerCase()]??m).replace(/\s+/g,' ').trim();
const ukDate=iso=>new Date(iso).toLocaleDateString('en-CA',{timeZone:'Europe/London'});
const title=text=>String(text||'').replace(/^["“”']+|["“”']+$/g,'').trim().slice(0,160);
export function vintedEvent(subject,snippet,receivedAt){
  const text=decodeSnippet(snippet), date=ukDate(receivedAt);
  let m;
  if(/^you.ve sold an item/i.test(subject)&&(m=text.match(/,\s*(\S+) has bought (.+?) £\s?([\d,]+(?:\.\d{1,2})?)/i)))
    return {type:'sold',title:title(m[2]),amount:Number(m[3].replace(/,/g,'')),buyer:m[1].slice(0,60),date};
  if(/^this order is completed/i.test(subject)&&(m=text.match(/your sale of (.+?) was completed successfully\.?(?:.*?transaction id:\s*#?(\d+))?(?:.*?date:\s*(\d{2})\/(\d{2})\/(\d{4}))?/i)))
    return {type:'completed',title:title(m[1]),transactionId:m[2]||'',date:m[5]?m[5]+'-'+m[4]+'-'+m[3]:date};
  if((m=subject.match(/^(.+?)\s+-\s+confirmation needed$/i)))return {type:'delivered',title:title(m[1]),date};
  if(!/^return/i.test(subject)&&(m=subject.match(/^(.+?)\s+shipping label\b/i)))return {type:'label',title:title(m[1]),date};
  if((m=subject.match(/^your refund for (.+?) is on its way/i))||(m=subject.match(/^return completed\s*-\s*(.+)$/i)))return {type:'refund',title:title(m[1]),date};
  return null;
}

export async function check(env,user,context,row){
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
    for(const receipt of receipts){const known=merged.get(receipt.id);if(!known)merged.set(receipt.id,receipt);else if(((receipt.read||0)>(known.read||0))||(receipt.event&&(!known.event||(receipt.event.tracking&&!known.event.tracking))))merged.set(receipt.id,{...known,...receipt});}
    const recent=[...merged.values()].sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)).slice(0,220);
    const result=await env.DB.prepare('UPDATE gmail_connections SET state=?,checked_at=?,receipts=?,lease=0 WHERE owner_id=? AND connection_id=? AND lease=? AND enabled=1 AND receipts=?')
      .bind(state,new Date().toISOString(),JSON.stringify(recent),user.id,row.connection_id,lease,current.receipts).run();
    const added=recent.filter(receipt=>!before.some(existing=>existing.id===receipt.id)).length;
    if(result.meta.changes&&current.alerts&&current.checked_at&&added)notifyAccount(context,env,user.id,'gmail');
    return result.meta.changes?added:false;
  };
  try{
    const token=await unprotect(env,user.id,row.token);
    const {access_token}=await googleToken(env,{refresh_token:token,grant_type:'refresh_token'});
    // Cloudflare allows ~50 outside requests per run, so spend them carefully and pick up the rest next check.
    let budget=38;
    const senders=['no-reply@vinted.co.uk',...COURIER_DOMAINS.map(d=>'@'+d)].map(f=>'from:'+f).join(' OR ');
    const list=await getGmail('messages',access_token,{q:'('+senders+') newer_than:'+row.days+'d',maxResults:'40',fields:'messages(id)'});
    // Also look further back for completed orders and labels, so older sales still close properly.
    const older=await getGmail('messages',access_token,{q:'from:no-reply@vinted.co.uk (subject:"order is completed" OR subject:"shipping label") newer_than:'+BACKFILL_DAYS+'d',maxResults:'30',fields:'messages(id)'}).catch(()=>({}));
    const ids=[...new Set([...(list.messages||[]),...(older.messages||[])].map(m=>m.id))].filter(id=>messageId.test(id));
    const knownReceipts=new Map(JSON.parse(row.receipts||'[]').map(r=>[r.id,r]));
    const results=[];
    const fresh=ids.filter(id=>!knownReceipts.has(id));
    for(const id of ids)if(knownReceipts.has(id))results.push({...knownReceipts.get(id)});
    for(let i=0;i<fresh.length&&budget>0;i+=6){
      const slice=fresh.slice(i,i+Math.min(6,budget));
      budget-=slice.length;
      const batch=await Promise.all(slice.map(id=>getGmail('messages/'+id,access_token,{
        format:'metadata',metadataHeaders:['From','Subject','Authentication-Results'],fields:'id,internalDate,snippet,payload(headers)'
      }).catch(()=>null)));
      results.push(...batch.filter(Boolean).map(message=>receiptUpdate(message,BACKFILL_DAYS,now)).filter(Boolean));
    }
    // Full read for label and courier emails not read properly yet (tracking number, label PDF, QR code).
    results.sort((a,b)=>String(b.receivedAt).localeCompare(String(a.receivedAt)));
    for(let i=0;i<results.length;i++){
      const r=results[i];
      if(!needsFullRead(r))continue;
      if(budget<3)break; // the rest are picked up on the next check
      budget-=2;
      try{results[i]={...(await enrichReceipt(env,user.id,access_token,{...r,needsBody:true})),read:2};}catch{results[i]={...r,needsBody:undefined};}
    }
    for(let i=results.length-1;i>=0;i--)if(!results[i])results.splice(i,1);
    if(user.admin){
      const bought=await importPurchases(env,access_token,results.filter(receipt=>receipt.category==='Purchase'));
      if(bought.length)notifyAccount(context,env,user.id,'purchase',null,bought.length===1
        ?'Added to stock: '+bought[0].name+' · £'+bought[0].cost.toFixed(2)
        :bought.length+' purchases added to stock: '+bought.map(item=>item.name).join(', ').slice(0,140));
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
  if(path==='/api/gmail/connect'&&method==='POST'){
    // Gmail is in beta: until Google verifies the app, only a limited number of people can connect.
    if(!user.admin){
      const mine=await env.DB.prepare('SELECT 1 FROM gmail_connections WHERE owner_id=?').bind(user.id).first();
      if(!mine){
        const cap=Number((await env.DB.prepare("SELECT value FROM app_settings WHERE key='gmail_cap'").first().catch(()=>null))?.value??90);
        const used=(await env.DB.prepare('SELECT COUNT(*) AS n FROM gmail_connections').first())?.n||0;
        if(used>=cap)throw new HttpError(403,'Gmail auto-updates are in beta and all spaces are taken right now. You’ll be able to connect as soon as more open up.');
      }
    }
    return start(env,user,url);
  }
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



// ---------- Vinted purchase receipts -> stock (owner only) ----------
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',pound:'£',rsquo:'’',lsquo:'‘',ldquo:'“',rdquo:'”'};
function decodePart(data){
  const bin=atob(String(data||'').replace(/-/g,'+').replace(/_/g,'/'));
  return new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0)));
}
function findBody(part,type){
  if(!part)return '';
  if(part.mimeType===type&&part.body?.data)return decodePart(part.body.data);
  for(const child of part.parts||[]){const found=findBody(child,type);if(found)return found;}
  return '';
}
export function receiptText(html){
  return html.replace(/<(?:style|script)[\s\S]*?<\/(?:style|script)>/gi,' ')
    .replace(/<(?:br|\/td|\/th|\/p|\/tr|\/div|\/li|\/h\d)[^>]*>/gi,'\n').replace(/<[^>]+>/g,' ')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)))
    .replace(/&([a-z]+);/gi,(m,name)=>entities[name.toLowerCase()]??m)
    .split('\n').map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
}
export function parsePurchaseReceipt(text){
  const pick=pattern=>text.match(pattern)?.[1]?.trim()||'';
  const name=pick(/(?:^|\n)Order\n([^\n]{1,400})\n/);
  const cost=Number(pick(/(?:^|\n)Paid\n£\s*([\d,]+\.\d{2})/).replace(/,/g,''));
  const transactionId=pick(/Transaction ID\n#?\s*(\d{5,30})/);
  const date=text.match(/Payment date\n(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  const seller=pick(/(?:^|\n)Seller\n([^\n]{1,80})\n/);
  if(!name||!(cost>0&&cost<1000000)||!transactionId||!date)return null;
  const purchasedAt=date[3]+'-'+date[2]+'-'+date[1]+(date[4]?'T'+date[4]+':'+date[5]:'');
  return {transactionId,name,brand:'',cost:Math.round(cost*100)/100,purchasedAt,seller};
}
async function importPurchases(env,token,receipts){
  if(!receipts.length)return [];
  const owner=await env.DB.prepare('SELECT payload FROM workspaces w JOIN profiles p ON p.user_id=w.owner_id WHERE p.owner=1 LIMIT 1').first();
  const inStock=new Set();
  try{for(const item of JSON.parse(owner?.payload||'{}').items||[])if(item.sourceTransactionId)inStock.add(String(item.sourceTransactionId));}catch{}
  const added=[];
  let reads=0;
  for(const receipt of receipts.slice(0,12)){
    const seen=await env.DB.prepare("SELECT 1 FROM purchase_imports WHERE json_extract(payload,'$.gmailId')=? LIMIT 1").bind(receipt.id).first();
    if(seen)continue;
    if(++reads>4)break; // stay inside Cloudflare's request limit; the rest come next check
    try{
      const message=await getGmail('messages/'+receipt.id,token,{format:'full',fields:'id,payload'});
      const html=findBody(message.payload,'text/html')||findBody(message.payload,'text/plain');
      const purchase=parsePurchaseReceipt(receiptText(html));
      if(!purchase){console.error('Receipt not understood',receipt.id);continue;}
      const now=new Date().toISOString();
      // Already in stock from before Gmail sync: record it so it is not fetched again, without touching the item.
      const payload={transactionId:purchase.transactionId,sourceStockId:'',name:purchase.name,brand:'',cost:purchase.cost,purchasedAt:purchase.purchasedAt,
        size:'',color:'',garment:'',listingUrl:'',referencePhotos:[],photoStatus:'Listing photos unavailable',updatedAt:now,gmailId:receipt.id,seller:purchase.seller,
        ...(inStock.has(purchase.transactionId)?{alreadyInStock:true}:{})};
      const insert=await env.DB.prepare('INSERT INTO purchase_imports (transaction_id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(transaction_id) DO NOTHING')
        .bind(purchase.transactionId,JSON.stringify(payload),now).run();
      if(insert.meta.changes&&!inStock.has(purchase.transactionId))added.push(purchase);
    }catch(error){console.error('Receipt import failed',receipt.id,String(error?.message||error).slice(0,120));}
  }
  return added;
}

// Runs from the Worker cron so purchases arrive without opening the app.
export async function scheduledGmail(env,context){
  const owner=await env.DB.prepare('SELECT user_id FROM profiles WHERE owner=1 LIMIT 1').first();
  const rows=(await env.DB.prepare("SELECT * FROM gmail_connections WHERE enabled=1 AND state<>'reconnect'").all()).results||[];
  for(const row of rows){
    const owned=Boolean(owner&&row.owner_id===owner.user_id);
    if(!owned&&!(await isPro(env,{id:row.owner_id,admin:false})))continue; // auto-updates are a Pro feature
    try{await check(env,{id:row.owner_id,admin:Boolean(owner&&row.owner_id===owner.user_id)},context,row);}
    catch(error){if(error?.status!==409)console.error('Scheduled Gmail check failed',String(error?.message||error).slice(0,160));}
  }
}
