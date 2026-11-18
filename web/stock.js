'use strict';

let stockWorkflowFilter = 'all';
let stockAgeView = false;
let stockAgeFilter = 'all';
const ageFilters = [['all','All unsold'],['30+','Listed 30+ days'],['60+','Unsold 60+ days']];
let stockToolsOpen = false;
let stockBrand = '';
let stockLocation = '';
let layoutPreference;
const stockWorkflows = [
  ['all','All stock'], ['arriving','Arriving'], ['photos','Needs photos'],
  ['ready','Ready to list'], ['listed','Listed'], ['sold','Sold'], ['returns','Returns']
];

function stockWorkflow(item) {
  if (['Refund pending','Refunded'].includes(item.status) || item.stage === 'Return inspection') return 'returns';
  if (item.status !== 'In Stock') return 'sold';
  if (item.stage === 'Awaiting delivery' && !item.receivedAt) return 'arriving';
  if (item.stage === 'Listed' || (!item.stage && item.listedAt)) return 'listed';
  return item.photos?.some(photoUrl) ? 'ready' : 'photos';
}

function stockLayout() {
  if (layoutPreference) return layoutPreference;
  try {
    const saved = localStorage.getItem('stockroom.layout:' + account.id);
    if (['cards','list','compact'].includes(saved)) return saved;
  } catch {}
  return matchMedia('(max-width: 800px)').matches ? 'cards' : 'list';
}

function daysListed(item, asOf = todayUK()) {
  if (stockWorkflow(item) !== 'listed') return null;
  return daysUnsold({...item, purchasedAt:item.listedAt}, asOf);
}

function askingPriceFields(item, price) {
  return item?.price === price || (item?.price == null && price == null)
    ? {price}
    : {price, priceChangedAt:todayUK()};
}

function stockSelectionBox(item) {
  return selectingStock ? '<input type="checkbox" class="stock-select" data-select-stock="'+esc(item.id)+
    '" aria-label="Select '+esc(item.name)+'" '+(selectedStock.has(item.id)?'checked':'')+'>' : '';
}

function stockPicture(item) {
  const own = photoUrl(item.photos?.[0]);
  const reference = referenceUrl(item.referencePhotos?.[0]?.url);
  return {own,reference,src:own||reference};
}

function stockNextAction(item) {
  if (isReadOnly()) return '';
  const id=esc(item.id);
  const editAction=label=>'<button class="stock-next" type="button" data-edit="'+id+'">'+label+'</button>';
  const tradeAction=(action,label)=>'<button class="stock-next" type="button" data-trade="'+action+'" data-stock-id="'+id+'">'+label+'</button>';
  switch(stockWorkflow(item)){
    case 'arriving': return '<button class="stock-next" type="button" data-stock-receive="'+id+'" title="Record today as the received date">Mark received</button>';
    case 'photos': return '<button class="stock-next" type="button" data-stock-add-photos="'+id+'">Add photos</button>';
    case 'ready': return '<button class="stock-next" type="button" data-listing="'+id+'">Open listing draft</button>';
    case 'listed': return tradeAction('sale','Record sale');
    case 'returns': return editAction(item.status==='Refunded'?'View refund':'Review return');
    default: {
      const order=lastTrade(db,item.id);
      return order ? tradeAction(tradeStatus(order)==='Sold'?'post':'order',tradeStatus(order)==='Sold'?'Record postage':'View order')
        : tradeAction('sale','Date sale');
    }
  }
}

function stockMore(item) {
  if (isReadOnly()) return '';
  const id=esc(item.id);
  const {own,reference}=stockPicture(item);
  const workflow=stockWorkflow(item);
  const order=item.status==='Sold'&&lastTrade(db,item.id);
  const extras=(item.status==='In Stock'?
    (workflow==='listed'?'':tradeButton('sale','Record sale',item.id))+tradeButton('offer','Offer check',item.id):
    order&&tradeStatus(order)==='Sold'?tradeButton('order','View order',item.id):'')+tradeButton('label','Label',item.id);
  return '<details class="stock-more"><summary aria-label="More actions for '+esc(item.name)+'">⋯</summary><div>'+
    '<button class="secondary" type="button" data-edit="'+id+'">Edit item</button>'+
    (item.status==='In Stock'&&workflow!=='ready'?'<button class="secondary" type="button" data-listing="'+id+'">Listing draft</button>':'')+
    (own||reference?'<button class="secondary" type="button" '+(own?'data-photo':'data-reference')+'="'+id+'">View photo</button>':'')+
    extras+'<button class="secondary stock-delete" type="button" data-stock-delete="'+id+'">Delete stock item</button></div></details>';
}

function stockCard(item) {
  const {src,reference,own}=stockPicture(item);
  const order=item.status==='Sold'&&lastTrade(db,item.id);
  const workflow=stockWorkflow(item);
  const status=order?tradeStatus(order):workflow==='returns'&&item.status!=='In Stock'?item.status:
    stockWorkflows.find(([key])=>key===workflow)?.[1]||item.status;
  const active=item.status==='In Stock';
  const value=(label,amount)=>'<div><dt>'+label+'</dt><dd>'+gbp(amount)+'</dd></div>';
  const image=(src?'<img src="'+src+'" alt="" loading="lazy" decoding="async">':
    '<span class="stock-photo-empty"><svg viewBox="0 0 32 32" width="27" height="27" fill="none" stroke="currentColor" stroke-width="1.35" aria-hidden="true"><rect x="5" y="7" width="22" height="18" rx="4"/><circle cx="12" cy="13" r="2"/><path d="m6 22 6-5 4 3 4-5 6 7"/></svg><span>No photo yet</span></span>')+
    (!own&&reference?'<span class="stock-reference">Reference photo</span>':'');
  const title=esc(item.name);
  const editor='type="button" data-edit="'+esc(item.id)+'"';
  return '<article class="stock-card" data-stock-entry><div class="stock-image-wrap">'+stockSelectionBox(item)+
    (isReadOnly()?'<div class="stock-image">'+image+'</div>':'<button class="stock-image" '+editor+' aria-label="Open '+title+'">'+image+'</button>')+
    '<span class="stock-state" data-workflow="'+workflow+'">'+esc(status)+'</span></div>'+
    '<div class="stock-card-body"><div class="stock-card-title"><small>'+esc([item.brand,item.id].filter(Boolean).join(' · '))+'</small>'+
    (isReadOnly()?'<h2>'+title+'</h2>':'<h2><button '+editor+'>'+title+'</button></h2>')+
    '<div class="stock-card-meta">'+[item.size,item.location].filter(Boolean).map(detail=>'<span class="stock-size">'+esc(detail)+'</span>').join('')+'</div>'+
    '</div><dl class="stock-card-values">'+value('Paid',item.cost)+
    value(active?'Asking':item.status==='Sold'?'Sold for':'Refund',active?item.price:proceeds(item))+
    value(active?'Est. profit':'Profit',profit(item))+'</dl>'+
    (item.bulkOrderId?'<button class="order-stock-source link" data-order-origin="'+esc(item.bulkOrderId)+'">'+esc(orderSource(item))+' ↗</button>':'')+
    (isReadOnly()?'':'<div class="stock-card-actions">'+stockNextAction(item)+stockMore(item)+'</div>')+'</div></article>';
}

function stockMatchesSearch(item, needle) {
  return [item.name,item.brand,item.id,item.size,item.location,orderSource(item)]
    .join(' ').toLowerCase().includes(needle);
}

const stockFacetValue = (item, field) => String(item[field] ?? '').trim();

function stockFacetOptions(items, field, selected, label) {
  const values = [...new Set(items.map(item=>stockFacetValue(item,field)).filter(Boolean))];
  if (selected && !values.includes(selected)) values.push(selected);
  return '<option value="">'+label+'</option>'+options(values.sort((a,b)=>a.localeCompare(b)),selected);
}

function visibleStock() {
  const needle=query.trim().toLowerCase();
  if(stockAgeView){
    const asOf=todayUK();
    return db.items.filter(item=>!item.deletedAt&&item.status==='In Stock'&&
      (stockAgeFilter!=='30+'||(daysListed(item,asOf)??-1)>=30)&&
      (stockAgeFilter!=='60+'||(daysUnsold(item,asOf)??-1)>=60)&&
      stockMatchesSearch(item,needle))
      .sort((a,b)=>(stockAgeFilter==='30+' ? (daysListed(b,asOf)??-1)-(daysListed(a,asOf)??-1) : 0)||
        (daysUnsold(b,asOf)??-1)-(daysUnsold(a,asOf)??-1)||b.cost-a.cost);
  }
  return db.items.filter(item=>!item.deletedAt&&(filter==='All'||filter===item.status)&&
    (stockWorkflowFilter==='all'||stockWorkflow(item)===stockWorkflowFilter)&&
    (!stockBrand||stockFacetValue(item,'brand')===stockBrand)&&
    (!stockLocation||stockFacetValue(item,'location')===stockLocation)&&
    stockMatchesSearch(item,needle))
    .sort((a,b)=>sortBy==='name'?a.name.localeCompare(b.name):sortBy==='profit'?(profit(b)??-Infinity)-(profit(a)??-Infinity):
      sortBy==='cost'?b.cost-a.cost:sortBy==='oldest'?(a.purchasedAt||'9999').localeCompare(b.purchasedAt||'9999'):
        (b.purchasedAt||'').localeCompare(a.purchasedAt||''));
}

function stockResults() {
  const items=visibleStock();
  const showReset=query.trim() || (stockAgeView ? stockAgeFilter!=='all' :
    filter!=='All' || stockWorkflowFilter!=='all' || stockBrand || stockLocation);
  const summary='<div class="stock-results-heading"><div><strong>'+items.length+' '+(items.length===1?'item':'items')+
    '</strong><span>'+gbp(total(items,item=>item.cost))+' purchase cost</span></div>'+
    (showReset?'<button class="secondary" type="button" data-reset-filters>Clear filters</button>':'')+'</div>';
  const hasStock=db.items.some(item=>!item.deletedAt);
  if (!items.length) {
    return summary+'<section class="stock-empty"><h2>'+(!hasStock?'Your next find starts here.':'No matching stock')+
      '</h2><p>'+(!hasStock?'Add your first item to start tracking it.':'Try a different search or clear your filters.')+'</p>'+
      (!hasStock&&!isReadOnly()?'<button class="secondary" data-add-piece>Add stock</button>':'')+'</section>';
  }
  if(stockAgeView){
    const asOf=todayUK();
    return summary+'<div class="age-list">'+items.map(item=>{
      const listed=daysListed(item,asOf), unsold=daysUnsold(item,asOf);
      const age = unsold===null ? 'Purchase date needed' : unsold+' days in stock';
      const details = [listed===null ? '' : listed+' days listed',Number.isFinite(item.price)?gbp(item.price)+' asking':'',
        item.priceChangedAt ? 'Price updated '+dateLabel(item.priceChangedAt) : ''].filter(Boolean);
      const picture = stockPicture(item);
      const thumbnail = picture.src ? '<img class="age-list-photo" src="'+esc(picture.src)+'" alt="" loading="lazy">' :
        '<span class="age-list-photo" aria-hidden="true">▣</span>';
      return '<div class="age-list-row" data-stock-entry>'+stockSelectionBox(item)+thumbnail+
        '<div class="age-list-copy">'+(isReadOnly()?'<strong>'+esc(item.name)+'</strong>':
          '<button class="link" data-edit="'+esc(item.id)+'">'+esc(item.name)+'</button>')+
        '<small class="'+(unsold>=60?'age-warning':'')+'">'+esc(age)+'</small>'+
        (details.length?'<small>'+esc(details.join(' · '))+'</small>':'')+'</div>'+
        '<div class="age-list-cost"><strong>'+gbp(item.cost)+'</strong><small>cost</small></div></div>';
    }).join('')+'</div>';

  }
  const layout=stockLayout();
  return summary+(layout==='cards' ? '<div class="stock-card-grid">'+items.map(stockCard).join('')+'</div>' :
    table(['Item','Total cost','Asking / proceeds','Profit','ROI','Status','Actions'],items.map(row).join(''),
      'id="stockBoard" data-layout="'+layout+'"'));
}

function stockPage() {
  const inventory=db.items.filter(item=>!item.deletedAt);
  const active=inventory.filter(item=>item.status==='In Stock');
  const cost=total(active,item=>item.cost);
  const listed=active.filter(item=>stockWorkflow(item)==='listed');
  const asOf=todayUK();
  const ageing=listed.filter(item=>(daysListed(item,asOf)??-1)>=30);
  const arriving=active.filter(item=>stockWorkflow(item)==='arriving');
  const ready=active.filter(item=>stockWorkflow(item)==='ready');
  const needsPhotos=active.filter(item=>stockWorkflow(item)==='photos');
  const cues=[
    ['arriving','Arriving',arriving.length],
    ['photos','Need photos',needsPhotos.length],
    ['ready','Ready to list',ready.length],
    ['ageing','Listed 30+ days',ageing.length]
  ].filter(([, ,count])=>count);
  const pip='<aside class="stock-pip">'+blobCharacter()+'<div class="stock-pip-copy"><strong>Pip’s stock check</strong>'+
    '<p>'+(cues.length?'Pick a task to see the matching items.':'You’re up to date on photos, listing drafts and ageing listings.')+'</p></div>'+
    '<div class="stock-pip-actions">'+cues.map(([key,label,count])=>
      '<button type="button" data-stock-jump="'+key+'">'+count+' '+label+'</button>').join('')+
    '<button type="button" data-guide>Open Pip review <span aria-hidden="true">↗</span></button></div></aside>';
  const viewSwitch='<div class="stock-view-switch" role="group" aria-label="Stock view">'+
    '<button type="button" data-stock-view="collection" aria-pressed="'+!stockAgeView+'">Collection</button>'+
    '<button type="button" data-stock-view="ageing" aria-pressed="'+stockAgeView+'">Ageing stock</button></div>';
  return (stockAgeView?'<section class="stock-overview" aria-label="Ageing summary"><div><span>Cash tied up in unsold stock</span><strong>'+gbp(cost)+
      '</strong></div><div><span>Listed 30+ days</span><strong>'+ageing.length+'</strong><small>'+gbp(total(ageing,item=>item.cost))+
      ' at purchase cost</small></div><div><span>Active listings</span><strong>'+listed.length+'</strong><small>'+
      listed.filter(item=>daysListed(item,asOf)===null).length+' without a listing date</small></div></section>'+
      '<p class="stock-age-explainer">Review older listings first. Listing age uses your recorded listed date. Asking price updates are recorded from now on.</p>':
      '<section class="stock-overview" aria-label="Stock summary"><div><span>In stock</span><strong>'+active.length+'</strong></div>'+
      '<div><span>At purchase cost</span><strong>'+gbp(cost)+'</strong></div><div><span>Forecast profit</span><strong>'+
      gbp(total(active.filter(item=>Number.isFinite(item.price)),item=>profit(item)))+'</strong></div></section>'+
      pip)+
    '<section class="stock-controls" aria-label="Stock filters"><div class="stock-toolbar">'+viewSwitch+
    '<div class="stock-toolbar-actions">'+
    (stockAgeView?'':'<select id="stockLayout" aria-label="Stock layout">'+[['cards','Photo grid'],['list','Detailed list'],['compact','Compact list']].map(([value,label])=>
      '<option value="'+value+'" '+(stockLayout()===value?'selected':'')+'>'+label+'</option>').join('')+'</select>')+
    (isReadOnly()?'':'<button class="secondary shot-import-open" type="button" data-shot-import>Add from screenshots</button>')+
    '<button id="stockSelectToggle" class="secondary" type="button" data-bulk="toggle" aria-pressed="'+selectingStock+'">'+
      (selectingStock?'Exit selection':'Select items')+'</button></div></div>'+
    '<input id="search" type="search" placeholder="Search stock" aria-label="Search name, brand, size or stock ID" value="'+esc(query)+'">'+
    (stockAgeView?'<div class="stock-filters" role="group" aria-label="Age filters">'+ageFilters.map(([key,label])=>
      '<button type="button" data-stock-age="'+key+'" aria-pressed="'+(stockAgeFilter===key)+'">'+label+'</button>').join('')+'</div>':
      '<div class="stock-filters" role="group" aria-label="Workflow filters">'+stockWorkflows.map(([key,label])=>
        '<button type="button" data-stock-filter="'+key+'" aria-pressed="'+(stockWorkflowFilter===key)+'">'+label+
        ' <span>'+inventory.filter(item=>key==='all'||stockWorkflow(item)===key).length+'</span></button>').join('')+'</div>')+
    (stockAgeView?'':'<details id="stockTools" class="stock-tools" '+(stockToolsOpen?'open':'')+'><summary>Filters &amp; tools'+
      ([filter!=='All'?filter:'',stockBrand,stockLocation].filter(Boolean).length?' <span>· '+esc([filter!=='All'?filter:'',stockBrand,stockLocation].filter(Boolean).join(' · '))+'</span>':'')+'</summary><div class="stock-tool-options"><label>Status <select id="filter" aria-label="Filter stock by status">'+
      options(['All','In Stock','Sold','Refund pending','Refunded'],filter)+'</select></label><label>Sort <select id="sortStock" aria-label="Sort stock">'+
      [['newest','Newest purchases'],['oldest','Oldest purchases'],['profit','Highest profit'],['cost','Highest cost'],['name','Item name A–Z']].map(([value,label])=>
        '<option value="'+value+'" '+(sortBy===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
      '<label>Brand <select id="stockBrand">'+stockFacetOptions(inventory,'brand',stockBrand,'All brands')+'</select></label>'+
      '<label>Storage location <select id="stockLocation">'+stockFacetOptions(inventory,'location',stockLocation,'All locations')+'</select></label>'+
      (!isReadOnly()?tradeButton('lookup','Find stock label')+tradeButton('bundleBuy','Purchase bundle')+tradeButton('bundleSell','Sell bundle'):'')+
      '</div></details>')+'</section>'+selectionPanel()+'<div id="stockResults">'+stockResults()+'</div>';
}

function resetStockFilters() {
  query='';
  filter='All';
  stockWorkflowFilter='all';
  stockAgeFilter='all';
  stockBrand='';
  stockLocation='';
}

function connectStockControls() {
  $('search').oninput=event=>{
    query=event.target.value;
    $('stockResults').innerHTML=stockResults();
    labelViewCells($('stockResults'));
    applyReadOnlyControls();
    refreshStockSelection();
  };
  if(stockAgeView)return;
  $('stockTools').ontoggle=event=>{stockToolsOpen=event.target.open;};
  $('stockLayout').onchange=event=>{
    layoutPreference=event.target.value;
    try{localStorage.setItem('stockroom.layout:'+account.id,layoutPreference);}catch{}
    render();
    $('stockLayout').focus({preventScroll:true});
  };
  for (const [id,update] of [['stockBrand',value=>{stockBrand=value;}],['stockLocation',value=>{stockLocation=value;}]]) {
    $(id).onchange=event=>{
      update(event.target.value);
      stockToolsOpen=true;
      render();
      $(id).focus({preventScroll:true});
    };
  }
  $('sortStock').onchange=event=>{sortBy=event.target.value;render();$('sortStock').focus({preventScroll:true});};
  $('filter').onchange=event=>{
    filter=event.target.value;
    stockWorkflowFilter='all';
    render();
    $('filter').focus({preventScroll:true});
  };
}

function initialiseStock() {
  const deleteDialog=$('stockDeleteDialog');
  const deleteButton=$('confirmStockDelete');
  deleteButton.onclick=async()=>{
    const id=deleteDialog.dataset.stockId;
    if(tab!=='Stock'||isReadOnly()||!db.items.some(row=>row.id===id&&!row.deletedAt)){
      closePanel(deleteDialog);
      return;
    }
    deleteButton.disabled=true;
    try{
      await persist({...db,items:db.items.map(row=>row.id===id?{...row,deletedAt:todayUK()}:row)});
      selectedStock.delete(id);
      refreshStockSelection();
      closePanel(deleteDialog);
      toast('Stock item deleted.');
    }catch(error){toast(error.message);}
    finally{deleteButton.disabled=false;}
  };
  document.addEventListener('click',async event=>{
    const remove=event.target.closest('[data-stock-delete]');
    if(remove&&tab==='Stock'&&!isReadOnly()){
      const item=db.items.find(row=>row.id===remove.dataset.stockDelete&&!row.deletedAt);
      if(!item)return;
      deleteDialog.dataset.stockId=item.id;
      $('stockDeleteName').textContent=item.name;
      openPanel(deleteDialog);
      return;
    }
    const control=event.target.closest('[data-stock-filter],[data-stock-view],[data-stock-age],[data-stock-jump],[data-stock-receive],[data-stock-add-photos]');
    if(!control||tab!=='Stock')return;
    const {stockFilter,stockView,stockAge,stockJump,stockReceive,stockAddPhotos}=control.dataset;
    if(stockAddPhotos!==undefined){
      const item=db.items.find(row=>row.id===stockAddPhotos);
      if(!item||isReadOnly())return;
      openItem(item);
      $('photos').focus();
      return;
    }
    if(stockReceive!==undefined){
      if(isReadOnly()||control.disabled)return;
      const item=db.items.find(row=>row.id===stockReceive);
      if(!item||stockWorkflow(item)!=='arriving')return;
      control.disabled=true;
      try{
        await persist({...db,items:db.items.map(row=>row.id===item.id?{...row,receivedAt:todayUK(),
          stage:row.photos?.some(photoUrl)?'Ready to list':'Ready to photograph'}:row)});
        toast('Received date saved.');
      }catch(error){toast(error.message);}
      finally{control.disabled=false;}
      return;
    }
    if(stockView)stockAgeView=stockView==='ageing';
    if(stockAge)stockAgeFilter=stockAge;
    if(stockFilter){stockWorkflowFilter=stockFilter;filter='All';}
    if(stockJump){
      resetStockFilters();
      stockAgeView=stockJump==='ageing';
      if(stockAgeView)stockAgeFilter='30+';
      else stockWorkflowFilter=stockJump;
    }
    render();
    const next=stockJump?document.querySelector(stockAgeView?'[data-stock-age="30+"]':'[data-stock-filter][aria-pressed="true"]'):
      document.querySelector(stockView?'[data-stock-view][aria-pressed="true"]':stockAge?'[data-stock-age][aria-pressed="true"]':
        '[data-stock-filter][aria-pressed="true"]');
    next?.focus({preventScroll:true});
    if(stockJump)next?.scrollIntoView({block:'nearest'});
  });
  document.addEventListener('click',event=>{
    for(const menu of document.querySelectorAll('.stock-more[open]')){
      if(!menu.contains(event.target)||event.target.closest('.stock-more button'))menu.open=false;
    }
  });
}
