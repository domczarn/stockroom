'use strict';
const $=id=>document.getElementById(id), gbp=n=>n==null?'—':new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(n);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key='domczarn.stock.v1';let db,tab=pushTabs.includes(new URLSearchParams(location.search).get('open'))?new URLSearchParams(location.search).get('open'):'Dashboard',filter='All',query='',edit=null;
let syncBusy = false;
let storage, draftPhotos = [], photoBusy = false, saveBusy = false;
async function openStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('domczarn-stockroom', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function readSaved() {
  return new Promise((resolve, reject) => {
    const request = storage.transaction('workspace').objectStore('workspace').get(account ? account.id+':'+workspaceOwner : 'data');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function writeSaved(data) {
  return new Promise((resolve, reject) => {
    const transaction = storage.transaction('workspace', 'readwrite');
    transaction.objectStore('workspace').put(data, account.id+':'+workspaceOwner);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
let account=null, workspaceOwner='', cloudRevision=null, cloudSaving=false, cloudConflict=false, cloudAvailable=false, pendingLocal=null, cloudPolling=false, sortBy=(()=>{try{return localStorage.getItem('stockroom-sort')||'newest';}catch{return 'newest';}})(), members=[], adminEvents=[];
const emptyData=()=>({items:[],sales:[],expenses:[],research:[],sources:[]});
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4500);}
function cloudState(message,kind=''){const el=$('cloudStatus');el.textContent=message;el.dataset.state=kind;el.setAttribute('aria-label','Cloud sync: '+message);}
async function api(path,options={}){
  const response=await fetch(path,{...options,cache:'no-store',credentials:'same-origin',headers:{...(options.body?{'content-type':'application/json'}:{}),...options.headers}});
  if(response.status===403&&account?.role==='member'&&path==='/api/workspace')location.reload();
  if(!response.ok){let message='Request failed. Try again.';try{message=(await response.json()).error||message;}catch{} const error=Error(message);error.status=response.status;throw error;}return response.json();
}
function isReadOnly(){return workspaceOwner!==account?.id;}
async function pendingRecord(value,write=false){
 if(!storage)return null;
 return new Promise((resolve,reject)=>{const tx=storage.transaction('workspace',write?'readwrite':'readonly'),store=tx.objectStore('workspace'),key='pending:'+account.id;const r=write?(value?store.put(value,key):store.delete(key)):store.get(key);r.onsuccess=()=>{if(!write)resolve(r.result);};tx.oncomplete=()=>{if(write)resolve();};tx.onerror=()=>reject(tx.error);});
}
async function persist(next=db){
  if(isReadOnly())throw Error('This account is read-only. Return to your workspace to edit.');
  if(cloudSaving)throw Error('A save is in progress. Please try again.');
  if(pendingLocal && next!==pendingLocal)throw Error('An unsaved change is waiting. Open Settings to retry or discard it first.');
  if(cloudConflict)throw Error('Resolve the sync conflict in Settings before saving. Your changes are still here.');
  cloudSaving=true;cloudState('Saving…','saving');
  pendingLocal=cloneWorkspace(next);
  await pendingRecord({data:pendingLocal,revision:cloudRevision},true).catch(()=>{});
  try{
    const result=await api('/api/workspace',{method:'PUT',body:JSON.stringify({data:next,revision:cloudRevision})});
    db=result.data;cloudRevision=result.revision;cloudAvailable=true;pendingLocal=null;await pendingRecord(null,true).catch(()=>{});
    try{await writeSaved(db);}catch{/* Cloud is authoritative even if this device cannot cache it. */}
    render();cloudState('Synced to cloud','saved');$('saveState').textContent='Saved across devices';
  }catch(error){
    if(error.status===409){cloudConflict=true;cloudState('Resolve sync conflict','error');toast('Another device saved newer data. Your edits are kept. Open Settings to resolve.');}
    else{cloudAvailable=false;cloudState('Not saved · retry','error');}
    throw error;
  }finally{cloudSaving=false;}
}
async function syncCloud(force=false){
  if(!account||switchingWorkspace||cloudSaving||cloudPolling||cloudConflict||pendingLocal)return;
  if(!force&&(document.hidden||document.querySelector('dialog[open]')||document.activeElement?.matches('input,select,textarea')))return;
  cloudPolling=true;const startingRevision=cloudRevision,startingOwner=workspaceOwner;
  try{
    const result=await api('/api/workspace'+(isReadOnly()?'?owner='+encodeURIComponent(workspaceOwner):''));
    // Never replace a form or a local save that began during the network read.
    if(switchingWorkspace||startingRevision!==cloudRevision||startingOwner!==workspaceOwner||cloudSaving||pendingLocal||document.querySelector('dialog[open]')||(!force&&document.activeElement?.matches('input,select,textarea')))return;
    if(result.data&&result.revision!==cloudRevision){db=result.data;cloudRevision=result.revision;await writeSaved(db).catch(()=>{});render();}
    cloudAvailable=true;cloudState(isReadOnly()?'Admin · read-only':'Synced to cloud','saved');
  }catch(error){cloudAvailable=false;cloudState(error.status===401?'Sign in required':'Offline · edits need connection','error');}
  finally{cloudPolling=false;}
}
let switchingWorkspace=false;
async function switchWorkspace(owner){
  if(owner===workspaceOwner){$('workspacePicker').open=false;return;}
  if(cloudSaving||pendingLocal||switchingWorkspace||document.querySelector('dialog[open]')){
    toast('Finish your current edit before switching workspaces.');return;
  }
  switchingWorkspace=true;
  try{
    const result=await api('/api/workspace'+(owner!==account.id?'?owner='+encodeURIComponent(owner):''));
    if(cloudSaving||pendingLocal||document.querySelector('dialog[open]'))throw Error('Finish your current edit before switching workspaces.');
    workspaceOwner=owner;cloudRevision=result.revision;resetStockFilters();stockAgeView=false;resetStockSelection();
    db=result.data||emptyData();tab='Dashboard';$('workspacePicker').open=false;
    render();cloudState(isReadOnly()?'Admin · read-only':'Synced to cloud','saved');
    window.scrollTo(0,0);
  }finally{switchingWorkspace=false;}
}
function workspacePickerView(loading=false){
  const picker=$('workspacePicker');
  picker.hidden=account?.role!=='admin';
  const member=members.find(row=>row.user_id===workspaceOwner);
  $('workspaceLabel').textContent=isReadOnly()?(member?.name||'Member workspace')+' · read-only':'Your cloud workspace';
  if(picker.hidden)return;
  const choice=(id,label,detail)=>'<button type="button" data-workspace-choice="'+esc(id)+'" '+(id===workspaceOwner?'aria-current="true"':'')+'><strong>'+esc(label)+'</strong><small>'+esc(detail)+'</small></button>';
  $('workspaceChoices').innerHTML=choice(account.id,'My Stockroom','Main account')+
    (loading?'<p role="status">Loading member accounts…</p>':members.filter(row=>row.user_id&&row.status==='active').map(row=>choice(row.user_id,row.name,'Member · read-only')).join('')+
      (members.some(row=>row.user_id&&row.status==='active')?'':'<p>No active member workspaces yet.</p>'))+
    '<button type="button" data-tab="Admin"><strong>Manage accounts</strong><small>Manage member access</small></button>';
}
async function initialiseWorkspacePicker(){
  const picker=$('workspacePicker');
  picker.addEventListener('toggle',async()=>{
    if(!picker.open||account?.role!=='admin')return;
    workspacePickerView(true);
    try{
      const result=await api('/api/admin/members');
      members=result.members;
      if(picker.open)workspacePickerView();
    }catch(error){if(picker.open)$('workspaceChoices').textContent=error.message;}
  });
  picker.addEventListener('click',event=>{
    const choice=event.target.closest('[data-workspace-choice]');
    if(choice)switchWorkspace(choice.dataset.workspaceChoice).catch(error=>toast(error.message));
    if(event.target.closest('[data-tab]'))picker.open=false;
  });
  document.addEventListener('click',event=>{if(picker.open&&!picker.contains(event.target))picker.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&picker.open){picker.open=false;picker.querySelector('summary').focus();}});
}
function accountView(){return organisedSettings();}
async function loadAdmin(){const [m,a]=await Promise.all([api('/api/admin/members'),api('/api/admin/audit')]);members=m.members;adminEvents=a.events;}
function adminView(){
  return '<section class="panel"><span class="eyebrow">ACCESS CONTROL</span><h2>Your members</h2><p>Members get a separate workspace on first sign-in.</p><p class="footnote">You can review member workspaces here in read-only mode and suspend or reactivate access.</p></section>'+table(['Member','Status','Last saved','Actions'],members.map(m=>'<tr><td><b>'+esc(m.name)+'</b><br><small>'+esc(m.email)+'</small></td><td><span class="tag '+(m.status==='suspended'?'pending':'')+'">'+esc(m.status)+'</span></td><td>'+esc(m.updated_at?new Date(m.updated_at).toLocaleString('en-GB'):'Not yet saved')+'</td><td>'+(m.user_id?'<button class="secondary" data-view-member="'+esc(m.user_id)+'">View account</button>':'<span class="muted">Awaiting first sign-in</span>')+'<button class="link" data-member-toggle="'+esc(m.email)+'">'+(m.status==='active'?'Suspend':'Reactivate')+'</button></td></tr>').join('')||'<tr><td colspan="4">Members appear here after their first sign-in.</td></tr>')+'<section class="panel audit-panel"><h2>Security activity</h2>'+adminEvents.slice(0,15).map(e=>'<div class="mini-stat"><span>'+esc(e.action.replace(/_/g,' '))+'</span><time>'+esc(new Date(e.created_at).toLocaleString('en-GB'))+'</time></div>').join('')+'</section>';
}
function downloadJSON(data,name='stockroom-backup.json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function fullBackup(data=db){const copy=cloneWorkspace(data);for(const item of copy.items)for(let i=0;i<(item.photos||[]).length;i++){if(!item.photos[i].startsWith('/api/media/'))continue;const r=await fetch(item.photos[i]);if(!r.ok)throw Error('A photo could not be exported. Please try again.');const blob=await r.blob();item.photos[i]=await new Promise((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve(f.result);f.onerror=reject;f.readAsDataURL(blob);});}downloadJSON(copy);toast('Backup exported with your stock photos.');}

function proceeds(item) {
  if(item.status==='Sold'){
    const trade=lastTrade(db,item.id);
    return trade?saleRemaining(trade):item.sale;
  }
  return item.status==='Refunded'?item.refund:item.status==='In Stock'?item.price:null;
}
function profit(item) {
  const value=proceeds(item);
  if(value==null)return null;
  const trade=item.status==='Sold'&&lastTrade(db,item.id);
  if(trade)return pounds(cents(value)-cents(trade.cost)-trade.refunds.reduce((sum,r)=>sum+cents(r.postage),0));
  return value-item.cost;
}
function photoUrl(value) {
  return typeof value === 'string' && (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) || /^\/api\/media\/[^/]+\/[a-f0-9-]{36}$/.test(value)) ? value : '';
}
function todayUK() {
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({type,value})=>[type,value]));
  return values.year+'-'+values.month+'-'+values.day;
}
function daysUnsold(item, asOf = todayUK()) {
  if (item.status !== 'In Stock' || !/^\d{4}-\d{2}-\d{2}$/.test(item.purchasedAt || '')) return null;
  const start = Date.parse(item.purchasedAt+'T00:00:00Z');
  const end = Date.parse(asOf+'T00:00:00Z');
  if (!Number.isFinite(start) || start > end) return null;
  return Math.floor((end-start)/86400000);
}
function dateLabel(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return 'Add purchase date';
  return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));
}
function stockAge(item) {
  const days = daysUnsold(item);
  return '<div class="stock-age"><span>Purchased '+esc(dateLabel(item.purchasedAt))+'</span>'+
    (days === null ? '' : '<span class="'+(days>=45?'age-warning':'')+'">'+days+' days unsold</span>')+'</div>'+
    (item.listingNotes || item.notes ? '<div class="stock-note" title="'+esc(item.listingNotes || item.notes)+'">✎ '+esc((item.listingNotes || item.notes).slice(0,100))+'</div>' : '');
}
function row(i) {
  const result = profit(i);
  const order=i.status==='Sold'&&lastTrade(db,i.id);
  const roiCost=order?order.cost:i.cost;
  const photo = photoUrl(i.photos?.[0]);
  const reference = referenceUrl(i.referencePhotos?.[0]?.url);
  const thumbnail = photo
    ? '<button class="photo-button" data-photo="' + esc(i.id) + '" aria-label="View photo of ' + esc(i.name) + '"><img class="thumb" src="' + photo + '" alt="" loading="lazy"></button>'
    : reference ? '<button class="photo-button reference-thumb" data-reference="' + esc(i.id) + '" aria-label="View reference photo"><img class="thumb" src="' + reference + '" alt="" loading="lazy"><span>Reference</span></button>'
    : '<button class="photo-button" data-edit="' + esc(i.id) + '" aria-label="Add photos to ' + esc(i.name) + '"><span class="no-photo">＋<br>Add photo</span></button>';
  const picker=stockSelectionBox(i);
  return '<tr data-stock-entry><td><div class="item-cell">' + picker + thumbnail + '<div class="item-copy"><small>' + esc(i.brand) + ' · ' + esc(i.id) + '</small><button data-edit="' + esc(i.id) + '">' + esc(i.name) + '</button><div class="muted">' + esc([i.size, i.condition,i.stage].filter(Boolean).join(' · ')) + '</div>' + stockAge(i) + '</div></div></td>' +
    '<td><input aria-label="Total cost for ' + esc(i.name) + '" data-cost="' + esc(i.id) + '" type="number" inputmode="decimal" min="0" step=".01" value="' + esc(i.cost) + '"></td>' +
    '<td>' + (i.status === 'In Stock' ? '<input aria-label="Expected resale for ' + esc(i.name) + '" data-price="' + esc(i.id) + '" type="number" inputmode="decimal" min="0" step=".01" value="' + esc(i.price) + '">' : gbp(proceeds(i))) + '</td>' +
    '<td class="' + (result < 0 ? 'neg' : 'pos') + '">' + gbp(result) + '</td><td>' + (result == null || !roiCost ? '—' : (100 * result / roiCost).toFixed(1) + '%') +
    '</td><td><span class="tag ' + (i.status === 'Refund pending' ? 'pending' : '') + '">' + esc(order?tradeStatus(order):i.status) + '</span></td><td><div class="stock-row-actions">'+stockNextAction(i)+stockMore(i)+'</div></td></tr>';
}
const table=(heads,body,attributes='')=>'<article '+attributes+'><table><thead><tr>'+heads.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></article>';
const total = (rows, get) => rows.reduce((sum, row) => sum + get(row), 0);
function finances(data) {
  const sold = data.items.filter(item => item.status === 'Sold' && Number.isFinite(item.sale));
  const summary=reportTotals(accountingRows(data));
  const {revenue,missing}=summary;
  const knownCost=summary.cost;
  const expenses=total(data.expenses,row=>row[1]);
  const returnAdjustment=expenses-summary.expense;
  const active = data.items.filter(item => !item.deletedAt && item.status === 'In Stock');
  const priced = active.filter(item => Number.isFinite(item.price));
  return {sold, revenue, knownCost, missing, expenses, returnAdjustment,
    realised: summary.profit,
    active, priced, inventory: total(active, item => item.cost),
    potential: total(priced, item => item.price - item.cost),
    pending: data.items.filter(item => !item.deletedAt && item.status === 'Refund pending')};
}
function metric(label, value, note, className = '') {
  return '<div class="metric ' + className + '"><span>' + label + '</span><strong>' + value + '</strong><small>' + note + '</small></div>';
}
function dailyActions() {
  const today=todayUK();
  const trades=new Map((db.trades||[]).map(trade=>[trade.itemId,trade]));
  const stock=db.items.filter(item=>!item.deletedAt);
  const shipments=stock.map(item=>({item,trade:trades.get(item.id)}))
    .filter(({item,trade})=>item.status==='Sold'&&trade&&tradeStatus(trade)==='Sold'&&saleRemaining(trade)>0)
    .sort((a,b)=>a.trade.soldAt.localeCompare(b.trade.soldAt));
  const reviewed=new Set(db.receiptsReviewed||[]);
  const saleQueue=account.role==='admin'?saleReceipts.filter(row=>!reviewed.has(row.id)):[];
  const gmailQueue=personalGmail?.connection?.receipts.filter(row=>!row.reviewed)||[];
  const stale=stock.map(item=>({item,days:daysListed(item,today)}))
    .filter(({days})=>days>=30).sort((a,b)=>b.days-a.days);
  const entry=(name,detail,action)=>'<button class="daily-row" type="button" '+action+'><span><strong>'+esc(name)+
    '</strong><small>'+esc(detail)+'</small></span><span aria-hidden="true">↗</span></button>';
  const tradeAction=(action,id)=>'data-trade="'+action+'" data-stock-id="'+esc(id)+'"';
  const card=(key,title,rows,empty,link='')=>!rows.length?'':'<article class="daily-card" data-daily-card="'+key+'"><div class="daily-card-head"><h3>'+
    title+'</h3><span class="daily-count">'+rows.length+'</span></div>'+
    (rows.length?rows.slice(0,2).join(''):'<p>'+empty+'</p>')+
    (rows.length>2?'<details><summary>Show '+(rows.length-2)+' more</summary>'+rows.slice(2).join('')+'</details>':'')+link+'</article>';
  return card('ship','Ship next',shipments.map(({item,trade})=>entry(item.name,'Sold '+dateLabel(trade.soldAt),tradeAction('post',item.id))),'No orders waiting for postage.')+
    card('receipts','Review receipts',[
      ...saleQueue.map(row=>entry(row.name,'Sale receipt · '+row.stage,tradeAction('receipt',row.id))),
      ...gmailQueue.map(row=>entry(row.subject,'Gmail · '+row.category,'data-gmail-jump="'+esc(row.id)+'"'))
    ],saleReceiptsLoaded||account.role!=='admin'?(personalGmail?'No receipts waiting for review.':'Checking your Vinted inbox…'):'Checking for sale receipts…',
      !personalGmail?.connection?'<button type="button" class="link daily-link" data-settings-section="connections">Set up Gmail ↗</button>':'')+
    card('refunds','Chase refunds',stock.filter(item=>item.status==='Refund pending')
      .map(item=>entry(item.name,gbp(item.cost)+' purchase cost','data-edit="'+esc(item.id)+'"')),'No purchase refunds pending.')+
    card('reprice','Reprice stale stock',stale.map(({item,days})=>entry(item.name,days+' days listed'+
      (Number.isFinite(item.price)?' · '+gbp(item.price):''),'data-reprice="'+esc(item.id)+'"')),'No items listed for 30 days or more.');
}

function renderDailyActions(){
  const target=$('dailyActionCards');
  if(!target)return;
  const markup=dailyActions();
  if(target.dataset.markup===markup)return;
  const open=[...target.querySelectorAll('details[open]')].map(details=>details.closest('[data-daily-card]').dataset.dailyCard);
  target.innerHTML=markup;
  target.dataset.markup=markup;
  target.querySelectorAll('details').forEach(details=>{details.open=open.includes(details.closest('[data-daily-card]').dataset.dailyCard);});
}

function recordedSpending(data) {
  const orders = (data.bulkOrders || []).filter(order => order.stage !== 'Cancelled');
  const orderIds = new Set(orders.map(order => order.id));
  const soldIds = new Set((data.trades || []).map(trade => trade.itemId));
  const individual = data.items.filter(item =>
    !orderIds.has(item.bulkOrderId) &&
    (!item.deletedAt || item.status === 'Sold' || soldIds.has(item.id))
  );
  const clothing = orders.reduce((sum, order) => sum + orderTotal(order), 0) +
    individual.reduce((sum, item) => sum + cents(item.cost), 0);
  const overhead = data.expenses.reduce((sum, row) => sum + cents(row[1]), 0);
  return { clothing: pounds(clothing), overhead: pounds(overhead), total: pounds(clothing + overhead) };
}

function dashboard() {
  const f = finances(db);
  const spend = recordedSpending(db);
  const clothingProfit = pounds(cents(f.revenue) - cents(f.knownCost));
  const provisional = f.missing ? 'Provisional · ' + f.missing + ' sale costs missing' : '';
  const breakdown = [
    ['Sales revenue', f.revenue],
    ['Cost of clothes sold', -f.knownCost],
    ['Clothing profit', clothingProfit],
    ['Business expenses', -spend.overhead],
    ...(f.returnAdjustment ? [['Return adjustments', f.returnAdjustment]] : []),
    ['Net profit', f.realised]
  ];
  const line = ([label, amount]) => '<div class="finance-line"><span>' + label + '</span><strong>' + gbp(amount || 0) + '</strong></div>';
  const openOrders = (db.bulkOrders || []).filter(order => ['Ordered','Dispatched'].includes(order.stage)).length;
  const rows = accountingRows(db);
  const soldCount = rows.filter(row => row.kind === 'Sale').length;
  return '<div class="finance-insights home-chart"><div id="financeChart">'+revenueChart(rows,todayUK())+'</div></div>'+pipBrainView()+
    (isReadOnly() ? '' : '<section class="daily-actions" aria-labelledby="dailyActionTitle"><div class="daily-heading"><h2 id="dailyActionTitle">To do</h2></div><div class="daily-grid" id="dailyActionCards"></div></section>');
}
function moneyDetail() {
  const f = finances(db);
  const spend = recordedSpending(db);
  const clothingProfit = pounds(cents(f.revenue) - cents(f.knownCost));
  const breakdown = [
    ['Sales revenue', f.revenue],
    ['Cost of clothes sold', -f.knownCost],
    ['Clothing profit', clothingProfit],
    ['Business expenses', -spend.overhead],
    ...(f.returnAdjustment ? [['Return adjustments', f.returnAdjustment]] : []),
    ['Net profit', f.realised]
  ];
  const line = ([label, amount]) => '<div class="finance-line"><span>' + label + '</span><strong>' + gbp(amount || 0) + '</strong></div>';
  const openOrders = (db.bulkOrders || []).filter(order => ['Ordered','Dispatched'].includes(order.stage)).length;
  const today = todayUK(), rows = accountingRows(db);
  return '<div class="finance-insights">'+financeProjection(rows,today)+platformReporting(db,today)+'</div>'+
    '<section class="finance-overview" aria-label="Spending overview">' +
    '<div class="finance-overview-heading"><h2>Spending</h2><span class="profit-period">All time</span></div>' +
    '<div class="finance-kpis">' +
    metric('Clothing spend', gbp(spend.clothing), 'Stock purchases and bulk orders') +
    metric('Business expenses', gbp(spend.overhead), 'Packaging, postage and other costs') +
    metric('Total spent', gbp(spend.total), 'Stock and business expenses', 'finance-net') +
    '</div></section>' +
    '<div class="finance-detail"><section class="panel"><div class="panel-heading"><h2>Profit breakdown</h2></div>' +
    '<div class="finance-lines">' + breakdown.map(line).join('') + '</div>' +
    '<p class="footnote">Clothing spend includes unsold stock. Profit uses the cost of clothes already sold.</p>' +
    (f.missing ? '<button class="link" data-tab="Activity">Review missing sale costs ↗</button>' : '') +
    '</section><section class="panel"><div class="panel-heading"><h2>Stock overview</h2><button class="secondary" data-tab="Stock">View stock</button></div>' +
    '<div class="finance-lines">' + [
      ['Available stock at cost', f.inventory],
      ['Expected resale value', total(f.priced, item => item.price)],
      ['Forecast stock profit', f.potential]
    ].map(line).join('') + '</div><p class="footnote">' + f.active.length + ' available · ' + f.priced.length + ' priced · ' + openOrders + ' bulk orders on the way</p>' +
    '<button class="link" data-tab="Orders">View bulk orders ↗</button></section></div>';
}
function activity() {
  const legacyRows = db.sales.map((row, index) => '<tr><td><span class="tag">Sale</span></td><td>' + esc(row[0]) + '</td><td>' + gbp(row[1]) + '</td><td>' + (Number.isFinite(row[3]) ? gbp(row[1]-row[3]) : '<span class="pending tag">Cost needed</span>') + '</td><td>' + esc(row[2]) + '</td><td><button class="link" data-ledger="sale" data-index="' + index + '">Edit</button><button class="link expense-remove" data-kind="sale" data-expense-remove="' + index + '">Remove</button></td></tr>');
  const expenseRows = db.expenses.map((row, index) => '<tr><td><span class="tag neutral-tag">Expense</span></td><td>' + esc(row[0]) + '</td><td>' + gbp(-row[1]) + '</td><td>—</td><td>Recorded</td><td><button class="link" data-ledger="expense" data-index="' + index + '">Edit</button><button class="link expense-remove" data-expense-remove="' + index + '">Remove</button></td></tr>');
  const stockSales = db.items.filter(item => item.status !== 'In Stock').map(item => '<tr><td><span class="tag">' + (item.status==='Sold'?'Sale':'Return') + '</span></td><td>' + esc(item.name) + '</td><td>' + gbp(proceeds(item)) + '</td><td>' + gbp(profit(item)) + '</td><td>' + esc(item.status) + '</td><td><button class="link" data-edit="' + esc(item.id) + '">Edit</button></td></tr>');
  const groups={all:[...legacyRows, ...expenseRows, ...stockSales],sales:[...legacyRows,...stockSales.filter(r=>r.includes('>Sale<'))],expenses:expenseRows,returns:stockSales.filter(r=>r.includes('>Return<'))};
  const counts={all:groups.all.length,sales:groups.sales.length,expenses:groups.expenses.length,returns:groups.returns.length};
  return '<div class="tools view-tools">'+viewTabs('activity',[['all','All'],['sales','Sales'],['expenses','Expenses'],['returns','Returns']],activityView,counts)+'<button class="secondary" data-ledger="expense">＋ Add expense</button></div>' +
    table(['Type','Item / description','Amount','Item profit','Status',''], groups[activityView].join('') || '<tr><td colspan="6">Nothing here yet.</td></tr>')+removedExpensesView('sale');
}
let expenseView='all', expenseCategory='All', activityView='all';
function viewTabs(kind,options,current,counts={}){
  return '<div class="view-tabs" role="tablist" aria-label="Filter">'+options.map(([key,label])=>'<button type="button" role="tab" data-view-'+kind+'="'+esc(key)+'" aria-selected="'+(key===current)+'">'+esc(label)+
    (counts[key]!==undefined?' <span class="view-count">'+counts[key]+'</span>':'')+'</button>').join('')+'</div>';
}
function clothingSpendRows(data){
  const orders=(data.bulkOrders||[]).filter(order=>order.stage!=='Cancelled');
  const orderIds=new Set(orders.map(order=>order.id));
  const soldIds=new Set((data.trades||[]).map(trade=>trade.itemId));
  const items=data.items.filter(item=>!orderIds.has(item.bulkOrderId)&&(!item.deletedAt||item.status==='Sold'||soldIds.has(item.id))&&Number(item.cost)>0)
    .map(item=>({name:item.name,brand:item.brand||'',date:item.purchasedAt||'',amount:Number(item.cost),kind:'Item',status:item.status}));
  const bulk=orders.map(order=>({name:order.supplier||order.reference||'Bulk order',brand:'',date:order.orderedAt||order.createdAt||'',amount:orderTotal(order),kind:'Bulk order',status:order.stage}));
  return [...items,...bulk].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
function expensesView() {
  const spend = recordedSpending(db);
  const thisMonth = total(db.expenses.filter(row=>row[4]?.startsWith(todayUK().slice(0,7))),row=>row[1]);
  const categories=[...new Set(db.expenses.map(row=>row[2]||'Other'))];
  const clothing=clothingSpendRows(db);
  const tabs=viewTabs('expense',[['all','Overview'],['clothing','Clothing'],['business','Business costs']],expenseView,{clothing:clothing.length,business:db.expenses.length});
  const expenseTable=rows=>table(['Description','Category','Date','Amount','Notes',''],rows.map(([row,index])=>
      '<tr><td>'+esc(row[0])+'</td><td><span class="tag neutral-tag">'+esc(row[2]||'Other')+'</span></td><td>'+esc(row[4]?dateLabel(row[4]):'Date needed')+
      '</td><td>'+gbp(row[1])+'</td><td class="expense-notes">'+esc(row[5]||'—')+'</td><td><button class="link" data-ledger="expense" data-index="'+index+'">Edit</button><button class="link expense-remove" data-expense-remove="'+index+'">Remove</button></td></tr>'
     ).join('')||'<tr><td colspan="6">Add your first expense to track business costs.</td></tr>');
  if(expenseView==='clothing'){
    return '<div class="tools view-tools">'+tabs+'</div><div class="metrics expense-metrics">'+metric('Clothing spend',gbp(spend.clothing),'Stock purchases and bulk orders','featured')+
      metric('Items bought',String(clothing.filter(r=>r.kind==='Item').length),'Individually purchased')+metric('Bulk orders',String(clothing.filter(r=>r.kind==='Bulk order').length),'Excluding cancelled')+'</div>'+
      table(['Item','Type','Date','Cost','Status'],clothing.map(r=>'<tr><td>'+esc(r.name)+(r.brand?'<small class="cell-sub">'+esc(r.brand)+'</small>':'')+'</td><td><span class="tag neutral-tag">'+esc(r.kind)+'</span></td><td>'+esc(r.date?dateLabel(String(r.date).slice(0,10)):'—')+'</td><td>'+gbp(r.amount)+'</td><td>'+esc(r.status||'—')+'</td></tr>').join('')||'<tr><td colspan="5">No clothing purchases recorded yet.</td></tr>');
  }
  if(expenseView==='business'){
    const chips=['All',...categories];
    const rows=db.expenses.map((row,index)=>[row,index]).filter(([row])=>expenseCategory==='All'||(row[2]||'Other')===expenseCategory);
    return '<div class="tools view-tools">'+tabs+'<button class="secondary" data-ledger="expense">＋ Add expense</button></div>'+
      '<div class="metrics expense-metrics">'+metric('Business costs',gbp(spend.overhead),db.expenses.length+' recorded','featured')+metric('This month',gbp(thisMonth),'By expense date')+'</div>'+
      '<div class="chip-row">'+chips.map(c=>'<button type="button" class="chip" data-expense-category="'+esc(c)+'" aria-pressed="'+(c===expenseCategory)+'">'+esc(c)+'</button>').join('')+'</div>'+
      expenseTable(rows)+removedExpensesView();
  }
  const parts=[['Clothing',spend.clothing],...categories.map(c=>[c,total(db.expenses.filter(r=>(r[2]||'Other')===c),r=>r[1])])].filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const max=Math.max(1,...parts.map(([,v])=>v));
  return '<div class="tools view-tools">'+tabs+'</div><div class="metrics expense-metrics">'+metric('Total spent',gbp(spend.total),'Clothing and business costs','featured')+metric('Clothing',gbp(spend.clothing),'Stock and bulk orders')+metric('Business costs',gbp(spend.overhead),db.expenses.length+' recorded')+
    metric('Business costs this month',gbp(thisMonth),'By expense date')+'</div>'+
    '<section class="panel spend-breakdown"><div class="panel-heading"><h2>Where the money goes</h2><span class="profit-period">All time</span></div>'+
    (parts.length?'<div class="bars">'+parts.map(([label,value])=>'<div class="bar-row" title="'+esc(label)+': '+gbp(value)+'"><span class="bar-label">'+esc(label)+'</span><span class="bar-track"><span class="bar-fill" data-w="'+Math.max(2,value/max*100).toFixed(1)+'"></span></span><span class="bar-value">'+gbp(value)+'</span></div>').join('')+'</div>':'<p>No spending recorded yet.</p>')+
    '</section>';
}
function render() {
  if (tab === 'Resources') tab = 'Customer care';
  parkNotificationPreferences();
  document.querySelectorAll('.menu-links button').forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  markSections(tab);
  const headerAction = page => page==='Expenses'?'<button class="action" id="add" data-ledger="expense">＋ Add expense</button>':
    page==='Activity'?'<button class="action" id="add" data-ledger="sale">＋ Add sale</button>':'<button class="action" id="add">＋ Add stock</button>';
  const titles = {Orders:'Bulk orders',Resources:'Reseller resources','Customer care':'Customer care',Dashboard: 'Business overview', Stock: 'Stock collection', Activity: 'Transactions', Expenses:'Business expenses',Account:'Settings',Profile:'Your profile',Admin:'Account management', 'Buying research': 'Buying research',Reports:'Reports','Buying insights':'Performance','Sale receipts':'Sale receipts','Vinted updates':'Vinted updates',Leaderboard:'Revenue leaderboard'};
  const subtitles = {Orders:'Every supplier, every batch, from purchase to your stockroom.',Resources:'Your directory of suppliers, auction sellers and useful tools.','Customer care':'Thoughtful updates for every customer, from purchase to delivery.',Dashboard:'Your resale business at a glance.',Stock:'See what’s in, what’s selling and what needs your attention.',Activity:'Track sales, expenses and completed returns.',Account:'Your account, connections and preferences, in one place.',Profile:'Your identity and access in Stockroom.',Admin:'Suspend, reactivate or review member accounts.',Expenses:'Record and review the costs of running your resale business.','Buying research':'UK market data and comparable asking prices.',Reports:'Review your numbers by month or across all time.','Buying insights':'See what sells, what earns and what to buy more of.','Sale receipts':'Review and match imported Vinted orders.','Vinted updates':'Connect the inbox you use for Vinted and review recent order emails.',Leaderboard:'See how the Stockroom community ranks by recorded sales revenue.'};
  let html = tab==='Dashboard'?welcome():'<section class="top'+(tab==='Stock'?' stock-page-heading':'')+'"><div>'+
    (tab==='Stock'?'':'<div class="eyebrow">'+esc(tab.toUpperCase())+'</div>')+
    '<h1>'+titles[tab]+'</h1>'+(tab==='Stock'?'':'<p>'+subtitles[tab]+'</p>')+
    '</div>'+headerAction(tab)+'</section>';
  if (tab === 'Dashboard') html += dashboard();
  if (tab === 'Stock') html+=stockPage();
  if (tab === 'Activity') html += activity();
  if(tab==='Reports')html+=reportsView();
  if(tab==='Buying insights')html+=insightsView();
  if(tab==='Sale receipts'&&account.role==='admin'&&!isReadOnly())html+=receiptsView();
  if (tab === 'Expenses') html += expensesView();
  if (tab === 'Buying research') {
    html+='<div id="marketResearch"></div>';
    if(db.research.length)html += '<h2>Saved asking-price comparables</h2><div class="research-note"><span class="status-dot violet"></span><p>Vinted UK sample · 4 November 2026. Estimates use displayed prices and small samples across different sizes and conditions.</p></div>' +
      table(['Product','Listings','Median displayed','Estimated resale','Max total buy¹'],db.research.map(row => '<tr>' + [esc(row[0]),row[1],gbp(row[3]),gbp(row[4]),gbp(row[5])].map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')) +
      '<p class="footnote">¹ Allows £15 target profit. Final sale prices may differ.</p><details class="panel"><summary>View comparable listings</summary>' + db.sources.map(row=>'<p>'+esc(row[0])+' · '+gbp(row[1])+' · '+esc(row[4])+'　<a target="_blank" rel="noopener" href="'+esc(/^https:\/\/www\.vinted\.co\.uk\//.test(row[5])?row[5]:'#')+'">View listing ↗</a></p>').join('') + '</details><a href="https://docs.google.com/spreadsheets/d/1OogYe9ABMZeuylHDlk7-xuZIyH3IkNLQAUQScNqZPPs/edit#gid=24002" target="_blank" rel="noopener">Open weekly research in Sheets ↗</a>';
  }
  if(tab==='Orders')html+=ordersView();
  if(tab==='Resources')html+=resourcesView();
  if(tab==='Customer care')html+=customerCareView();
  if(tab==='Account')html+=accountView();
  if(tab==='Vinted updates')html+=gmailView();
  if(tab==='Leaderboard')html+=leaderboardView();
  if(tab==='Profile'){html+=profileView();queueMicrotask(()=>loadFriends().catch(error=>{if($('friendsList'))$('friendsList').textContent=error.message;}));}
  if(tab==='Admin'&&account.role==='admin')html+=adminView();
  html=subnavView(tab)+html;
  if(isReadOnly())html='<div class="readonly-banner">Viewing a member account · read-only <button class="link" id="ownWorkspace">Return to my Stockroom</button></div>'+html;
  $('view').innerHTML = html;
  applySizes($('view'));
  $('profileDock').setAttribute('aria-pressed',String(tab==='Profile'));
  if(lastRenderedTab!==tab){$('view').classList.remove('view-arriving');void $('view').offsetWidth;$('view').classList.add('view-arriving');lastRenderedTab=tab;}
  const utility=!SECTIONS.some(section=>section.tabs.some(([id])=>id===tab));$('screenBack').hidden=!utility;
  applyReadOnlyControls();
  if(['Orders','Resources','Customer care','Admin','Account','Profile','Reports','Buying insights','Sale receipts','Vinted updates','Leaderboard'].includes(tab))$('add').hidden=true;
  $('saleReceiptsNav').hidden=isReadOnly()||account.role!=='admin';
  $('restore').disabled=isReadOnly();$('refreshImports').hidden=isReadOnly()||account.role!=='admin';
  workspacePickerView();
  refreshStockSelection();
  renderVintedEmail();
  renderGmail();
  renderDailyActions();
  renderNotifications();
  labelViewCells($('view'));
  if(tab==='Buying research'){renderMarketResearch();void loadMarketResearch();}
  if(!$('add').dataset.ledger)$('add').onclick = () => openItem(null);
  $('mobileAddStock').hidden = isReadOnly();
  $('pageName').textContent = tab==='Account'?'Settings':tab;
  if (tab === 'Stock') connectStockControls();
  connectCustomerCare();
  connectResources();
  connectOrders();
  connectSettings();
}

function applyReadOnlyControls() {
  if(isReadOnly())document.querySelectorAll('#view [data-edit],#view [data-listing],#view [data-ledger],#view [data-expense-remove],#view [data-expense-restore],#view [data-cost],#view [data-price],#add').forEach(el=>el.disabled=true);
}
function labelViewCells(container) {
  for(const table of container.querySelectorAll('table')){
    const headers=[...table.querySelectorAll('thead th')].map(cell=>cell.textContent);
    for(const row of table.tBodies[0].rows)
      [...row.cells].forEach((cell,index)=>cell.dataset.label=headers[index]||'Actions');
  }
}
const form=$('form');function actual(){const s=form.status.value,show=['Sold','Refunded'].includes(s);$('actualLabel').hidden=!show;$('actualLabel').style.display=show?'grid':'none';form.actual.required=show;$('refundDateLabel').hidden=s!=='Refunded';$('actualLabel').firstElementChild.textContent=s==='Sold'?'Actual sale price (£)':'Refund received (£)'}
function renderPhotos() {
  $('photoPreview').innerHTML = draftPhotos.map((photo, index) =>
    '<div class="preview-photo"><img src="' + photoUrl(photo) + '" alt="Stock photo ' + (index + 1) + '"><button type="button" data-remove-photo="' + index + '" aria-label="Remove photo ' + (index + 1) + '">×</button></div>'
  ).join('');
}
function previewProfit() {
  const cost = form.elements.cost.value;
  const price = form.elements.status.value === 'In Stock' ? form.elements.price.value : form.elements.actual.value;
  const ready = cost !== '' && price !== '' && form.elements.status.value !== 'Refund pending';
  const result = Number(price) - Number(cost);
  $('profitPreview').textContent = ready
    ? 'Profit ' + gbp(result) + '  ·  ROI ' + (Number(cost) > 0 ? (result / Number(cost) * 100).toFixed(1) + '%' : '—')
    : 'Enter cost and resale price to preview profit and ROI.';
}
let liveDraftFields = new Set();
function setQuickStockEntry(quick) {
  $('modal').classList.toggle('quick-stock-entry', quick);
  $('toggleQuickEntry').textContent = quick ? 'Show all fields' : 'Quick entry';
  $('toggleQuickEntry').setAttribute('aria-expanded', String(!quick));
  $('quickEntryHint').hidden = !quick;
}

function updateDuplicateStockHint() {
  const hint = $('duplicateStockHint');
  const name = form.elements.name.value.trim().toLowerCase();
  const brand = form.elements.brand.value.trim().toLowerCase();
  const cost = form.elements.cost.value;
  const duplicate = !edit && name && cost !== '' && db.items.some(item =>
    !item.deletedAt && item.name.trim().toLowerCase() === name &&
    (item.brand || '').trim().toLowerCase() === brand && cents(item.cost) === cents(cost)
  );
  hint.hidden = !duplicate;
  hint.textContent = duplicate ? 'A stock item already has this name, brand and cost. Check before adding another.' : '';
}

function openItem(item, pane = 'details') {
  if(isReadOnly()){toast('This account is read-only.');return;}
  if(item?.deletedAt)return;
  edit = item?.id ?? null;
  form.reset();
  setQuickStockEntry(!item);
  resetReceiptEntry(item);
  $('toggleQuickEntry').hidden = Boolean(item);
  $('saveAnother').hidden = Boolean(item);
  $('duplicateStockHint').hidden = true;
  const brands = [...new Set(db.items.filter(row=>!row.deletedAt && row.brand).slice().reverse().map(row=>row.brand))].slice(0,15);
  $('recentStockBrands').innerHTML = brands.map(brand=>'<option value="'+esc(brand)+'"></option>').join('');
  liveDraftFields = new Set(['listingTitle','listingDescription'].filter(field=>!item?.[field]));
  $('formError').textContent = '';
  $('title').textContent = item ? 'Edit stock item' : 'Add stock item';
  for (const name of ['brand', 'name', 'cost', 'price', 'status', 'size', 'condition', 'notes', 'color', 'garment', 'material', 'measurements', 'flaws', 'listingUrl', 'purchasedAt', 'listingNotes','platform','location','receivedAt','listedAt','stage','refundedAt']) {
    form.elements[name].value = item?.[name] ?? (name === 'status' ? 'In Stock' : '');
  }
  form.elements.platform.value=item?.platform||'Vinted';
  for(const name of ['purchasedAt','receivedAt','listedAt','refundedAt'])form.elements[name].max=todayUK();
  $('itemTradeHistory').innerHTML=(item?.bulkOrderId?'<div class="order-estimate"><b>Bulk order source</b><p>'+esc(orderSource(item))+'</p><button type="button" class="secondary" data-order-origin="'+esc(item.bulkOrderId)+'">View supplier & batch</button></div>':'')+tradeHistory(item);
  if (!item) form.elements.purchasedAt.value = todayUK();
  form.elements.actual.value = item?.status === 'Sold' ? item.sale ?? '' : item?.refund ?? '';
  const facts = listingFacts(item || {});
  for (const key of ['size','garment','color']) form.elements[key].value ||= facts[key];
  const draft = buildListing(editorItem());
  form.elements.listingTitle.value = item?.listingTitle ?? draft.title;
  form.elements.listingDescription.value = item?.listingDescription ?? draft.description;
  $('copyStatus').textContent = '';
  $('markStockListed').hidden=!item||item.status!=='In Stock'||stockWorkflow(item)==='listed';
  draftPhotos = [...(item?.photos ?? [])];
  const references = item?.referencePhotos || [];
  $('sourcePictures').innerHTML = references.length
    ? '<div class="reference-gallery">' + references.map(photo => '<img src="' + referenceUrl(photo.url) + '" alt="Imported seller reference photo" loading="lazy">').join('') + '</div>'
    : '<p class="footnote">Listing photos unavailable. Add your own photos in Details & photos.</p>';
  showPane(pane);
  renderPhotos();
  actual();
  previewProfit();
  updateListingChecks();
  openPanel($('modal'));
  $('modal').scrollTop = 0;
}
async function compressPhoto(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose a photo under 25 MB.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This photo format could not be opened. Try a JPEG, PNG or WebP photo.'); });
  try {
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    bitmap.close();
  }
}
$('photos').onchange = async event => {
  const files = [...event.target.files];
  if (draftPhotos.length + files.length > 4) {
    $('formError').textContent = 'Choose up to 4 photos per item.';
    event.target.value = '';
    return;
  }
  photoBusy = true;
  $('saveItem').disabled = true;
  $('saveAnother').disabled = true;
  $('cancel').disabled = true;
  $('formError').textContent = 'Preparing photos…';
  try {
    const added = [];
    for (const file of files) added.push(await compressPhoto(file));
    draftPhotos.push(...added);
    updateListingChecks();
    renderPhotos();
    $('formError').textContent = '';
  } catch (error) {
    $('formError').textContent = error.message;
  } finally {
    photoBusy = false;
    $('saveItem').disabled = false;
  $('saveAnother').disabled = false;
    $('cancel').disabled = false;
    event.target.value = '';
  }
};
$('photoPreview').onclick = event => {
  const index = event.target.dataset.removePhoto;
  if (index !== undefined && !photoBusy) {
    draftPhotos.splice(Number(index), 1);
    updateListingChecks();
    renderPhotos();
  }
};
form.addEventListener('invalid', event => { if (event.target.closest('#detailsPane')) showPane('details'); }, true);
$('toggleQuickEntry').onclick = () => setQuickStockEntry(!$('modal').classList.contains('quick-stock-entry'));
form.oninput = event => {
  if (event.target.name === 'listingTitle' || event.target.name === 'listingDescription') {
    liveDraftFields.delete(event.target.name);
  } else if (liveDraftFields.size) {
    const draft = buildListing(editorItem());
    if (liveDraftFields.has('listingTitle')) form.elements.listingTitle.value = draft.title;
    if (liveDraftFields.has('listingDescription')) form.elements.listingDescription.value = draft.description;
  }
  previewProfit();
  updateListingChecks();
  updateDuplicateStockHint();
};
form.status.onchange = () => { actual(); previewProfit(); };
$('cancel').onclick = () => $('modal').close();
$('modal').addEventListener('cancel', event => { if (photoBusy || saveBusy) event.preventDefault(); });
form.onsubmit = async event => {
  event.preventDefault();
  if (photoBusy || saveBusy || $('modal').classList.contains('is-closing')) return;
  const fields = Object.fromEntries(new FormData(form));
  const existing = db.items.find(item => item.id === edit);
  const item = {
    ...existing,
    id: edit ?? String(Math.max(0,...db.items.map(item=>Number(item.id)||0))+1).padStart(4,'0'),
    name: fields.name.trim(),
    brand: fields.brand.trim(),
    cost: Number(fields.cost),
    ...askingPriceFields(existing,fields.price === '' ? null : Number(fields.price)),
    size: fields.size.trim(),
    condition: fields.condition,
    notes: fields.notes.trim(),
    photos: [...draftPhotos],
    color: fields.color.trim(),
    garment: fields.garment.trim(),
    material: fields.material.trim(),
    measurements: fields.measurements.trim(),
    flaws: fields.flaws.trim(),
    listingTitle: fields.listingTitle.trim(),
    listingDescription: fields.listingDescription.trim(),
    listingUrl: fields.listingUrl.trim(),
    purchasedAt: fields.purchasedAt,receivedAt:fields.receivedAt,listedAt:fields.listedAt,stage:fields.stage,
    refundedAt:fields.status==='Refunded'?fields.refundedAt:'',
    purchaseDateReviewed:true,
    listingNotes: fields.listingNotes.trim(),
    platform:fields.platform,location:fields.location.trim(),
    status: fields.status,
    sale: fields.status === 'Sold' ? Number(fields.actual) : existing?.sale ?? null,
    refund: fields.status === 'Refunded' ? Number(fields.actual) : existing?.refund ?? null
  };
  if(existing&&lastTrade(db,existing.id)&&(item.status!==existing.status||item.sale!==existing.sale)){
    $('formError').textContent='Use the order and refund tools to change a recorded sale.';return;
  }
  if (!item.name) {
    $('formError').textContent = 'Enter an item description.';
    return;
  }
  const next = {...db, items: edit ? db.items.map(old => old.id === edit ? item : old) : [...db.items, item]};
  saveBusy = true;
  $('saveItem').disabled = true;
  $('saveAnother').disabled = true;
  try {
    await persist(next);
    if (event.submitter?.id === 'saveAnother') {
      $('modal').close();
      openItem(null);
      form.elements.name.focus({preventScroll:true});
    } else closePanel($('modal'));
    toast('Saved to your Stockroom.');
  } catch (error) {
    $('formError').textContent = error.message + ' Your edits are still here.';
  } finally {
    saveBusy = false;
    $('saveItem').disabled = false;
  $('saveAnother').disabled = false;
  }
};
$('closePhoto').onclick = () => $('lightbox').close();
document.addEventListener('click',e=>{
const reprice=e.target.closest('[data-reprice]');
if(reprice&&!isReadOnly()){
  const item=db.items.find(row=>row.id===reprice.dataset.reprice&&!row.deletedAt);
  if(item){
    openItem(item);
    form.elements.price.scrollIntoView({block:'center'});
  }
}
if(e.target.closest('[data-listing]')) openItem(db.items.find(item => item.id === e.target.closest('[data-listing]').dataset.listing), 'listing');
if(e.target.closest('[data-reference]')) {
  const item = db.items.find(item => item.id === e.target.closest('[data-reference]').dataset.reference);
  $('fullPhoto').src = referenceUrl(item.referencePhotos[0].url);
  $('fullPhoto').alt = 'Imported reference photo of ' + item.name;
  openPanel($('lightbox'));
}
if(e.target.closest('[data-edit]'))openItem(db.items.find(i=>i.id===e.target.closest('[data-edit]').dataset.edit));if(e.target.closest('[data-photo]')) {
  const item = db.items.find(i => i.id === e.target.closest('[data-photo]').dataset.photo);
  $('fullPhoto').src = photoUrl(item.photos[0]);
  $('fullPhoto').alt = item.name;
  openPanel($('lightbox'));
}
if(e.target.closest('[data-tab]'))navigate(e.target.closest('[data-tab]').dataset.tab);});
document.addEventListener('change', async event => {
  const id = event.target.dataset.price ?? event.target.dataset.cost;
  if (!id) return;
  if (!event.target.validity.valid || (event.target.dataset.cost && event.target.value === '')) { render(); return; }
  const field = event.target.dataset.cost ? 'cost' : 'price';
  const value = event.target.value === '' ? null : Number(event.target.value);
  const current=db.items.find(item=>item.id===id);
  if(!current || (current[field]??null)===value)return;
  const change=field==='price'?askingPriceFields(current,value):{cost:value};
  const next = {...db, items: db.items.map(item => item.id === id ? {...item,...change} : item)};
  try { await persist(next); } catch {
    toast('Change not saved. Open Settings to retry or resolve the sync conflict.');
    render();
  }
});

let ledgerEdit = null;
document.addEventListener('click', event => {
  const button = event.target.closest('[data-ledger]');
  if (!button || isReadOnly()) return;
  const kind = button.dataset.ledger;
  const index = button.dataset.index === undefined ? null : Number(button.dataset.index);
  ledgerEdit = {kind, index};
  const row = index === null ? [] : (kind === 'sale' ? db.sales : db.expenses)[index];
  const form = $('ledgerForm');
  $('ledgerTitle').textContent = (index === null ? 'Add ' : 'Edit ') + (kind === 'sale' ? 'sale' : 'expense');
  form.elements.description.value = row[0] ?? '';
  form.elements.amount.value = row[1] ?? '';
  form.elements.purchaseCost.value = row[3] ?? '';
  form.elements.date.value = row[4] || (index === null ? todayUK() : '');
  form.elements.date.max = todayUK();
  form.elements.linkedStock.innerHTML='<option value="">General expense</option>'+itemOptions(db.items.filter(item=>!item.deletedAt||item.id===row[6]));
  form.elements.linkedStock.value=row[6]||'';
  form.elements.category.value = ['Packaging','Postage','Cleaning','Repairs','Promotion','Other'].includes(row[2]) ? row[2] : 'Other';
  form.elements.notes.value = row[5] || '';
  $('expenseFields').hidden = kind !== 'expense';
  $('ledgerCost').hidden = kind !== 'sale';
  $('ledgerError').textContent = '';
  openPanel($('ledgerModal'));
});
$('ledgerCancel').onclick = () => $('ledgerModal').close();
$('ledgerForm').onsubmit = async event => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(event.target));
  if (!fields.description.trim()) return;
  const {kind,index} = ledgerEdit;
  const rows = [...(kind === 'sale' ? db.sales : db.expenses)];
  const row = [...(index === null ? [] : rows[index])];
  row[0] = fields.description.trim();
  row[1] = Number(fields.amount);
  if (kind === 'sale') row[3] = fields.purchaseCost === '' ? null : Number(fields.purchaseCost);
  else { row[2] = fields.category; row[5] = fields.notes.trim(); row[6]=fields.linkedStock||''; }
  row[4] = fields.date;
  if (index === null) rows.push(row); else rows[index] = row;
  $('ledgerSave').disabled = true;
  try {
    await persist({...db, [kind === 'sale' ? 'sales' : 'expenses']: rows});
    closePanel($('ledgerModal'));toast('Transaction saved.');
  } catch (error) {
    $('ledgerError').textContent = error.message;
  } finally { $('ledgerSave').disabled = false; }
};
$('backup').onclick=()=>fullBackup().catch(error=>toast(error.message));
$('restore').onclick=()=>{if(isReadOnly())return; $('upload').click();};
$('upload').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>19000000)throw Error('Backup too large.');const data=JSON.parse(await file.text());if(!['items','sales','expenses','sources','research'].every(k=>Array.isArray(data[k])))throw Error('Choose a valid Stockroom backup.');if(confirm('Replace your cloud workspace with this backup on every device? Export a backup first if you need the current data.')){await persist(data);toast('Backup restored to your cloud account.');}}catch(error){toast(error.message);}e.target.value='';};
(async()=>{
  try{
    const result=await api('/api/me');account=result.user;workspaceOwner=account.id;
    $('adminMenu').hidden=$('adminNav').hidden=account.role!=='admin';$('refreshImports').hidden=account.role!=='admin';
    applyProfile(result.profile);$('menuRole').textContent=account.role==='admin'?'Administrator':'Member';
    try{storage=await openStorage();}catch{storage=null;}
    const remote=await api('/api/workspace');cloudRevision=remote.revision;
    const held=await pendingRecord().catch(()=>null);
    if(held){db=remote.data||emptyData();pendingLocal=held.data;cloudConflict=held.revision!==remote.revision;tab='Account';}
    else if(remote.data)db=remote.data;
    else{
      db=emptyData();
      if(account.role==='admin'){
        const legacy=storage?await new Promise(resolve=>{const r=storage.transaction('workspace').objectStore('workspace').get('data');r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null);}):null;
        db=legacy||JSON.parse(localStorage.getItem(key)||'null')||await(await fetch('/seed.json')).json();
        migrateFacts(db);
      }
      if(account.role==='admin')await persist(db);
    }
    if(['Sale receipts','Admin'].includes(tab)&&account.role!=='admin')tab='Dashboard';
    render();finishLaunch();loadNotificationReads().catch(()=>{});startSocial();preparePush().catch(()=>{});cloudAvailable=true;cloudState(pendingLocal?(cloudConflict?'Resolve sync conflict':'Unsaved change · retry'):'Synced to cloud',pendingLocal?'error':'saved');
    if(account.role==='admin'){loadSaleReceipts().catch(()=>{});loadImportNoticeStatus().catch(()=>{});if(tab==='Admin')loadAdmin().then(()=>{if(tab==='Admin')render();}).catch(()=>{});}
    loadGmail(true).catch(()=>{if($('personalGmailPanel'))$('personalGmailPanel').textContent='Gmail status unavailable. Reopen Vinted updates to try again.';});
    await openScannedStock();
    await refreshImports();setInterval(()=>{if(!document.hidden)void refreshImports();},30000);setInterval(syncCloud,15000);
  }catch(error){finishLaunch();cloudState('Connection needed','error');$('view').innerHTML='<section class="panel"><h1>Connect to your Stockroom</h1><p>'+esc(error.message)+'</p><p>Your data has not been replaced.</p><a class="action" href="/">Try again</a> <a class="secondary" target="_top" href="/signin-with-chatgpt?return_to=%2F">Continue with ChatGPT</a></section>';}
})();
function migrateFacts(data){
 for(const item of data.items)if(originalPurchases[item.id]&&!item.purchasedAt&&!item.purchaseDateReviewed)item.purchasedAt='2026-10-23';
 if(!data.expenseDatesMigrated){data.expenses=data.expenses.map(row=>row[0]==='2x 150pc - Grey Mailing Bags.'&&row[1]===9.98?[row[0],row[1],row[2]||'Packaging',row[3]??null,row[4]||'2026-10-23',row[5]||'']:row);data.expenseDatesMigrated=true;}
}

function referenceUrl(url) {
  return typeof url === 'string' && /^\/api\/photos\/\d{5,30}\/[0-3]$/.test(url) ? url : '';
}
function editorItem() {
  const values = Object.fromEntries(new FormData(form));
  return {...values,photos:draftPhotos};
}
function updateListingChecks() {
  const item = editorItem();
  $('listingChecks').innerHTML = listingChecks(item,item.listingTitle,item.listingDescription)
    .map(([label,complete]) => '<span class="' + (complete?'complete':'incomplete') + '">' + (complete?'✓ ':'○ ') + label + '</span>').join('');
}
function showPane(pane) {
  const target=$(pane==='details'?'detailsPane':'listingPane');target.classList.remove('pane-arriving');void target.offsetWidth;target.classList.add('pane-arriving');
  $('detailsPane').hidden = pane !== 'details';
  $('listingPane').hidden = pane !== 'listing';
  document.querySelectorAll('[data-pane]').forEach(button=>button.classList.toggle('selected',button.dataset.pane===pane));
}
document.querySelectorAll('[data-pane]').forEach(button=>button.onclick=()=>showPane(button.dataset.pane));
$('markStockListed').onclick=()=>{
  if(isReadOnly()||saveBusy||form.status.value!=='In Stock')return;
  form.elements.stage.value='Listed';
  form.elements.listedAt.value ||= todayUK();
  form.requestSubmit();
};
$('regenerateListing').onclick = () => {
  const draft = buildListing(editorItem());
  liveDraftFields = new Set(['listingTitle','listingDescription']);
  form.elements.listingTitle.value = draft.title;
  form.elements.listingDescription.value = draft.description;
  $('copyStatus').textContent = 'Draft refreshed from the item details. Review before listing.';
  updateListingChecks();
};
// Pip writes the listing with Workers AI from the item's details and its cover photo.
async function listingPhotoData(src) {
  if (!src) return null;
  try {
    const blob = src.startsWith('data:') ? await (await fetch(src)).blob() : await (await fetch(photoUrl(src) || src, {credentials: 'same-origin'})).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch { return null; }
}
$('pipWriteListing').onclick = async () => {
  const button = $('pipWriteListing'), note = $('pipWriteNote');
  if (button.disabled) return;
  const item = editorItem();
  button.disabled = true; button.classList.add('writing'); button.lastChild.textContent = 'Pip is writing…';
  note.textContent = 'Looking at the photo and details. This takes a few seconds.';
  try {
    const cover = (item.photos || [])[0];
    const image = await listingPhotoData(typeof cover === 'string' ? cover : cover?.url || '');
    const {listing} = await api('/api/vision/write-listing', {method: 'POST', body: JSON.stringify({image, item: {
      name: item.name, brand: item.brand, garment: item.garment, size: item.size, color: item.color, condition: item.condition,
      flaws: item.flaws, material: item.material, measurements: item.measurements, notes: item.notes}})});
    liveDraftFields = new Set();
    form.elements.listingTitle.value = listing.title;
    form.elements.listingDescription.value = listing.description + (listing.hashtags.length ? '\n\n' + listing.hashtags.join(' ') : '');
    ['listingTitle', 'listingDescription'].forEach(name => { const el = form.elements[name]; el.classList.remove('pw-flash'); void el.offsetWidth; el.classList.add('pw-flash'); });
    note.textContent = 'Written by Pip' + (image ? ' from your photo and details' : ' from your details') + '. Check it, then copy into Vinted. Tap again for a different version.';
    updateListingChecks();
  } catch (error) {
    note.textContent = (error.message || 'Pip could not write this one.') + ' “Refresh from details” still works.';
  } finally { button.disabled = false; button.classList.remove('writing'); button.lastChild.textContent = 'Write with Pip'; }
};
document.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{
  const text = form.elements[button.dataset.copy].value;
  try {
    await navigator.clipboard.writeText(text);
    $('copyStatus').textContent = /\[[^\]]+\]/.test(text) ? 'Copied. Replace bracketed fields before publishing.' : 'Copied. Check the listing details before publishing.';
  } catch {
    form.elements[button.dataset.copy].select();
    $('copyStatus').textContent = 'Text selected. Use your device’s Copy action.';
  }
});
const originalPurchases = {
  '0001':'23497232320','0002':'23497295586','0003':'23497368218',
  '0004':'23505544607','0005':'23505507497'
};
function sameStockItem(item,purchase){
  const norm=value=>String(value||'').toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const a=norm(item.name),b=norm(purchase.name);
  if(!a||!b||!(a===b||a.startsWith(b)||b.startsWith(a)))return false;
  if(Math.abs((Number(item.cost)||0)-(Number(purchase.cost)||0))>0.01)return false;
  const day=value=>Date.parse(String(value||'').slice(0,10)+'T00:00:00Z');
  const gap=Math.abs(day(item.purchasedAt)-day(purchase.purchasedAt));
  return !Number.isFinite(gap)||gap<=3*86400000;
}
function mergePurchases(data,purchases) {
  const items = data.items.map(item=>({...item}));
  let added = 0;
  for (const purchase of purchases) {
    if (!purchase.transactionId || !Number.isFinite(purchase.cost)) continue;
    let item = items.find(item=>item.sourceTransactionId === purchase.transactionId);
    if (!item) item = items.find(item=>!item.sourceTransactionId && originalPurchases[item.id] === purchase.transactionId);
    // Hand-added stock has no transaction ID: match on name, price and date so Gmail imports don't duplicate it.
    if (!item) item = items.find(item=>!item.sourceTransactionId && sameStockItem(item,purchase));
    if (!item) {
      const id = String(Math.max(0,...items.map(item=>Number(item.id)||0))+1).padStart(4,'0');
      item = {id,name:purchase.name,brand:purchase.brand,cost:purchase.cost,price:null,status:'In Stock',photos:[],
        stage:'Awaiting delivery',size:purchase.size||'',color:purchase.color||'',garment:purchase.garment||'',purchasedAt:(purchase.purchasedAt||'').slice(0,10)};
      items.push(item);
      added++;
    }
    if(item.deletedAt)continue;
    item.sourceTransactionId = purchase.transactionId;
    if (!item.purchaseDateReviewed) item.purchasedAt ||= (purchase.purchasedAt||'').slice(0,10);
    // Never blank photos already on an item: Gmail receipt imports carry none.
    if (purchase.referencePhotos?.length || !item.referencePhotos?.length) item.referencePhotos = purchase.referencePhotos || [];
    if (purchase.referencePhotos?.length || !item.photoStatus) item.photoStatus = purchase.photoStatus;
    item.listingUrl ||= purchase.listingUrl || '';
    item.size ||= purchase.size || '';
    item.color ||= purchase.color || '';
    item.garment ||= purchase.garment || '';
    const facts = listingFacts(item);
    for (const key of ['size','garment','color']) item[key] ||= facts[key];
    const draft = buildListing(item);
    item.listingTitle ??= draft.title;
    item.listingDescription ??= draft.description;
  }
  return {data:{...data,items},added};
}
async function refreshImports() {
  if (!account || account.role!=='admin' || isReadOnly() || cloudSaving || pendingLocal || syncBusy || !db || document.querySelector('dialog[open]') || document.activeElement?.matches('input,select,textarea')) return;
  syncBusy = true;
  try {
    const response = await fetch('/api/purchases',{cache:'no-store'});
    if (!response.ok) throw Error();
    const source = await response.json();
    if (!Array.isArray(source.purchases)) throw Error();
    // Recheck after the read to avoid refreshing an editor opened while loading.
    if (isReadOnly() || cloudSaving || pendingLocal || document.querySelector('dialog[open]') || document.activeElement?.matches('input,select,textarea')) { $('syncState').textContent = 'Check deferred while editing'; return; }
    const recent=new Date(Date.now()-7*86400000).toISOString().slice(0,10);
    purchaseNoticeKeys=source.purchases.filter(row=>row.purchasedAt?.slice(0,10)>=recent)
      .flatMap(row=>['purchase:'+row.transactionId,...(row.referencePhotos||[]).map(photo=>'purchase-photo:'+photo.url)]);
    renderNotifications();
    const beforeIds = new Set(db.items.map(item=>item.id));
    const merged = mergePurchases(db,source.purchases);
    if(JSON.stringify(merged.data)!==JSON.stringify(db))await persist(merged.data);
    if (merged.added) {
      const fresh = merged.data.items.filter(item=>!beforeIds.has(item.id));
      pipNotify({tone:'go', tab:'Stock', title: fresh.length===1 ? 'Added to stock: '+fresh[0].name : fresh.length+' new purchases in stock',
        body: fresh.slice(0,3).map(item=>item.name+' · '+gbp(item.cost)).join('  ·  ')});
    }
    $('syncState').textContent = merged.added ? merged.added + ' new purchase(s) added' : 'Purchase imports checked';
  } catch {
    $('syncState').textContent = 'Purchase check unavailable · Try Refresh purchases';
  } finally { syncBusy = false; }
}
$('refreshImports').onclick = refreshImports;

$('cloudStatus').onclick=()=>{if(pendingLocal||cloudConflict){navigate('Account');}else syncCloud(true);};
window.addEventListener('online',()=>syncCloud(true));
window.addEventListener('offline',()=>cloudState('Offline · edits need connection','error'));
window.addEventListener('focus',()=>syncCloud());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshImports();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncCloud();});
window.addEventListener('beforeunload',event=>{if(pendingLocal||cloudSaving){event.preventDefault();event.returnValue='';}});
document.addEventListener('click',async event=>{
 const el=event.target.closest('button');if(!el)return;
 try{
  if(el.id==='checkCloud')await syncCloud(true);
  if(el.id==='exportAccount')await fullBackup();
  if(el.id==='restoreSettings'&&!isReadOnly())$('upload').click();
  if(el.id==='exportPending')await fullBackup(pendingLocal);
  if(el.id==='retrySave'){const next=pendingLocal;await persist(next);toast('Changes saved to cloud.');}
  if(el.id==='loadLatest'){
   if(!confirm('Discard the unsaved attempt and load the latest cloud version? Export your unsaved changes first if you need them.'))return;
   const latest=await api('/api/workspace');db=latest.data||emptyData();cloudRevision=latest.revision;pendingLocal=null;cloudConflict=false;await pendingRecord(null,true).catch(()=>{});render();cloudState('Synced to cloud','saved');
  }
  if(el.id==='ownWorkspace')await switchWorkspace(account.id);
  if(el.dataset.viewMember)await switchWorkspace(el.dataset.viewMember);
  if(el.dataset.memberToggle){
   const member=members.find(m=>m.email===el.dataset.memberToggle);if(!member)return;
   const status=member.status==='active'?'suspended':'active';
   if(!confirm((status==='suspended'?'Suspend':'Reactivate')+' '+member.email+'? '+(status==='suspended'?'Their data will be retained.':'')))return;
   await api('/api/admin/members',{method:'POST',body:JSON.stringify({email:member.email,name:member.name,status})});await loadAdmin();render();toast('Member '+status+'.');
  }
  if(el.id==='migrateDevice'){
   if(!storage)throw Error('This browser has no accessible device storage. Restore an exported backup instead.');
   const legacy=await new Promise(resolve=>{const r=storage.transaction('workspace').objectStore('workspace').get('data');r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null);});
   const local=legacy||JSON.parse(localStorage.getItem(key)||'null');
   if(!local)throw Error('No legacy data was found on this browser. Open Stockroom on the browser used before cloud sync, or restore its backup.');
   if(confirm('Replace your current cloud workspace with the '+local.items.length+' items and other data from this browser? This changes every device. Export the current cloud backup first if needed.')){migrateFacts(local);await persist(local);toast('Device data imported and synced.');}
  }
 }catch(error){toast(error.message);}
});
// Native disclosure keeps the account menu usable with touch and keyboard.
document.addEventListener('click',event=>{if(!$('accountMenu').contains(event.target))$('accountMenu').open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('accountMenu').open){$('accountMenu').open=false;$('accountMenu').querySelector('summary').focus();}});

initialiseExperience();
initialiseWorkspacePicker();
initialiseSocial();
initialiseTrading();
initialiseReceiptEntry();
initialiseBulk();
initialiseStock();
initialiseNotifications();
initialiseGmail();
