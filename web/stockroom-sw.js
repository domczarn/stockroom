'use strict';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
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
