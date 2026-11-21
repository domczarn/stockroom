'use strict';
let settingsSection='account';
const settingsSections=[['account','Account','Sign-in and cloud sync'],['plan','Plan & billing','Free or Pro'],['privacy','Profile & privacy','Username and sharing'],['connections','Connections','Gmail and Vinted imports'],['notifications','Notifications','Alerts on this device'],['data','Data & backups','Export and restore'],['advanced','Advanced','Legacy tools and administration']];
function parkNotificationPreferences(){const node=$('deviceNotificationPreferences'),home=$('notificationPreferencesHome');if(node&&home&&node.parentNode!==home)home.append(node);}
function settingsPanel(id,title,description,body){return '<section class="panel settings-panel" data-settings-panel="'+id+'" '+(id===settingsSection?'':'hidden')+'><div class="settings-panel-heading"><h2 id="settingsHeading-'+id+'">'+title+'</h2><p>'+description+'</p></div>'+body+'</section>';}
function organisedSettings(){
 const conflict=pendingLocal?'<section class="panel conflict-panel"><h2>'+(cloudConflict?'A newer version exists':'Your change needs saving')+'</h2><p>Export your unsaved changes before using the latest cloud version.</p><div class="account-actions"><button class="secondary" id="exportPending">Export unsaved changes</button>'+(!cloudConflict?'<button class="action" id="retrySave">Retry save</button>':'')+'<button class="secondary" id="loadLatest">Use latest cloud data</button></div></section>':'';
 return conflict+'<div class="settings-layout"><div class="settings-navigation" role="navigation" aria-label="Settings sections">'+settingsSections.map(([id,title,description])=>'<button type="button" data-settings-section="'+id+'" aria-controls="settingsHeading-'+id+'" '+(id===settingsSection?'aria-current="page"':'')+'><strong>'+title+'</strong><small>'+description+'</small></button>').join('')+'</div><div class="settings-content">'+
 settingsPanel('account','Account','Your sign-in, workspace connection and app installation.','<div class="settings-identity"><strong>'+esc(account.email)+'</strong><span class="tag">'+(account.role==='admin'?'Administrator':'Member')+'</span></div>'+securityPanel()+'<div class="mini-stat"><span>Sign-in</span><b>Email code or passkey</b></div><div class="mini-stat"><span>Cloud sync</span><b>'+(cloudConflict?'Conflict needs attention':pendingLocal?'Unsaved changes':cloudAvailable?'Connected':'Reconnecting')+'</b></div><p>Your stock, orders, sales and expenses sync to your own account.</p><p class="footnote"><a href="/privacy.html" target="_blank">Privacy policy</a> · <a href="/terms.html" target="_blank">Terms of use</a> · <a href="mailto:info@bookednpaid.com">info@bookednpaid.com</a></p><div class="account-actions"><button class="secondary" id="checkCloud">Check sync</button><button class="secondary" data-install-app>Install Stockroom</button></div>')+
 settingsPanel('plan','Plan & billing','Free covers 20 new items a month. Pro is unlimited, with Gmail auto-updates and Pip AI.',billingPanel())+
 settingsPanel('privacy','Profile & privacy','Choose how you appear and what you share with the community.',profileSettingsForm())+
 settingsPanel('connections','Connections','Manage the inbox that receives your Vinted receipts.',gmailView(true)+(account.role==='admin'?vintedEmailPanel():''))+
 settingsPanel('notifications','Notifications','Manage message and import alerts for this browser or installed app.','<div class="weekly-box" id="weeklyBox"><label class="adm-switch"><input type="checkbox" id="weeklyToggle" checked><span></span><div><b>Weekly Pip report by email</b><small>Every Monday: last week’s sales, profit, stale stock and Pip’s tip.</small></div></label><button type="button" class="secondary" id="weeklyPreview">Send me this week’s report now</button></div><div class="settings-action-row sound-row"><span><strong>Pip notification sound</strong><small>Plays when stock or Vinted updates arrive while Stockroom is open.</small></span><span class="sound-actions"><button type="button" class="secondary" data-sound-test>Play</button><button type="button" class="secondary" data-sound-toggle aria-pressed="'+(soundOn()?'true':'false')+'">'+(soundOn()?'On':'Off')+'</button></span></div><div id="settingsNotificationsHost"></div>')+
 settingsPanel('data','Data & backups','Keep a complete copy of your workspace, including stock photos.','<div class="settings-action-row"><div><h3>Export full backup</h3><p>Download stock, bulk orders, sales, expenses and photos.</p></div><button class="secondary" id="exportAccount">Export backup</button></div><div class="settings-action-row"><div><h3>Delete my account</h3><p>Removes your stock, sales, photos and sign-ins for good, and cancels any subscription. Export a backup first.</p></div><button class="secondary stock-delete" id="deleteMyAccount" '+(account.role==='admin'?'disabled title="The owner account can’t be deleted"':'')+'>Delete account</button></div><div class="settings-action-row"><div><h3>Restore a backup</h3><p>Replaces this account’s current workspace across devices. Export a backup first.</p></div><button class="secondary" id="restoreSettings" '+(isReadOnly()?'disabled':'')+'>Restore backup</button></div>')+
 settingsPanel('advanced','Advanced','Occasional tools, kept separate from everyday settings.',(account.role==='admin'?'<details class="advanced-settings"><summary>Move legacy device data</summary><p>Import data from a browser used before cloud sync. You will be asked before replacing cloud data; the local copy is retained.</p><button class="secondary" id="migrateDevice">Import legacy device data</button></details><div class="settings-action-row"><div><h3>Member administration</h3><p>Review member workspaces and suspend or reactivate access.</p></div><button class="secondary" data-tab="Admin">Manage members</button></div>':'<p>No advanced tools are needed for this account.</p>'))+'</div></div>';
}
function connectSettings(){if(tab!=='Account')return;if(settingsSection==='account'&&securityKeys===null)setTimeout(()=>loadPasskeys(),0);if(settingsSection==='plan')void loadBilling();if(settingsSection==='notifications')void loadWeekly();const node=$('deviceNotificationPreferences');if(node)$('settingsNotificationsHost').append(node);renderNotifications();if(settingsSection==='connections')void loadGmail().catch(error=>{if($('gmailCheckMessage'))$('gmailCheckMessage').textContent=error.message;});if(settingsSection==='notifications')refreshSettingsNotifications();}
function refreshSettingsNotifications(){const apple=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1),installed=matchMedia('(display-mode: standalone)').matches||navigator.standalone;$('notificationDeviceHelp').textContent=apple&&!installed?'On iPhone or iPad, add Stockroom to your Home Screen and open it there to enable push.':'Push preferences apply to this device. Enable alerts here, then send a test to check delivery.';void preparePush().then(renderNotifications).catch(()=>{$('notificationStatus').textContent='Push could not start on this browser.';});}
document.addEventListener('click',event=>{const b=event.target.closest('[data-settings-section]');if(!b)return;const section=b.dataset.settingsSection;if(!settingsSections.some(([id])=>id===section))return;settingsSection=section;if($('notificationsDialog')?.open)$('notificationsDialog').close();if(tab!=='Account')navigate('Account');else{for(const panel of document.querySelectorAll('[data-settings-panel]'))panel.hidden=panel.dataset.settingsPanel!==section;for(const button of document.querySelectorAll('.settings-navigation [data-settings-section]')){if(button.dataset.settingsSection===section)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}connectSettings();}const heading=$('settingsHeading-'+section);if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}});

// Sign-in & security: passkeys (Face ID / Touch ID / fingerprint) and signing out.
let securityKeys=null;
function securityPanel(){
  const list=securityKeys===null?'<p class="footnote">Loading passkeys…</p>':securityKeys.length?'<ul class="passkey-list">'+securityKeys.map(k=>'<li><span><strong>'+esc(k.name||'Passkey')+'</strong><small>Added '+esc(String(k.created_at).slice(0,10))+'</small></span><button type="button" class="link" data-passkey-remove="'+esc(k.id)+'">Remove</button></li>').join('')+'</ul>':'<p class="footnote">No passkeys yet. Add one to sign in with Face ID, Touch ID or your fingerprint.</p>';
  return '<div class="security-box" id="securityBox"><div class="settings-action-row"><div><h3>Passkeys</h3><p>Sign in without codes on this device.</p></div><button type="button" class="secondary" data-passkey-add>Add passkey</button></div>'+list+
    '<div class="settings-action-row"><div><h3>Sign out</h3><p>Sign out of Stockroom on this device.</p></div><button type="button" class="secondary" data-sign-out>Sign out</button></div></div>';
}
async function loadPasskeys(remove){
  try{const r=await fetch('/auth/passkeys',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(remove?{remove}:{})});securityKeys=r.ok?(await r.json()).passkeys:[];}catch{securityKeys=[];}
  const box=$('securityBox');if(box)box.outerHTML=securityPanel();
}
function loadPasskeyKit(){return window.stockroomPasskeys?Promise.resolve():new Promise((ok,fail)=>{const s=document.createElement('script');s.src='/passkeys.js';s.onload=ok;s.onerror=fail;document.head.append(s);});}
document.addEventListener('click',async event=>{
  if(event.target.closest('[data-sign-out]')){
    await fetch('/auth/logout',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'}).catch(()=>{});
    await clearDeviceData();
    location.href='/login';return;
  }
  const remove=event.target.closest('[data-passkey-remove]');
  if(remove){if(confirm('Remove this passkey? You can still sign in with an email code.'))await loadPasskeys(remove.dataset.passkeyRemove);return;}
  const add=event.target.closest('[data-passkey-add]');
  if(!add)return;
  add.disabled=true;
  try{
    await loadPasskeyKit();
    if(!window.stockroomPasskeys.browserSupportsWebAuthn())throw Error('This browser can’t use passkeys.');
    const post=async(path,body)=>{const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Couldn’t add a passkey.');return d;};
    const {options,challengeId}=await post('/auth/passkey/register/options');
    const response=await window.stockroomPasskeys.startRegistration({optionsJSON:options});
    await post('/auth/passkey/register/verify',{challengeId,response,name:/iPhone|iPad/.test(navigator.userAgent)?'iPhone':/Mac/.test(navigator.userAgent)?'Mac':/Android/.test(navigator.userAgent)?'Android':'This device'});
    toast('Passkey added. Next time, sign in with Face ID or your fingerprint.');
    await loadPasskeys();
  }catch(error){if(error?.name!=='NotAllowedError'&&error?.name!=='AbortError')toast(error.message||'Couldn’t add a passkey.');}
  finally{add.disabled=false;}
});
document.addEventListener('click',event=>{if(event.target.closest('[data-settings-section="account"]'))setTimeout(()=>loadPasskeys(),0);if(event.target.closest('[data-settings-section="plan"]'))setTimeout(()=>loadBilling(),0);});

// Weekly Pip report preference and preview.
async function loadWeekly(){try{const r=await api('/api/pip/weekly');const t=$('weeklyToggle');if(t)t.checked=r.weekly;}catch{}}
document.addEventListener('change',async event=>{if(event.target.id!=='weeklyToggle')return;try{await api('/api/pip/weekly',{method:'PUT',body:JSON.stringify({weekly:event.target.checked})});toast(event.target.checked?'Weekly report switched on.':'Weekly report switched off.');}catch(error){toast(error.message);event.target.checked=!event.target.checked;}});
document.addEventListener('click',async event=>{const b=event.target.closest('#weeklyPreview');if(!b)return;b.disabled=true;try{await api('/api/pip/weekly/preview',{method:'POST',body:'{}'});toast('Sent. Check your inbox.');}catch(error){toast(error.message);}finally{b.disabled=false;}});
document.addEventListener('click',event=>{if(event.target.closest('[data-settings-section="notifications"]'))setTimeout(()=>loadWeekly(),0);});

// Removes everything Stockroom keeps on this device: offline cache, local copy of the workspace and preferences.
async function clearDeviceData(){
  try{for(const key of await caches.keys())if(key.startsWith('stockroom'))await caches.delete(key);}catch{}
  try{indexedDB.deleteDatabase('domczarn-stockroom');}catch{}
  try{Object.keys(localStorage).filter(k=>/^(stockroom|domczarn)/.test(k)).forEach(k=>localStorage.removeItem(k));}catch{}
}

document.addEventListener('click',async event=>{
  const b=event.target.closest('#deleteMyAccount');if(!b)return;
  const typed=prompt('This deletes your whole Stockroom account and cancels any subscription. It can’t be undone.\n\nType DELETE to confirm.');
  if(typed!=='DELETE'){if(typed!==null)toast('Account not deleted. You need to type DELETE.');return;}
  b.disabled=true;
  try{await api('/api/account/delete',{method:'POST',body:JSON.stringify({confirm:'DELETE'})});await clearDeviceData();location.href='/login';}
  catch(error){toast(error.message);b.disabled=false;}
});
