'use strict';
let selectingStock = false;
const selectedStock = new Set();

function resetStockSelection() {
  selectingStock = false;
  selectedStock.clear();
}
function selectedItems() {
  return db.items.filter(item=>!item.deletedAt&&selectedStock.has(item.id));
}

function selectionTotals(items, linkedExpenses = []) {
  const summary={cost:0,projectedPrice:0,projectedProfit:0,actualProceeds:0,realisedProfit:0,unpriced:0,pending:0,projectedCount:0,actualCount:0};
  const expenseByItem=new Map();
  for(const row of linkedExpenses) if(row[6]) expenseByItem.set(row[6],(expenseByItem.get(row[6])||0)+cents(row[1]));
  for(const item of items){
    summary.cost+=cents(item.cost);
    const linked=expenseByItem.get(item.id)||0;
    if(item.status==='In Stock'){
      if(!Number.isFinite(item.price)){summary.unpriced++;continue;}
      summary.projectedCount++;
      summary.projectedPrice+=cents(item.price);
      summary.projectedProfit+=cents(item.price)-cents(item.cost)-linked;
    } else if(item.status==='Refund pending')summary.pending++;
    else {
      const amount=proceeds(item), margin=profit(item);
      if(!Number.isFinite(amount)||!Number.isFinite(margin))continue;
      summary.actualCount++;
      summary.actualProceeds+=cents(amount);
      summary.realisedProfit+=cents(margin)-linked;
    }
  }
  return summary;
}

function selectionPanel() {
  return '<section id="stockSelection" class="selection-panel" '+(selectingStock?'':'hidden')+'></section>';
}

function refreshStockSelection() {
  const panel=$('stockSelection');
  const jump=$('selectionSummaryJump');
  if(!panel||!selectingStock){jump.hidden=true;return;}
  const items=selectedItems();
  const available=items.filter(item=>item.status==='In Stock');
  const totals=selectionTotals(items,db.expenses);
  jump.hidden=!items.length;
  jump.textContent=items.length+' selected · Review totals ↑';
  const visible=visibleStock();
  const count=visible.filter(item=>!item.deletedAt&&selectedStock.has(item.id)).length;
  const hidden=items.length-count;
  const value=(label,amount)=>'<div><span>'+label+'</span><strong>'+gbp(pounds(amount))+'</strong></div>';
  panel.innerHTML='<div class="selection-head"><strong>'+items.length+' selected</strong><div class="selection-actions">'+
    '<button type="button" class="secondary" data-bulk="all" '+(!visible.length||count===visible.length?'disabled':'')+'>Select visible</button>'+
    '<button type="button" class="secondary" data-bulk="clear" '+(!items.length?'disabled':'')+'>Clear</button>'+
    '<button type="button" class="link" data-bulk="toggle">Done</button></div></div>'+
    (items.length?'<div class="selection-totals" aria-live="polite">'+value('Total purchase cost',totals.cost)+
      (totals.projectedCount?value('Asking total',totals.projectedPrice)+value('Forecast profit',totals.projectedProfit):'')+
      (totals.actualCount?value('Actual proceeds',totals.actualProceeds)+value('Actual profit',totals.realisedProfit):'')+'</div>'+
      '<p class="footnote">'+[hidden?hidden+' selected outside this filter':'',totals.unpriced?totals.unpriced+' unpriced, excluded from forecast':'',totals.pending?totals.pending+' refunds pending':'','Profit includes linked expenses'].filter(Boolean).join(' · ')+'</p>'+
      '<div class="selection-actions"><button type="button" class="secondary" data-bulk="csv">Export selected CSV</button>'+
      (!isReadOnly()?'<button type="button" class="secondary" data-bulk="labels">Print selected labels</button>':'')+
      (!isReadOnly()&&available.length?'<button type="button" class="secondary" data-bulk="edit">Update available items</button>':'')+
      (!isReadOnly()&&available.length>=2?'<button type="button" class="secondary" data-bulk="sell">Sell selected as bundle</button>':'')+'</div>':
      '<p class="footnote">Tick the items you want to total or update.</p>');
  for(const checkbox of document.querySelectorAll('[data-select-stock]')){
    checkbox.checked=selectedStock.has(checkbox.dataset.selectStock);
    checkbox.closest('[data-stock-entry]')?.classList.toggle('selected-stock',checkbox.checked);
  }
}

function exportSelection(items) {
  const t = item => selectionTotals([item], db.expenses);
  exportCsv('Stockroom stock - ' + todayUK(), [
    {label: 'Stock ID', get: i => i.id}, {label: 'Brand', get: i => i.brand}, {label: 'Item', get: i => i.name}, {label: 'Size', get: i => i.size},
    {label: 'Condition', get: i => i.condition}, {label: 'Status', get: i => i.status}, {label: 'Purchased', type: 'date', get: i => i.purchasedAt},
    {label: 'Listed', type: 'date', get: i => i.listedAt}, {label: 'Purchase cost (GBP)', type: 'money', get: i => i.cost},
    {label: 'Asking price (GBP)', type: 'money', get: i => i.status === 'In Stock' ? i.price : null},
    {label: 'Sold for (GBP)', type: 'money', get: i => t(i).actualCount ? pounds(t(i).actualProceeds) : null},
    {label: 'Forecast profit (GBP)', type: 'money', get: i => t(i).projectedCount ? pounds(t(i).projectedProfit) : null},
    {label: 'Actual profit (GBP)', type: 'money', get: i => t(i).actualCount ? pounds(t(i).realisedProfit) : null},
  ], items, {total: true});
}

function initialiseBulk() {
  const dialog=$('bulkDialog');
  const form=$('bulkForm');
  let ids=[];
  $('selectionSummaryJump').onclick=()=>{
    const panel=$('stockSelection');
    panel?.scrollIntoView({block:'start',behavior:motionOK()?'smooth':'instant'});
  };
  document.addEventListener('change',event=>{
    const input=event.target.closest('[data-select-stock]');
    if(!input)return;
    if(input.checked)selectedStock.add(input.dataset.selectStock);
    else selectedStock.delete(input.dataset.selectStock);
    refreshStockSelection();
  });
  document.addEventListener('click',event=>{
    const control=event.target.closest('[data-bulk]');
    if(!control)return;
    const action=control.dataset.bulk;
    if(action==='toggle'){
      if(selectingStock)resetStockSelection();else selectingStock=true;
      render();
      $('stockSelectToggle')?.focus({preventScroll:true});
      return;
    }
    if(action==='clear')selectedStock.clear();
    if(action==='all')for(const item of visibleStock())selectedStock.add(item.id);
    if(['clear','all'].includes(action)){
      refreshStockSelection();
      const destination=document.querySelector('[data-bulk=toggle]:not(#stockSelectToggle)');
      destination?.focus({preventScroll:true});
      return;
    }
    const items=selectedItems();
    if(action==='csv'){exportSelection(items);return;}
    if(isReadOnly())return;
    if(action==='labels'&&items.length){stockLabel(items);return;}
    const available=items.filter(item=>item.status==='In Stock');
    if(action==='sell'&&available.length>=2){
      tradeEditor('bundleSell');
      const wanted=new Set(available.map(item=>item.id));
      for(const input of $('tradeForm').querySelectorAll('[name=items]'))input.checked=wanted.has(input.value);
      $('tradeDialog').dataset.baseline=panelSnapshot($('tradeDialog'));
    }
    if(action==='edit'&&available.length){
      ids=available.map(item=>item.id);
      $('bulkCount').textContent='Apply changes to '+ids.length+' available '+(ids.length===1?'item.':'items.')+(items.length!==ids.length?' Sold and returned items are excluded.':'');
      $('bulkError').textContent='';
      form.reset();
      openPanel(dialog);
    }
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(isReadOnly()||$('bulkSave').disabled||dialog.classList.contains('is-closing'))return;
    const fields=new FormData(form);
    const stage=String(fields.get('stage')||'');
    const price=String(fields.get('price')||'');
    if(!stage&&!price){$('bulkError').textContent='Enter a price or select a stage.';return;}
    const targets=new Set(ids);
    if(db.items.filter(item=>!item.deletedAt&&targets.has(item.id)&&item.status==='In Stock').length!==ids.length){
      $('bulkError').textContent='Selected stock changed. Close and review the selection.';return;
    }
    $('bulkSave').disabled=true;
    $('bulkError').textContent='';
    try{
      await persist({...db,items:db.items.map(item=>targets.has(item.id)?{...item,
        ...(stage?{stage}:{}),
        ...(price?askingPriceFields(item,Number(price)):{})
      }:item)});
      closePanel(dialog);
      toast('Updated '+ids.length+' '+(ids.length===1?'item.':'items.'));
    }catch(error){$('bulkError').textContent=error.message;}
    finally{$('bulkSave').disabled=false;}
  });
}
