'use strict';
const motionOK=()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let lastMainTab='Dashboard',lastRenderedTab=null,closeTarget=null;
const tabScroll={};
function blobCharacter(extra=''){
 return '<span class="pip-character '+extra+'" aria-hidden="true"><img class="pip-art" src="/pip.svg" alt="" width="160" height="150"></span>';
}
function welcome(){
 const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'numeric',hourCycle:'h23'}).format(new Date()));
 const greeting=hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';
 const name=account.role==='admin'?'Dom':account.email.split('@')[0].split(/[._-]/)[0];
 const today = dateLabel(todayUK());
 return '<section class="top dashboard-title"><div><h1>'+greeting+', '+esc(name)+'</h1><p>'+esc(today)+'</p></div>'+
   '<div class="dashboard-actions"><button class="secondary" type="button" data-scan-receipt '+(isReadOnly()?'hidden':'')+'>Scan receipt</button>'+
   '<button class="action" id="add">＋ Add stock</button></div></section>'+
   '<section class="pip-dashboard" aria-labelledby="pipDashboardTitle">'+
   '<div class="pip-dashboard-copy"><h2 id="pipDashboardTitle">Pip</h2>'+
   '<p>See what needs your attention across stock, sales and orders.</p>'+
   '<button class="secondary pip-dashboard-action" type="button" data-guide>Open Pip review <span aria-hidden="true">→</span></button></div>'+
   blobCharacter('pip-dashboard-art')+'</section>';
}
function guideView() {
 const financials = finances(db);
 const items = financials.active.filter(item=>stockWorkflow(item)!=='arriving');
 const today = todayUK();
 const overdue = (db.bulkOrders || []).filter(order=>
   ['Ordered','Dispatched'].includes(order.stage) && order.expectedAt && order.expectedAt<today
 );
 const awaitingShipping = (db.trades || []).filter(trade=>tradeStatus(trade)==='Sold' && saleRemaining(trade)>0);
 const receipts = account.role==='admin' && saleReceiptsLoaded
   ? saleReceipts.filter(receipt=>!(db.receiptsReviewed || []).includes(receipt.id)).length : 0;
 const groups = [];
 const add = (title, detail, destination, count) => {
   if (count) groups.push('<button type="button" class="pip-review-row" data-guide-stock data-tab="'+destination+'"><span><strong>'+title+'</strong><small>'+detail+'</small></span><b>'+count+'</b></button>');
 };
 const itemChecks = (title, candidates, field) => {
   if (!candidates.length) return;
   const rows = candidates.slice(0,3).map(item=>isReadOnly() ? '<li>'+esc(item.name)+'</li>' :
     '<li><button type="button" class="link" data-pip-item="'+esc(item.id)+'" data-pip-field="'+field+'">'+esc(item.name)+' <span aria-hidden="true">›</span></button></li>').join('');
   groups.push('<details class="pip-review-group"><summary><strong>'+title+'</strong><b>'+candidates.length+'</b></summary><ul>'+rows+'</ul>'+
     (candidates.length>3?'<button type="button" class="link" data-tab="Stock" data-guide-stock>Open stock collection</button>':'')+'</details>');
 };
 add('Missing sale costs','Add the purchase cost to confirm your profit.','Activity',financials.missing);
 add('Orders to dispatch','Review open sales and record postage when sent.','Dashboard',awaitingShipping.length);
 add('Sale receipts to review','Check the Vinted events awaiting review.','Sale receipts',receipts);
 add('Overdue bulk deliveries','Check the supplier and expected arrival.','Orders',overdue.length);
 itemChecks('Purchase refunds pending',financials.pending,'status');
 itemChecks('Items without an asking price',items.filter(item=>!Number.isFinite(item.price)),'price');
 itemChecks('Listings missing size or condition',items.filter(item=>!listingFacts(item).size || !item.condition),'condition');
 itemChecks('Items without your own photos',items.filter(item=>!item.photos?.length),'photos');
 itemChecks('Listings live for 30 days or more',items.filter(item=>(daysListed(item,today)||0)>=30),'price');
 return '<div class="guide-intro">'+blobCharacter('small')+'<p>Pip checks your saved stock, sales and orders when you open this review. Pick a finding to see what needs attention.</p></div>'+
   '<div class="pip-review-list">'+(groups.join('') || '<p>No issues found in the records Pip checks.</p>')+'</div>';
}
function navigate(next){
 if(!account||!db){tab=next;return;}
 if(['Admin','Sale receipts'].includes(next)&&account.role!=='admin')return;
 $('accountMenu').open=false;
 if(next===tab)return;
 tabScroll[tab]=window.scrollY;
 if(['Dashboard','Stock','Expenses','Activity'].includes(tab))lastMainTab=tab;
 tab=next;render();window.scrollTo({top:tabScroll[next]||0,behavior:'instant'});
 const heading=$('view').querySelector('h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
 if(['Account','Admin'].includes(tab))loadImportNoticeStatus().catch(()=>{});
 if(tab==='Leaderboard')loadLeaderboard(1);
 if(tab==='Vinted updates')loadGmail().catch(error=>{if($('personalGmailPanel'))$('personalGmailPanel').textContent=error.message;});
 if(tab==='Sale receipts')loadSaleReceipts().catch(error=>toast(error.message));
 if(tab==='Admin')loadAdmin().then(()=>{if(tab==='Admin')render();}).catch(error=>toast(error.message));
}
function panelSnapshot(dialog){
 if(dialog.id==='chatDialog'||dialog.id==='labelDialog'||(dialog.id==='tradeDialog'&&['offer','lookup','order'].includes(dialogAction)))return '';
 const form=dialog.querySelector('form');
 return form?JSON.stringify([...new FormData(form)].filter(([key])=>key!=='photos'))+(dialog.id==='modal'?JSON.stringify(draftPhotos):''):'';
}
function openPanel(dialog){
 dialog.classList.remove('is-closing');dialog.showModal();dialog.scrollTop=0;
 dialog.dataset.baseline=panelSnapshot(dialog);document.body.classList.add('panel-open');
}
function closePanel(dialog){
 if(!dialog.open||dialog.classList.contains('is-closing'))return;
 if(!motionOK()){dialog.close();return;}
 dialog.classList.add('is-closing');setTimeout(()=>{dialog.close();dialog.classList.remove('is-closing');},170);
}
function requestClose(dialog){
 if(!dialog?.open)return;
 if((dialog.id==='modal'&&(photoBusy||saveBusy))||(dialog.id==='ledgerModal'&&$('ledgerSave').disabled)||(dialog.id==='tradeDialog'&&$('tradeSave')?.disabled)||(dialog.id==='bulkDialog'&&$('bulkSave').disabled)){toast('Finishing your save. One moment…');return;}
 if(dialog.querySelector('form')&&dialog.dataset.baseline!==panelSnapshot(dialog)){
  closeTarget=dialog;if(!$('discardDialog').open)openPanel($('discardDialog'));return;
 }
 closePanel(dialog);
}
function initialiseExperience(){
 const paths={Account:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',Orders:'M3 7l9-4 9 4v13H3ZM3 7l9 4 9-4M12 11v9',Resources:'M4 5h6l2 2h8v13H4ZM8 12h8M8 16h5',Dashboard:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',Stock:'M4 7h16v14H4ZM8 7V5a4 4 0 0 1 8 0v2',Expenses:'M5 3h14v18l-3-2-4 2-4-2-3 2ZM8 8h8M8 12h6',Activity:'M3 12h4l3-8 4 16 3-8h4'};
 document.querySelectorAll('nav [data-tab]:not(#navProfile)').forEach(button=>{button.querySelector('span').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[button.dataset.tab]+'"/></svg>';});
 $('mobileAddStock').onclick=()=>{if(db&&account&&!isReadOnly())openItem(null);};
 document.addEventListener('click',event=>{
  if(!event.target.closest('[data-scan-receipt]')||isReadOnly())return;
  openItem(null);
  $('receiptEntry').open=true;
  $('receiptImage').focus();
 });
 $('screenBack').onclick=()=>navigate(lastMainTab);
 $('cancel').onclick=()=>requestClose($('modal'));$('ledgerCancel').onclick=()=>requestClose($('ledgerModal'));$('closePhoto').onclick=()=>requestClose($('lightbox'));
 $('keepEditing').onclick=()=>{$('discardDialog').close();closeTarget=null;};
 $('discardEdits').onclick=()=>{const target=closeTarget;closeTarget=null;$('discardDialog').close();if(target)closePanel(target);};
 for(const dialog of document.querySelectorAll('dialog')){
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(dialog.id==='discardDialog'){$('discardDialog').close();closeTarget=null;}else requestClose(dialog);});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)requestClose(dialog);});
  dialog.addEventListener('close',()=>{if(!document.querySelector('dialog[open]'))document.body.classList.remove('panel-open');});
  const grip=dialog.querySelector('.sheet-grip');if(grip){let start=null;grip.addEventListener('pointerdown',event=>{start={x:event.clientX,y:event.clientY};grip.setPointerCapture(event.pointerId);});grip.addEventListener('pointerup',event=>{if(start&&event.clientY-start.y>65&&Math.abs(event.clientX-start.x)<80)requestClose(dialog);start=null;});}
 }
 document.addEventListener('click',event=>{
  if(event.target.closest('[data-reset-filters]')){resetStockFilters();render();}
  if(event.target.closest('[data-add-piece]'))openItem(null);
  const close=event.target.closest('[data-close-dialog]');if(close)requestClose($(close.dataset.closeDialog));
  if(event.target.closest('[data-guide]')){$('guideContent').innerHTML=guideView();openPanel($('guideDialog'));}
  if(event.target.closest('[data-guide-stock]'))closePanel($('guideDialog'));
  const pipItem=event.target.closest('[data-pip-item]');
  if(pipItem && !isReadOnly()){
    const item=db.items.find(row=>row.id===pipItem.dataset.pipItem && !row.deletedAt);
    if(!item)return;
    $('guideDialog').close();
    openItem(item);
    const target=form.elements[pipItem.dataset.pipField] || $('photos');
    target?.scrollIntoView({block:'center'});
    if(target?.type!=='file')target?.focus({preventScroll:true});
  }
 });
}

function finishLaunch() {
  const screen = $('launchScreen');
  if (!screen || screen.hidden || screen.classList.contains('leaving')) return;
  if (!motionOK()) {screen.hidden=true;return;}
  screen.classList.add('leaving');
  screen.setAttribute('aria-hidden','true');
  setTimeout(()=>{screen.hidden=true;},200);
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
document.addEventListener('click',async event=>{
  if(!event.target.closest('[data-install-app]'))return;
  if(matchMedia('(display-mode: standalone)').matches || navigator.standalone){toast('You’re already using the installed app.');return;}
  if(installPrompt){
    const prompt=installPrompt;
    installPrompt=null;
    try{await prompt.prompt();}catch{toast('Use your browser’s Install app menu.');}
    return;
  }
  openPanel($('installDialog'));
});
