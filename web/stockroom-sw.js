'use strict';
// Offline: network first, last good copy when there is no signal.
// Only plain same-origin GETs are kept: the app itself, your last workspace and photos. Sign-in redirects are never cached.
const CACHE='stockroom-offline-v2';
const KEEP=/^\/(?:$|index\.html$|[\w.-]+\.(?:js|css|woff2|png|svg|webmanifest|json)$|api\/(?:me|workspace|gmail|purchases)$|api\/media\/)/;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request, url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||!KEEP.test(url.pathname)||url.pathname==='/version.json')return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const key=request.mode==='navigate'?'/':url.pathname+url.search;
    // Photos and images never change once uploaded: show the saved copy instantly.
    if(/^\/api\/media\/|\.(?:png|svg|woff2)$/.test(url.pathname)){
      const hit=await cache.match(key);
      if(hit)return hit;
    }
    try{
      const response=await fetch(request);
      if(response.ok&&response.type==='basic'&&!response.redirected)cache.put(key,response.clone()).catch(()=>{});
      return response;
    }catch(error){
      const cached=await cache.match(key)||(request.mode==='navigate'?await cache.match('/'):null);
      if(cached)return cached;
      throw error;
    }
  })());
});
self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?.json()||{};}catch{}
  const views=['Dashboard','Profile','Stock','Sale receipts','Admin','Vinted updates'];
  const tab=views.includes(payload.tab)?payload.tab:'Dashboard';
  const chat=tab==='Profile'&&/^[a-f0-9]{64}$/.test(payload.chat||'')?payload.chat:null;
  const tag=typeof payload.tag==='string'&&/^stockroom-[a-z]+(?:-[a-f0-9]{64})?$/.test(payload.tag)?payload.tag:'stockroom';
  const title=typeof payload.title==='string'&&payload.title.length<60?payload.title:'Stockroom';
  const body=typeof payload.body==='string'?payload.body.slice(0,180):'You have a new Stockroom update.';
  const kind=typeof payload.kind==='string'&&/^[a-z]{1,20}$/.test(payload.kind)?payload.kind:'';
  event.waitUntil(Promise.all([self.registration.showNotification(title,{
    body,icon:'/pip-icon.png',badge:'/pip-icon.png',tag,renotify:true,vibrate:[60,40,120],data:{tab,chat}
  }),self.clients.matchAll({type:'window'}).then(windows=>{
    for(const client of windows)client.postMessage({type:'stockroom-update',tab,chat,title,body,kind});
  })]));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const tab=event.notification.data?.tab;
  const views=['Dashboard','Profile','Stock','Sale receipts','Admin','Vinted updates'];
  const chat=tab==='Profile'&&/^[a-f0-9]{64}$/.test(event.notification.data?.chat||'')?event.notification.data.chat:null;
  const path='/?open='+encodeURIComponent(views.includes(tab)?tab:'Dashboard')+(chat?'&chat='+chat:'');
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);
    if(existing){
      try{
        const focused=await existing.focus();
        focused.postMessage({type:'stockroom-notification',tab,chat});
        return;
      }catch{}
    }
    await self.clients.openWindow(path);
  })());
});
