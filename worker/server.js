import {marketResearchRoute} from './market-research.js';
import {isStockroomService} from './service-auth.js';
import {emailSyncState,syncStatusRoute} from './import-status.js';
import {gmailRoute} from './gmail.js';
import {notifyOwner,pushRoute} from './push.js';
import { socialRoute, ownProfile, findConnection } from './social.js';
import { pipSvg } from './pip.js';
import {visionRoute,writeListingRoute} from './vision.js';
import {studioRoute} from './studio.js';
import {offerRoute,askRoute,scanRoute} from './pipai.js';
import {weeklyRoute,unsubscribePage} from './weekly.js';
import {authRoute} from './auth.js';
import {adminRoute,appSettings} from './admin.js';
import {logError} from './alerts.js';
import {loadWorkspace,saveWorkspace} from './workspace-store.js';
import {billingRoute,planFor,requirePro,checkNewItems,recordNewItems,deleteOwnAccount} from './billing.js';
import {ADMIN_EMAIL,identity,authorize,adminOnly,readBody,validateWorkspace,storePhotos,audit,HttpError,emptyWorkspace,rateLimit,exactDate,paid,tx} from './security.js';
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: {'content-type':'application/json','cache-control':'private, no-store'}
});
function loginPage(request,env={}){
  const key=/^[0-9A-Za-z_-]{10,80}$/.test(env.TURNSTILE_SITE_KEY||'')?env.TURNSTILE_SITE_KEY:'';
  const html=key?assets['/login.html'].replace('data-sitekey=""','data-sitekey="'+key+'"').replace('</body>','<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad" async defer></script></body>'):assets['/login.html'];
  const ts=key?' https://challenges.cloudflare.com':'';
  return new Response(request.method==='HEAD'?null:html,{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':key?'strict-origin':'same-origin',
    'content-security-policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'"+ts+"; frame-src 'self'"+ts+"; connect-src 'self'"+ts+"; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
}
function welcomePage(request,suspended=false){
  const title=suspended?'Stockroom access paused':'Welcome to Stockroom';
  const copy=suspended?'This account cannot access Stockroom. Contact your administrator to restore access.':
    'Track your stock, listings and sales in your own workspace. Sign in to get started.';
  const params = new URL(request.url).searchParams;
  const chat = params.get('chat');
  const item = params.get('i');
  const scope = params.get('s');
  let returnTo = '/';
  if (/^[a-f0-9]{64}$/.test(chat||'')) returnTo = '/?open=Profile&chat='+chat;
  if (item && item.length<=100 && /^[a-f0-9]{16}$/.test(scope||'')) {
    returnTo = '/?'+new URLSearchParams({i:item,s:scope});
  }
  const action=suspended?'<a href="/login" target="_top">Use a different email</a>':
    '<a href="'+returnTo.replace(/&/g,'&amp;')+'" target="_top">Sign in</a>';
  return new Response(request.method==='HEAD'?null:'<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/app.css"><body class="stockroom-welcome"><main><img src="/pip.svg" width="108" height="102" alt=""><h1>'+title+'</h1><p>'+copy+'</p>'+action+'</main></body></html>',{
    status:suspended?403:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex, nofollow','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; style-src 'self'; frame-ancestors 'self'; base-uri 'none'; object-src 'none'"}
  });
}
const safeImage = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^images[0-9]*\.vinted\.net$/.test(url.hostname) && !url.username && !url.password;
  } catch { return false; }
};
function validPurchase(p) {
  return p && typeof p.transactionId === 'string' && /^\d{5,30}$/.test(p.transactionId)
    && typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 400
    && typeof p.brand === 'string' && p.brand.length <= 150
    && paid(p.cost) && p.cost > 0 && p.cost < 1000000
    && typeof p.purchasedAt === 'string' && exactDate(p.purchasedAt.slice(0,10))
    && (!p.imageUrls || (Array.isArray(p.imageUrls) && p.imageUrls.length <= 4 && p.imageUrls.every(safeImage)));
}
async function importPhotos(purchase, env, existing) {
  const photos = [...(existing?.referencePhotos || [])];
  for (const url of purchase.imageUrls || []) {
    const index=[0,1,2,3].find(slot=>!photos.some(photo=>photo.url.endsWith('/'+slot)));
    if(index===undefined)break;
    if (photos.some(photo => photo.sourceUrl === url)) continue;
    try {
      const response = await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(10000)});
      const type = response.headers.get('content-type')?.split(';')[0];
      if (!response.ok || !['image/jpeg','image/png','image/webp'].includes(type)) continue;
      if (Number(response.headers.get('content-length')) > 5*1024*1024) continue;
      const reader = response.body.getReader();
      let bytes = 0;
      const chunks = [];
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 5*1024*1024) { await reader.cancel(); throw Error('Photo too large'); }
        chunks.push(part.value);
      }
      const buffer = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { buffer.set(chunk,offset); offset += chunk.length; }
      const key = 'purchases/' + purchase.transactionId + '/' + index;
      await env.BUCKET.put(key,buffer,{httpMetadata:{contentType:type}});
      photos.push({url:'/api/photos/' + purchase.transactionId + '/' + index,sourceUrl:url});
    } catch { /* Retain the purchase even when the source photo cannot be fetched. */ }
  }
  return photos.slice(0,4);
}
export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    try {
      // Mutations use same-origin JSON requests; identity is verified by Cloudflare Access.
      if (!['GET','HEAD'].includes(request.method)) {
        if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) throw new HttpError(403,'Invalid origin');
        if (request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403,'Cross-site write blocked');
      }
      if(url.pathname.startsWith('/auth/'))return await authRoute(request,url,env);
      if(url.pathname==='/email/unsubscribe'&&request.method==='GET')return await unsubscribePage(url,env);
      if(url.pathname==='/login'&&['GET','HEAD'].includes(request.method))return identity(request)?Response.redirect(url.origin+'/',302):loginPage(request,env);
      const rawUser=identity(request);
      const importRoute = ['/api/purchases','/api/sync-status','/api/sale-imports','/api/market-research'].includes(url.pathname) || /^\/api\/photos\//.test(url.pathname);
      if((url.pathname==='/'||url.pathname==='/index.html')&&['GET','HEAD'].includes(request.method)){
        if(!rawUser)return loginPage(request,env);
        try{await authorize(request,env);}
        catch(error){if(error instanceof HttpError&&error.status===403)return welcomePage(request,true);throw error;}
      }
      const user = url.pathname.startsWith('/api/') && !(!rawUser&&await isStockroomService(request,env,url.pathname))
        ? await authorize(request,env) : rawUser;
      if(url.pathname.startsWith('/api/')&&!['GET','HEAD'].includes(request.method))await rateLimit(env,user?.id||'stockroom-sync-service');
      // Emails Pip has already applied or you skipped, shared by all your devices.
      if(url.pathname==='/api/gmail/done'){
        if(!user)throw new HttpError(401,'Sign in first.');
        if(request.method==='GET'){
          const result=await env.DB.prepare('SELECT gmail_id FROM email_updates_done WHERE owner_id = ? ORDER BY created_at DESC LIMIT 2000').bind(user.id).all();
          return json({ids:result.results.map(row=>row.gmail_id)});
        }
        if(request.method==='POST'){
          const body=await readBody(request,40000)||{};
          const ids=Array.isArray(body.ids)?[...new Set(body.ids)].filter(id=>typeof id==='string'&&/^[a-f0-9]{8,40}$/.test(id)).slice(0,500):[];
          if(!ids.length)return json({saved:0});
          const now=new Date().toISOString();
          for(const id of ids)await env.DB.prepare('INSERT INTO email_updates_done (owner_id,gmail_id,created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING').bind(user.id,id,now).run();
          return json({saved:ids.length});
        }
        throw new HttpError(405,'Method not allowed.');
      }
      if(url.pathname==='/api/account/delete'){const r=await deleteOwnAccount(request,env,user);return new Response(JSON.stringify(r),{headers:{'content-type':'application/json','cache-control':'no-store','set-cookie':'sr_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});}
      if(url.pathname==='/api/billing'||url.pathname.startsWith('/api/billing/'))return json(await billingRoute(request,url,env,user));
      if(['/api/gmail/connect','/api/gmail/check'].includes(url.pathname)&&request.method==='POST')await requirePro(env,user,'Gmail auto-updates');
      if(url.pathname==='/api/gmail'||url.pathname.startsWith('/api/gmail/')){
        const result=await gmailRoute(request,url,env,user,context);
        return result instanceof Response?result:json(result);
      }
      if((url.pathname.startsWith('/api/vision/')||(url.pathname.startsWith('/api/pip/')&&!url.pathname.startsWith('/api/pip/weekly')))&&request.method==='POST')await requirePro(env,user,'Pip AI');
      if(url.pathname==='/api/pip/studio')return json(await studioRoute(request,env,user));
      if(url.pathname==='/api/pip/offer')return json(await offerRoute(request,env,user));
      if(url.pathname==='/api/pip/ask')return json(await askRoute(request,env,user));
      if(url.pathname==='/api/pip/scan')return json(await scanRoute(request,env,user));
      if(url.pathname.startsWith('/api/pip/weekly'))return json(await weeklyRoute(request,url,env,user));
      if(url.pathname==='/api/vision/listing')return json(await visionRoute(request,env,user));
      if(url.pathname==='/api/vision/write-listing')return json(await writeListingRoute(request,env,user));
      if(url.pathname==='/api/market-research')return json(await marketResearchRoute(request,env,user));
      if (importRoute && user && !user.admin) return json(url.pathname==='/api/purchases'?{purchases:[]}:{error:'Admin access required'},url.pathname==='/api/purchases'?200:403);
      if(url.pathname==='/api/notification-reads'){
        if(request.method==='GET'){
          const rows=await env.DB.prepare('SELECT event_key FROM notification_reads WHERE owner_id=? ORDER BY read_at DESC LIMIT 3000').bind(user.id).all();
          return json({keys:rows.results.map(row=>row.event_key)});
        }
        if(request.method==='PUT'){
          const body=await readBody(request,180000);
          if(!Array.isArray(body?.keys)||body.keys.length>1000||body.keys.some(key=>typeof key!=='string'||!key||key.length>170))
            throw new HttpError(400,'Invalid notification selection.');
          await env.DB.prepare(`INSERT OR IGNORE INTO notification_reads (owner_id,event_key,read_at)
            SELECT ?,value,? FROM json_each(?)`).bind(user.id,new Date().toISOString(),JSON.stringify(body.keys)).run();
          return json({success:true});
        }
        throw new HttpError(405,'Method not allowed');
      }
      if(url.pathname.startsWith('/api/push/'))return json(await pushRoute(request,url,env,user,findConnection));
      if (url.pathname === '/api/avatar' && request.method === 'GET') {
        const seed=url.searchParams.get('seed') || '';
        if(!/^[a-f0-9-]{36}$/.test(seed))throw new HttpError(400,'Invalid avatar.');
        return new Response(pipSvg(seed),{headers:{'content-type':'image/svg+xml','cache-control':'private, max-age=86400','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'"}});
      }
      if(url.pathname === '/api/profile' || url.pathname === '/api/profile/activity' || url.pathname === '/api/leaderboard' || url.pathname === '/api/friends' || url.pathname.startsWith('/api/friends/')){
        const result=await socialRoute(request,url,env,user,context);
        if(result)return json(result);
      }
      if (url.pathname === '/api/me' && request.method === 'GET') return json({user:{id:user.id,email:user.email,role:user.admin?'admin':'member'},profile:await ownProfile(env,user),plan:(await planFor(env,user)).plan,announcement:await (async()=>{const a=await appSettings(env);return a.announcement_on==='1'&&a.announcement?{text:a.announcement,tone:a.announcement_tone}:null;})(),sessionManagedBy:'Stockroom'});
      if (url.pathname === '/api/workspace') {
        const owner=url.searchParams.get('owner')||user.id;
        if(owner!==user.id){adminOnly(user);if(request.method!=='GET')throw new HttpError(403,'Other accounts are read-only.');}
        if(request.method==='GET') {
          const stored=await loadWorkspace(env,owner);
          if(owner!==user.id)await audit(env,user,owner,'admin_view');
          return json({data:stored?.data||null,revision:stored?.revision||null,updatedAt:stored?.updatedAt||null,owner,readOnly:owner!==user.id});
        }
        if(request.method==='PUT') {
          const body=await readBody(request,19000000);
          if(!(body.revision===null||typeof body.revision==='string'))throw new HttpError(400,'Missing workspace revision.');
          const current=await env.DB.prepare('SELECT revision, payload FROM workspaces WHERE owner_id = ?').bind(owner).first();
          if((current?.revision||null)!==body.revision)throw new HttpError(409,'A newer version was saved on another device. Your edits are kept here.');
          const checked=validateWorkspace(body.data,owner);
          let previousItems=[];try{previousItems=current?JSON.parse(current.payload).items||[]:[];}catch{}
          const added=await checkNewItems(env,user,previousItems,checked.items);
          const data=await storePhotos(checked,owner,env);
          if(!user.admin && data.items.some(i=>i.referencePhotos?.length))throw new HttpError(400,'Reference imports belong to the admin account.');
          const saved=await saveWorkspace(env,owner,data,current?body.revision:null);
          if(saved.tooBig)throw new HttpError(413,'Your workspace is too big to save. Archive or delete old sold items, then try again.');
          if(saved.conflict)throw new HttpError(409,'Another device saved first. Your edits are kept here.');
          const {revision,updatedAt}=saved;
          await recordNewItems(env,owner,added);
          await audit(env,user,owner,'workspace_save');
          return json({data,revision,updatedAt,owner});
        }
        throw new HttpError(405,'Method not allowed');
      }
      const media=url.pathname.match(/^\/api\/media\/([^/]+)\/([a-f0-9-]{36})$/);
      if(media && request.method==='GET') {
        const owner=decodeURIComponent(media[1]);if(owner!==user.id)adminOnly(user);
        const object=await env.BUCKET.get('users/'+owner+'/'+media[2]);
        if(!object)throw new HttpError(404,'Photo unavailable');
        return new Response(object.body,{headers:{'content-type':object.httpMetadata.contentType,'cache-control':'private, max-age=31536000, immutable','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'"}});
      }
      if(url.pathname.startsWith('/api/admin/')&&!['/api/admin/members','/api/admin/audit'].includes(url.pathname))return json(await adminRoute(request,url,env,user));
      if(url.pathname==='/api/admin/members') {
        adminOnly(user);
        if(request.method==='GET') {
          const result=await env.DB.prepare('SELECT m.email,m.user_id,m.name,m.status,m.created_at,w.updated_at FROM members m LEFT JOIN workspaces w ON w.owner_id = m.user_id ORDER BY m.created_at DESC LIMIT 500').all();
          return json({members:result.results});
        }
        if(request.method==='POST') {
          const body=await readBody(request,2000),email=String(body.email||'').trim().toLowerCase();
          if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||email===ADMIN_EMAIL||!['active','suspended'].includes(body.status||'active'))throw new HttpError(400,'Enter a valid member email and status.');
          const name=String(body.name||email).trim().slice(0,100);
          await env.DB.prepare('INSERT INTO members (email,name,status,created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,status=excluded.status').bind(email,name,body.status||'active',new Date().toISOString()).run();
          await audit(env,user,email,body.status==='suspended'?'member_suspended':'member_approved');
          return json({success:true});
        }
        throw new HttpError(405,'Method not allowed');
      }
      if(url.pathname==='/api/admin/audit' && request.method==='GET'){
        adminOnly(user);const result=await env.DB.prepare('SELECT action,owner_id,created_at FROM audit_events ORDER BY created_at DESC LIMIT 50').all();return json({events:result.results});
      }
      if(url.pathname.startsWith('/api/')&&!importRoute)throw new HttpError(404,'Not found');
      if(url.pathname==='/api/sync-status')return json(await syncStatusRoute(request,env,user));
      if(!user&&request.method==='POST'&&['/api/purchases','/api/sale-imports'].includes(url.pathname)&&!(await emailSyncState(env)).enabled)
        return json({error:'Vinted email imports are paused in Stockroom.'},409);
      if (url.pathname === '/api/sale-imports') {
        if(request.method==='GET'){
          const result=await env.DB.prepare('SELECT payload FROM sale_imports ORDER BY updated_at DESC LIMIT 1000').all();
          return json({events:result.results.map(row=>JSON.parse(row.payload))});
        }
        if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
        const body=await readBody(request,150000);
        if(!Array.isArray(body?.events)||body.events.length>100)throw new HttpError(400,'Send up to 100 sale events.');
        const events=body.events.map(event=>{
          if(!event||!tx(event.transactionId)||typeof event.receiptId!=='string'||!/^[a-zA-Z0-9_-]{5,150}$/.test(event.receiptId)||
            typeof event.name!=='string'||!event.name.trim()||event.name.length>400||!exactDate(event.date)||
            !['sold','posted','completed','paid','refunded'].includes(event.stage)||
            (event.amount!=null&&!paid(event.amount))||(['sold','refunded'].includes(event.stage)&&(!paid(event.amount)||event.amount<=0)))
            throw new HttpError(400,'Invalid sale event.');
          return {id:event.transactionId+':'+event.stage,transactionId:event.transactionId,receiptId:event.receiptId,
            name:event.name.trim(),stage:event.stage,date:event.date,amount:event.amount??null};
        });
        if(new Set(events.map(event=>event.id)).size!==events.length)throw new HttpError(400,'Duplicate sale event.');
        const now=new Date().toISOString();
        let newReceipt=false;
        for(const event of events){
          const insert=await env.DB.prepare('INSERT INTO sale_imports (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING')
            .bind(event.id,JSON.stringify(event),now).run();
          if(insert.meta.changes)newReceipt=true;
          else await env.DB.prepare('UPDATE sale_imports SET payload=?,updated_at=? WHERE id=? AND payload<>?')
            .bind(JSON.stringify(event),now,event.id,JSON.stringify(event)).run();
        }
        if(newReceipt)notifyOwner(context,env,'receipt');
        return json({success:true,count:events.length});
      }
      if (url.pathname === '/api/purchases' && request.method === 'GET') {
        const result = await env.DB.prepare('SELECT payload, updated_at FROM purchase_imports ORDER BY updated_at DESC LIMIT 1000').all();
        return json({purchases:result.results.map(row=>JSON.parse(row.payload)),checkedAt:new Date().toISOString()});
      }
      if (url.pathname === '/api/purchases' && request.method === 'POST') {
        // The API accepts an authenticated administrator or a signed import session.
        if (request.headers.has('origin') && request.headers.get('origin') !== url.origin) return json({error:'Invalid origin'},403);
        const data = await readBody(request,400000);
        if (!Array.isArray(data.purchases) || data.purchases.length > 100 || !data.purchases.every(validPurchase)) return json({error:'Invalid purchase import'},400);
        const updatedAt = new Date().toISOString();
        let changedPurchase=false;
        for (const p of data.purchases) {
          const old = await env.DB.prepare('SELECT payload FROM purchase_imports WHERE transaction_id = ?').bind(p.transactionId).first();
          const existing = old ? JSON.parse(old.payload) : null;
          const priorPhotoCount=existing?.referencePhotos?.length||0;
          const referencePhotos = await importPhotos(p,env,existing);
          const payload = {transactionId:p.transactionId,sourceStockId:String(p.sourceStockId||'').slice(0,40),name:p.name,brand:p.brand,cost:p.cost,
            purchasedAt:String(p.purchasedAt||'').slice(0,40),size:String(p.size||'').slice(0,40),color:String(p.color||'').slice(0,60),
            garment:String(p.garment||'').slice(0,100),listingUrl:/^https:\/\/www\.vinted\.co\.uk\/items\/\d+/.test(p.listingUrl||'')?p.listingUrl:'',
            referencePhotos,photoStatus:referencePhotos.length?'Imported reference photos': 'Listing photos unavailable',updatedAt};
          if(existing){
            for(const field of ['sourceStockId','brand','size','color','garment','listingUrl'])payload[field] ||= existing[field] || '';
          }
          if(!existing){
            const insert=await env.DB.prepare('INSERT INTO purchase_imports (transaction_id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(transaction_id) DO NOTHING')
              .bind(p.transactionId,JSON.stringify(payload),updatedAt).run();
            changedPurchase=changedPurchase||Boolean(insert.meta.changes);
          }else{
            await env.DB.prepare('UPDATE purchase_imports SET payload=?,updated_at=? WHERE transaction_id=?')
              .bind(JSON.stringify(payload),updatedAt,p.transactionId).run();
            if(referencePhotos.length>priorPhotoCount)changedPurchase=true;
          }
        }
        if(changedPurchase)notifyOwner(context,env,'purchase');
        return json({success:true,count:data.purchases.length,updatedAt});
      }
      const match = url.pathname.match(/^\/api\/photos\/(\d{5,30})\/([0-3])$/);
      if (match && request.method === 'GET') {
        const object = await env.BUCKET.get('purchases/' + match[1] + '/' + match[2]);
        if (!object) return json({error:'Photo unavailable'},404);
        return new Response(object.body,{headers:{'content-type':object.httpMetadata.contentType,'cache-control':'private, max-age=3600','x-content-type-options':'nosniff'}});
      }
      if (!['GET','HEAD'].includes(request.method)) return json({error:'Method not allowed'},405);
      if(url.pathname==='/seed.json' && !rawUser?.admin) return json({error:'Admin access required'},403);
      if(['/privacy.html','/terms.html'].includes(url.pathname)&&request.method==='GET'){
        const s=await appSettings(env),e=v=>String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
        const details=[s.company_number&&'company number '+e(s.company_number),s.company_address&&'registered office '+e(s.company_address)].filter(Boolean).join(', ');
        return new Response(assets[url.pathname].replace('<!--company-->',details?' ('+details+')':''),{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"}});
      }
      if (!(url.pathname in assets)) return new Response('Not found',{status:404});
      const assetTag='"'+(JSON.parse(assets['/version.json']||'{}').version||'v')+'"';
      if(request.headers.get('if-none-match')===assetTag&&url.pathname!=='/version.json')return new Response(null,{status:304,headers:{etag:assetTag,'cache-control':'private, no-cache'}});
      if(typeof assets[url.pathname] === 'object') { const a=assets[url.pathname];return new Response(request.method==='HEAD'?null:Uint8Array.from(atob(a.base64),c=>c.charCodeAt(0)),{headers:{'content-type':a.type,'cache-control':'private, max-age=3600','x-content-type-options':'nosniff'}});}
      const type = url.pathname.endsWith('.svg')?'image/svg+xml':url.pathname.endsWith('.webmanifest')?'application/manifest+json':url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.json')?'application/json':'text/html';
      return new Response(request.method === 'HEAD'?null:assets[url.pathname],{headers:{'content-type':type+';charset=utf-8','cache-control':'private, no-cache',etag:assetTag,'x-content-type-options':'nosniff','referrer-policy':'same-origin','x-robots-tag':'noindex, nofollow','content-security-policy':url.pathname==='/receipt-ocr-worker.js' ? "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; connect-src 'self' https://cdn.jsdelivr.net" : "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'; object-src 'none'"}});
    } catch (error) {
      const status=error instanceof HttpError?error.status:500;
      if(status>=500&&context?.waitUntil)context.waitUntil(logError(env,url,status,error));else if(status>=500)await logError(env,url,status,error);
      return json({error:error instanceof HttpError?error.message:'Stockroom could not complete this request. Please try again.'},status);
    }
  }
};
