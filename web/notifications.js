'use strict';
let pushRegistration = null;
let deviceSubscription = null;
let pushPreparation = null;
const pushOwnerKey='stockroom.push-owner';
const supportsPush = () => window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const pushTabs=['Orders','Resources','Customer care','Dashboard','Profile','Stock','Sale receipts','Admin','Vinted updates','Leaderboard'];
let purchaseNoticeKeys=[];
let notificationReads=null;
let notificationReadRequest=null;
let vintedConnection=null;

function vintedEmailPanel(){
  if(account?.role!=='admin'||isReadOnly()){
    return isReadOnly()?'':'<section class="panel"><h2>Vinted email</h2><button type="button" class="secondary" data-tab="Vinted updates">Manage personal Gmail connection ↗</button></section>';
  }
  return '<section class="panel vinted-email-panel"><span class="eyebrow">AUTOMATIC IMPORTS</span><h2>Vinted email</h2><p>Stockroom reads Vinted purchase and sale emails from your connected Gmail. Use the same inbox that receives your Vinted receipts.</p><div id="vintedEmailStatus" aria-live="polite">Checking connection…</div><p class="footnote">Receipts arrive from your connected Gmail inbox. Enable imports here once that inbox is connected. Verified changes can send a push alert when notifications are enabled on your device.</p></section>';
}

function renderVintedEmail(){
  const panel=$('vintedEmailStatus');
  if(!panel||!vintedConnection||account?.role!=='admin'||isReadOnly())return;
  const {email,purchaseCount}=vintedConnection;
  const check=email.checkedAt?new Date(email.checkedAt):null;
  const stale=check&&Date.now()-check.getTime()>2*60*60*1000;
  const label=!email.enabled?'Paused':email.state==='connected'?(stale?'Last check delayed':'Connected'):
    email.state==='needs_attention'?'Reconnect Gmail':email.state==='check_failed'?'Check failed':'Awaiting first check';
  const markup='<div class="mini-stat"><span>Gmail connection</span><b>'+label+'</b></div>'+
    (email.mailbox?'<div class="mini-stat"><span>Verified inbox</span><b>'+esc(email.mailbox)+'</b></div>':'')+
    '<div class="mini-stat"><span>Last automatic check</span><b>'+esc(check?check.toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}):'Not checked yet')+'</b></div>'+
    '<div class="mini-stat"><span>Verified purchases</span><b>'+esc(purchaseCount)+'</b></div>'+
    '<button type="button" class="secondary" data-vinted-toggle>'+ (email.enabled?'Pause automatic imports':'Enable automatic imports')+'</button>';
  if(panel.dataset.markup!==markup){panel.innerHTML=markup;panel.dataset.markup=markup;}
}

async function loadImportNoticeStatus(){
  if(account?.role!=='admin'||isReadOnly())return;
  try{
    const status=await api('/api/sync-status');
    if(isReadOnly())return;
    vintedConnection=status;
    renderVintedEmail();
  }catch{
    if($('vintedEmailStatus')&&!vintedConnection)$('vintedEmailStatus').textContent='Connection status unavailable. Try reopening Settings.';
  }
}


async function loadNotificationReads(){
  if(!account||notificationReadRequest)return;
  const request=api('/api/notification-reads');
  notificationReadRequest=request;
  try{
    const {keys}=await request;
    notificationReads=new Set(keys);
    renderNotifications();
  }finally{notificationReadRequest=null;}
}

async function markNotificationKeys(keys){
  if(!notificationReads||!keys.length)return;
  for(let offset=0;offset<keys.length;offset+=1000)
    await api('/api/notification-reads',{method:'PUT',body:JSON.stringify({keys:keys.slice(offset,offset+1000)})});
  for(const key of keys)notificationReads.add(key);
  renderNotifications();
}

function notificationItems(){
  if(!account||!db||isReadOnly())return [];
  const entries=[];
  const messages=friends.filter(row=>row.unread);
  const unread=messages.reduce((sum,row)=>sum+row.unread,0);
  const requests=friends.filter(row=>row.state==='pending'&&row.incoming);
  if(unread)entries.push({id:'messages',title:unread+' unread '+(unread===1?'message':'messages'),text:'Open your conversations.',tab:'Profile',symbol:'✉',chat:messages.length===1?messages[0].id:null,keys:messages.map(row=>'message:'+row.id+':'+row.lastMessageAt)});
  if(requests.length)entries.push({id:'friends',title:requests.length+' friend '+(requests.length===1?'request':'requests'),text:'Review your incoming requests.',tab:'Profile',symbol:'＋',keys:requests.map(row=>'friend:'+row.id)});
  if(account.role==='admin'){
    const waiting=saleReceipts.filter(row=>!(db.receiptsReviewed||[]).includes(row.id));
    if(waiting.length)entries.push({id:'sales',title:waiting.length+' Vinted sale '+(waiting.length===1?'receipt':'receipts')+' to review',text:'Match each receipt to the correct item.',tab:'Sale receipts',symbol:'↗',keys:waiting.map(row=>'sale:'+row.id+':'+row.receiptId)});
    if(purchaseNoticeKeys.length)entries.push({id:'purchases',title:'Recent Vinted purchases',text:'See verified purchases and available reference photos.',tab:'Stock',symbol:'↗',keys:purchaseNoticeKeys});
  }
  const gmail=personalGmail?.connection?.receipts.filter(row=>!row.reviewed)||[];
  if(gmail.length)entries.push({id:'gmail',title:'Vinted email updates',text:'Review your connected Gmail inbox.',tab:'Vinted updates',symbol:'✉',keys:gmail.map(row=>'gmail:'+row.id)});
  const returns=db.items.filter(item=>!item.deletedAt&&item.status==='Refund pending');
  if(returns.length)entries.push({id:'returns',title:returns.length+' pending '+(returns.length===1?'refund':'refunds'),text:'Check the return status in Stock.',tab:'Stock',symbol:'↺',keys:returns.map(item=>'refund:'+item.id)});
  return entries.map(entry=>({...entry,unreadKeys:notificationReads?entry.keys.filter(key=>!notificationReads.has(key)):[]}));
}

function renderNotifications(){
  const dot=$('notificationCount'),list=$('notificationList');
  if(!dot||!list)return;
  const entries=notificationItems();
  const hasUnread=entries.some(entry=>entry.unreadKeys.length);
  dot.hidden=!hasUnread;
  $('notificationBell').setAttribute('aria-label','Notifications'+(hasUnread?', unread updates':''));
  if(!$('notificationsDialog').open&&!$('settingsNotificationsHost')?.contains($('deviceNotificationPreferences')))return;
  $('markNotificationsRead').hidden=!hasUnread;
  const markup=entries.map(entry=>'<button class="notification-row" type="button" data-notification-entry="'+entry.id+'"><span aria-hidden="true">'+entry.symbol+'</span><span><strong>'+entry.title+'</strong><small>'+entry.text+'</small></span>'+(entry.unreadKeys.length?'<i class="notification-dot" role="img" aria-label="Unread"></i>':'<b aria-hidden="true">›</b>')+'</button>').join('')||'<p class="footnote">You’re all caught up.</p>';
  if(list.dataset.markup!==markup){list.innerHTML=markup;list.dataset.markup=markup;}
  const button=$('notificationToggle'), test=$('notificationTest');
  const target=$('notificationTestTarget'), select=$('notificationTestChat');
  target.hidden=!deviceSubscription;
  const accepted=friends.filter(row=>row.state==='accepted');
  const options='<option value="">Dashboard</option>'+accepted.map(row=>'<option value="'+esc(row.id)+'">Chat with @'+esc(row.username)+'</option>').join('');
  if(select.dataset.markup!==options){
    const previous=select.value;
    select.innerHTML=options;select.dataset.markup=options;
    if(accepted.some(row=>row.id===previous))select.value=previous;
  }
  if(!button.disabled){
    button.textContent=deviceSubscription?'Turn off on this device':'Enable push on this device';
    test.hidden=!deviceSubscription;
  }
}
function storedPushOwner(){
  try{return localStorage.getItem(pushOwnerKey);}catch{return null;}
}
function rememberPushOwner(id){
  try{if(id)localStorage.setItem(pushOwnerKey,id);else localStorage.removeItem(pushOwnerKey);}catch{}
}
async function preparePush(){
  if(!account||!supportsPush())return null;
  if(!pushPreparation)pushPreparation=(async()=>{
    await navigator.serviceWorker.register('/stockroom-sw.js');
    pushRegistration=await navigator.serviceWorker.ready;
    const existing=await pushRegistration.pushManager.getSubscription();
    if(existing&&(storedPushOwner()!==account.id||Notification.permission!=='granted')){
      await existing.unsubscribe();
      rememberPushOwner(null);
    }else deviceSubscription=existing;
    renderNotifications();
    return pushRegistration;
  })().catch(error=>{pushPreparation=null;throw error;});
  return pushPreparation;
}
function pushKey(value){
  const base64=value.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(base64+'='.repeat((4-base64.length%4)%4)),char=>char.charCodeAt(0));
}
async function disablePush(){
  const subscription=deviceSubscription;
  if(!subscription)return;
  // Remove the browser subscription even if the app server is temporarily unreachable.
  await subscription.unsubscribe();
  deviceSubscription=null;
  rememberPushOwner(null);
  await api('/api/push/device',{method:'DELETE',body:JSON.stringify({endpoint:subscription.endpoint})}).catch(()=>{});
}
function openNotificationTab(tab){
  if(!pushTabs.includes(tab))return;
  if(['Sale receipts','Admin'].includes(tab)&&account?.role!=='admin')return;
  if(document.querySelector('dialog[open]:not(#notificationsDialog)')){toast('You have a Stockroom update. Open Notifications when you finish editing.');return;}
  closePanel($('notificationsDialog'));
  navigate(tab);
}
function initialiseNotifications(){
  const dialog=$('notificationsDialog'), button=$('notificationToggle'), status=$('notificationStatus'), test=$('notificationTest');
  const bell=$('notificationBell');
  bell.onclick=()=>{
    if(!account||!db||dialog.open)return;
    status.textContent='';
    const appleMobile=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const installed=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
    $('notificationDeviceHelp').textContent=appleMobile&&!installed
      ?'On iPhone or iPad, choose Share → Add to Home Screen, open Stockroom from the new icon, then enable push here.'
      :'Enable push here and send a test. To check the chat shortcut, choose a conversation, leave Stockroom, then tap the notification.';
    openPanel(dialog);
    renderNotifications();
    loadNotificationReads().catch(()=>{});
    loadFriends().then(renderNotifications).catch(()=>{});
    loadSaleReceipts().then(renderNotifications).catch(()=>{});
    loadImportNoticeStatus().catch(()=>{});
    preparePush().catch(()=>{status.textContent='Push could not start on this browser.';});
  };
  $('markNotificationsRead').onclick=async event=>{
    const control=event.currentTarget;
    control.disabled=true;
    try{await markNotificationKeys(notificationItems().flatMap(entry=>entry.unreadKeys));}
    catch(error){toast(error.message);}
    finally{control.disabled=false;}
  };
  dialog.addEventListener('click',event=>{
    const row=event.target.closest('[data-notification-entry]');
    const entry=row&&notificationItems().find(item=>item.id===row.dataset.notificationEntry);
    if(!entry)return;
    markNotificationKeys(entry.unreadKeys).catch(error=>toast(error.message));
    if(entry.chat)openChatLink(entry.chat);else openNotificationTab(entry.tab);
  });
  button.onclick=async()=>{
    button.disabled=true;
    status.textContent='';
    try{
      if(deviceSubscription){await disablePush();status.textContent='Push is off on this device.';return;}
      if(!supportsPush()){
        status.textContent='This browser does not support push here. On iPhone or iPad, add Stockroom to your Home Screen and open it from there.';
        return;
      }
      // Request permission directly from the click, before waiting on the network.
      const permission=await Notification.requestPermission();
      if(permission!=='granted'){
        status.textContent='Notification permission was not granted. You can enable it in your device or browser settings.';
        return;
      }
      const registration=await preparePush();
      const {publicKey}=await api('/api/push/config');
      const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushKey(publicKey)});
      try{
        await api('/api/push/device',{method:'PUT',body:JSON.stringify(subscription.toJSON())});
      }catch(error){await subscription.unsubscribe().catch(()=>{});throw error;}
      deviceSubscription=subscription;
      rememberPushOwner(account.id);
      status.textContent='Push is on for this device. Send a test to check delivery.';
    }catch(error){status.textContent=error.message||'Push could not be enabled.';}
    finally{button.disabled=false;renderNotifications();}
  };
  test.onclick=async()=>{
    if(!deviceSubscription)return;
    test.disabled=true;
    status.textContent='';
    try{
      const chat=$('notificationTestChat').value;
      await api('/api/push/test',{method:'POST',body:JSON.stringify({endpoint:deviceSubscription.endpoint,...(chat?{chat}:{})})});
      status.textContent='The push service accepted the test. Tap it to open '+(chat?'the selected chat.':'Dashboard.');
    }catch(error){status.textContent=error.message;}
    finally{test.disabled=false;}
  };
  document.addEventListener('click',async event=>{
    const toggle=event.target.closest('[data-vinted-toggle]');
    if(!toggle||toggle.disabled||account?.role!=='admin'||isReadOnly()||!vintedConnection)return;
    toggle.disabled=true;
    try{
      const result=await api('/api/sync-status',{method:'PUT',body:JSON.stringify({enabled:!vintedConnection.email.enabled})});
      vintedConnection={...vintedConnection,email:result.email};
      renderVintedEmail();
      toast(result.email.enabled?'Vinted imports enabled. The next check will verify Gmail.':'Vinted imports paused.');
    }catch(error){toast(error.message);}
    finally{toggle.disabled=false;}
  });
  setInterval(()=>{
    if(document.hidden||!account||isReadOnly())return;
    loadNotificationReads().catch(()=>{});
    if(account.role!=='admin')return;
    loadImportNoticeStatus().catch(()=>{});
    loadSaleReceipts().catch(()=>{});
  },60000);
  navigator.serviceWorker?.addEventListener('message',event=>{
    if(event.data?.type==='stockroom-notification'){
      if(event.data.chat)openChatLink(event.data.chat);else openNotificationTab(event.data.tab);
    }
    if(event.data?.type==='stockroom-update'){
      if(event.data.tab==='Stock')void refreshImports();
      else if(event.data.tab==='Sale receipts')loadSaleReceipts().catch(()=>{});
      else if(event.data.tab==='Admin')loadImportNoticeStatus().catch(()=>{});
      else if(event.data.tab==='Vinted updates')loadGmail().catch(()=>{});
      else if(event.data.tab==='Profile'){
        loadFriends().catch(()=>{});
        if(currentChat?.friend.id===event.data.chat&&!document.hidden)chatUpdate(currentChat);
      }
    }
  });
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href^="/cdn-cgi/access/logout"]');
    if(!link||!deviceSubscription)return;
    event.preventDefault();
    const endpoint=deviceSubscription.endpoint;
    const clear=fetch('/api/push/device',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint}),keepalive:true}).catch(()=>{});
    deviceSubscription.unsubscribe().catch(()=>{}).finally(()=>{
      deviceSubscription=null;
      rememberPushOwner(null);
      window.top.location.href=link.href;
    });
    void clear;
  });
}
