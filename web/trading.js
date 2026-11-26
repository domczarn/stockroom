'use strict';
const orderStages = ['Sold','Posted','Completed','Paid'];
const stockStages = ['Awaiting delivery','Ready to photograph','Ready to list','Listed','Return inspection'];
const cents = value => Math.round(Number(value)*100);
const pounds = value => value/100;
function lastTrade(data, id) {
  const trades = data.trades || [];
  for (let index = trades.length - 1; index >= 0; index--) {
    if (trades[index].itemId === id) return trades[index];
  }
}
const refunded = trade => pounds(trade.refunds.reduce((sum,r)=>sum+cents(r.amount),0));
const saleRemaining = trade => pounds(cents(trade.amount)-cents(refunded(trade)));

function accountingRows(data) {
  const trades = data.trades || [];
  const recorded = new Set(trades.map(trade=>trade.itemId));
  const items = new Map(data.items.map(item=>[item.id,item]));
  const rows = [];
  for (const trade of trades) {
    const name = items.get(trade.itemId)?.name || trade.name;
    rows.push({kind:'Sale',name,date:trade.soldAt,time:trade.soldTime||'',revenue:trade.amount,cost:trade.cost,expense:trade.extraCost||0});
    for (const refund of trade.refunds) rows.push({kind:'Sale refund',name,date:refund.date,revenue:-refund.amount,cost:refund.restock?-trade.cost:0,expense:refund.postage});
  }
  for (const item of data.items) {
    // No sale date recorded: fall back to the item's latest known date so every time range counts it the same way.
    const lastSeen = item.priceChangedAt||item.listedAt||item.receivedAt||item.purchasedAt||'';
    if (!recorded.has(item.id) && item.status==='Sold' && Number.isFinite(item.sale))
      rows.push({kind:'Sale',name:item.name,date:item.soldAt||lastSeen,estimated:!item.soldAt,revenue:item.sale,cost:item.cost,expense:0});
    if (item.status==='Refunded' && Number.isFinite(item.refund))
      rows.push({kind:'Purchase refund',name:item.name,date:item.refundedAt||lastSeen,estimated:!item.refundedAt,revenue:0,cost:0,expense:pounds(cents(item.cost)-cents(item.refund))});
  }
  for (const row of data.sales) rows.push({kind:'Sale',name:row[0],date:row[4]||'',revenue:row[1],cost:row[3]??null,expense:0});
  for (const row of data.expenses) rows.push({kind:'Expense',name:row[0],date:row[4]||'',revenue:0,cost:0,expense:row[1]});
  return rows;
}

// The Home numbers on phone and web: sales only (sale price − item cost − sale costs, minus returns).
// Business expenses and purchase refunds live in Money → Reports, so Home never jumps when you log a parcel bag.
const saleRows = rows => rows.filter(row => row.kind === 'Sale' || row.kind === 'Sale refund');
function reportTotals(rows) {
  const sum = key => pounds(rows.reduce((n,row)=>n+cents(row[key]??0),0));
  const revenue = sum('revenue'), cost = sum('cost'), expense = sum('expense');
  return {revenue,cost,expense,profit:pounds(cents(revenue)-cents(cost)-cents(expense)),missing:rows.filter(row=>row.cost===null).length};
}

function splitCost(amount, weights) {
  const paid = cents(amount);
  const sum = weights.reduce((a,b)=>a+b,0);
  const parts = weights.map((weight,index)=>{
    const exact=paid*(sum?weight/sum:1/weights.length);
    return {index,floor:Math.floor(exact),fraction:exact-Math.floor(exact)};
  });
  const rest = paid-parts.reduce((n,p)=>n+p.floor,0);
  const sorted = [...parts].sort((a,b)=>b.fraction-a.fraction||a.index-b.index);
  for (let i=0;i<rest;i++) sorted[i].floor++;
  return parts.map(part=>pounds(part.floor));
}

function recordSale(data, itemId, amount, soldAt, receipt, extraCost = 0) {
  const item = data.items.find(row=>row.id===itemId);
  const last = lastTrade(data,itemId);
  if (!item || !['In Stock','Sold'].includes(item.status) || (last && (item.status!=='In Stock'||!last.refunds.some(r=>r.restock))))
    throw Error('This item already has a sale. Open its order history.');
  const lastRefund = last?.refunds.slice(-1)[0];
  if (lastRefund && soldAt < lastRefund.date) throw Error('A resale must come after the previous return.');
  if (!Number.isFinite(amount) || amount<=0 || !soldAt || (item.purchasedAt && soldAt<item.purchasedAt))
    throw Error('Enter a sale amount and a date on or after purchase.');
  const next = cloneWorkspace(data);
  const current = next.items.find(row=>row.id===itemId);
  const trade = {id:newId(),itemId,name:item.name,cost:item.cost,amount,soldAt,listedAt:item.listedAt||'',refunds:[],orderId:receipt?.transactionId||''};
  if (Number.isFinite(extraCost) && extraCost > 0) trade.extraCost = Math.round(extraCost * 100) / 100;
  // When it sold, to the minute: the Vinted email's time, or now if you're recording it today. Powers the 24H chart.
  const today = typeof todayUK === 'function' ? todayUK() : new Date().toISOString().slice(0, 10);
  const at = receipt?.at && /^\d{4}-\d\d-\d\dT/.test(receipt.at) ? receipt.at : soldAt === today ? new Date().toISOString() : '';
  if (at && at.slice(0, 10) <= soldAt) trade.soldTime = new Date(at).toISOString();
  (next.trades ||= []).push(trade);
  Object.assign(current,{status:'Sold',sale:amount,soldAt,stage:''});
  return next;
}

function advanceOrder(data, itemId, stage, date, paidAmount, receipt) {
  const next = cloneWorkspace(data);
  const trade = lastTrade(next,itemId);
  if (!trade || trade.refunds.some(r=>r.restock)) throw Error('This order is closed.');
  if (receipt && trade.orderId && receipt.transactionId!==trade.orderId) throw Error('This receipt belongs to a different order.');
  const fields = {Posted:'postedAt',Completed:'completedAt',Paid:'paidAt'};
  const current = trade.paidAt?'Paid':trade.completedAt?'Completed':trade.postedAt?'Posted':'Sold';
  if (!fields[stage] || orderStages.indexOf(stage)<=orderStages.indexOf(current)) throw Error('Choose a later order stage.');
  if (!date || date<(trade.paidAt||trade.completedAt||trade.postedAt||trade.soldAt)) throw Error('Choose a date on or after the last order update.');
  if (stage==='Paid' && (!Number.isFinite(paidAmount)||paidAmount<0)) throw Error('Enter the amount actually paid out.');
  trade[fields[stage]]=date;
  if (stage==='Paid') trade.paidAmount=paidAmount;
  if (receipt) trade.orderId=receipt.transactionId;
  return next;
}

function returnSale(data, itemId, refund, receipt) {
  const next = cloneWorkspace(data);
  const trade = lastTrade(next,itemId);
  if (!trade || trade.refunds.some(r=>r.restock)) throw Error('This order is closed.');
  if (receipt && trade.orderId && receipt.transactionId!==trade.orderId) throw Error('This receipt belongs to a different order.');
  if (!refund.date || refund.date<(trade.refunds.slice(-1)[0]?.date||trade.soldAt) || !refund.reason.trim() || !Number.isFinite(refund.amount) || refund.amount<=0 || refund.amount>saleRemaining(trade) || !Number.isFinite(refund.postage) || refund.postage<0)
    throw Error('Enter a refund within the remaining sale amount, a valid date, and a reason.');
  if (refund.restock && refund.amount!==saleRemaining(trade)) throw Error('Restocking requires refunding the full remaining sale amount.');
  if (receipt) trade.orderId=receipt.transactionId;
  trade.refunds.push(refund);
  const item=next.items.find(row=>row.id===itemId);
  if (refund.restock) Object.assign(item,{status:'In Stock',sale:null,soldAt:'',listedAt:'',stage:'Return inspection'});
  return next;
}

let reportMonth = '';
let tradeReceipt = null;
let saleReceipts = [];
let saleReceiptsLoaded = false;
let openTradeItem = '';
let dialogAction = '';

const tradeButton = (action,label,id='')=>'<button type="button" class="secondary" data-trade="'+action+'" data-stock-id="'+esc(id)+'">'+label+'</button>';
const options = (values,selected='')=>values.map(value=>'<option '+(value===selected?'selected':'')+'>'+esc(value)+'</option>').join('');
const moneyInput = (name,label,value='',required=true)=>'<label>'+label+'<input type="number" inputmode="decimal" min="0" max="1000000" step=".01" name="'+name+'" value="'+esc(value)+'" '+(required?'required':'')+'></label>';
const dateInput = (value=todayUK())=>'<label>Date<input name="date" type="date" value="'+esc(value)+'" max="'+todayUK()+'" required></label>';
const itemOptions = items=>items.map(item=>'<option value="'+esc(item.id)+'">'+esc(item.id+' · '+item.name)+'</option>').join('');
const tradeStatus = trade=>trade.refunds.some(r=>r.restock)?'Returned':trade.paidAt?'Paid':trade.completedAt?'Completed':trade.postedAt?'Posted':'Sold';
const payoutEstimate = trade=>trade.paidAt?0:saleRemaining(trade);

function tradeHistory(item) {
  if (!item) return '';
  const trades=(db.trades||[]).filter(row=>row.itemId===item.id).reverse();
  if (!trades.length) return '';
  return '<div class="trade-history"><h3>Sale and return history</h3>'+trades.map(trade=>
    '<div class="trade-record"><strong>'+gbp(trade.amount)+' · '+tradeStatus(trade)+'</strong><small>Sold '+esc(dateLabel(trade.soldAt))+
    (trade.postedAt?' · Posted '+esc(dateLabel(trade.postedAt)):'')+(trade.completedAt?' · Completed '+esc(dateLabel(trade.completedAt)):'')+
    (trade.paidAt?' · Paid '+gbp(trade.paidAmount)+' on '+esc(dateLabel(trade.paidAt)):'')+'</small>'+
    trade.refunds.map(refund=>'<small>'+esc(dateLabel(refund.date))+' · Refunded '+gbp(refund.amount)+' · Return postage '+gbp(refund.postage)+' · '+esc(refund.reason)+'</small>').join('')+'</div>').join('')+'</div>';
}

function reportsView() {
  const all = accountingRows(db);
  const months = [...new Set(all.map(row=>row.date.slice(0,7)).filter(Boolean))].sort().reverse();
  const rows = all.filter(row=>!reportMonth||row.date.startsWith(reportMonth));
  const summary=reportTotals(rows);
  const pending=pounds((db.trades||[]).reduce((n,trade)=>n+cents(payoutEstimate(trade)),0));
  const sorted=[...rows].sort((a,b)=>b.date.localeCompare(a.date));
  return '<div class="tools"><label>Period <select id="reportMonth"><option value="">All time</option>'+options(months,reportMonth)+'</select></label>'+
    tradeButton('csv','Export period CSV')+'</div><div class="metrics">'+metric('Sales revenue',gbp(summary.revenue),'After recorded sale refunds','featured')+
    metric('Net profit',gbp(summary.profit),summary.missing?summary.missing+' sale costs missing · provisional':'After costs, expenses and returns')+
    metric('Net expenses',gbp(summary.expense),'Includes return adjustments')+metric('Awaiting payout',gbp(pending),'Across all recorded orders')+'</div>'+moneyDetail()+(typeof reportingCard==='function'?reportingCard():'')+(typeof taxCard==='function'?taxCard():'')+'<h2 class="report-table-title">Transactions</h2>'+
    '<p class="footnote">'+all.filter(row=>!row.date).length+' undated entries are included in All time.</p>'+
    table(['Transaction','Date','Revenue','Cost','Expenses','Profit'],sorted.map(row=>'<tr><td><b>'+esc(row.name)+'</b><br>'+row.kind+'</td><td>'+esc(row.date?dateLabel(row.date):'Undated')+'</td><td>'+gbp(row.revenue)+'</td><td>'+gbp(row.cost)+'</td><td>'+gbp(row.expense)+'</td><td>'+gbp(row.cost===null?null:row.revenue-row.cost-row.expense)+'</td></tr>').join('')||'<tr><td colspan="6">No entries in this period.</td></tr>');
}


function csvCell(value) {
  let text=String(value??'');
  if (typeof value==='string' && /^\s*[=+\-@]/.test(text)) text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}

function exportReport() {
  const rows = accountingRows(db).filter(row=>!reportMonth||row.date.startsWith(reportMonth));
  const csv = [['Type','Item','Date','Revenue GBP','Cost GBP','Expenses GBP','Profit GBP'],
    ...rows.map(r=>[r.kind,r.name,r.date,r.revenue,r.cost,r.expense,r.cost===null?null:pounds(cents(r.revenue)-cents(r.cost)-cents(r.expense))])]
    .map(row=>row.map(csvCell).join(',')).join('\r\n');
  const link=document.createElement('a');
  link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  link.download='stockroom-'+(reportMonth||'all-time')+'.csv';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

async function loadSaleReceipts() {
  if (account?.role!=='admin' || isReadOnly()) return;
  const data=await api('/api/sale-imports');
  saleReceipts=data.events;
  saleReceiptsLoaded=true;
  renderDailyActions();
  renderNotifications();
  if(tab==='Sale receipts'&&!$('tradeDialog').open)render();
}

function receiptsView() {
  const queued=saleReceipts.filter(event=>!(db.receiptsReviewed||[]).includes(event.id));
  return '<section class="panel"><h2>Review Vinted sale receipts</h2><p>Match each receipt to the correct stock item before applying it. Payouts only count when confirmed.</p>'+tradeButton('refresh','Refresh receipts')+'</section>'+
    (queued.length?table(['Item','Stage','Date','Amount','Review'],queued.map(event=>'<tr><td>'+esc(event.name)+'</td><td>'+esc(event.stage)+'</td><td>'+esc(dateLabel(event.date))+'</td><td>'+gbp(event.amount)+'</td><td>'+tradeButton('receipt','Review',event.id)+'</td></tr>').join('')):'<p class="footnote">No receipts waiting for review.</p>');
}

function tradeEditor(action,itemId='',receipt=null) {
  const item=db.items.find(row=>row.id===itemId);
  const trade=item&&lastTrade(db,itemId);
  dialogAction=action;
  openTradeItem=itemId;
  tradeReceipt=receipt;
  let content='', title='';
  if (action==='sale') {
    title='Record sale';
    content=moneyInput('amount','Actual sale price (£)',receipt?.amount??item.sale??'')+dateInput(receipt?.date||todayUK())+
      moneyInput('extraCost','Other costs for this sale (£): postage you paid, bumps. Optional','',false);
  } else if(action==='order') {
    title='Order and payout';
    content=tradeHistory(item)+(trade&&tradeStatus(trade)!=='Returned'&&tradeStatus(trade)!=='Paid'?tradeButton('advance','Update progress',itemId):'')+
      (trade&&saleRemaining(trade)>0?tradeButton('refund','Record refund',itemId):'');
  } else if(action==='post') {
    title='Record postage';
    content=dateInput()+moneyInput('extraCost','Postage or packaging you paid (£). Leave blank if the buyer paid',trade?.extraCost||'',false);
  } else if(action==='advance') {
    title='Update order';
    const choices=orderStages.slice(orderStages.indexOf(tradeStatus(trade))+1);
    content='<label>Progress<select name="stage">'+options(choices)+'</select></label>'+dateInput()+moneyInput('paid','Actual payout (£)',saleRemaining(trade),false);
  } else if(action==='refund') {
    title='Record refund';
    content='<p>Remaining sale amount '+gbp(saleRemaining(trade))+'</p>'+moneyInput('amount','Refund amount (£)')+dateInput()+
      '<label>Reason<input name="reason" required maxlength="500" placeholder="Why was the sale refunded?"></label>'+moneyInput('postage','Return postage (£)',0)+
      '<label class="social-toggle"><input type="checkbox" name="restock"> Return the item to stock for inspection</label>';
  } else if(action==='offer') {
    title='Got an offer?';
    content='<p>Purchase cost '+gbp(item.cost)+' · Linked expenses '+gbp(total(db.expenses.filter(row=>row[6]===item.id),row=>row[1]))+'</p>'+moneyInput('amount','Offer (£)',item.price??0)+moneyInput('extra','Additional costs (£)',0)+moneyInput('goal','Target profit (£)',15)+'<div id="offerResult" class="profit-preview" aria-live="polite"></div>'+
      '<label>Buyer’s message <small>optional</small><textarea name="buyerMessage" rows="2" maxlength="800" placeholder="Paste what the buyer said, e.g. “Would you take £10?”"></textarea></label>'+
      '<button type="button" class="action pip-offer-btn" data-pip-offer><span class="pw-spark" aria-hidden="true"></span>Ask Pip what to do</button><div id="offerPip" class="offer-pip" aria-live="polite" hidden></div>';
  } else if(['bundleBuy','bundleSell'].includes(action)) {
    title=action==='bundleBuy'?'Allocate bundle purchase':'Record bundle sale';
    const eligible=db.items.filter(i=>!i.deletedAt&&i.status==='In Stock'&&(action==='bundleSell'||!lastTrade(db,i.id)));
    if(eligible.length<2){toast('Add at least two available items to create a bundle.');return;}
    content='<p>Select two or more stock items. The total is split to the penny.</p>'+
      '<fieldset class="bundle-items"><legend>Pieces</legend>'+eligible.map(i=>'<label class="social-toggle"><input type="checkbox" name="items" value="'+esc(i.id)+'"> '+esc(i.id+' · '+i.name)+'</label>').join('')+'</fieldset>'+
      moneyInput('amount','Bundle total (£)')+'<label>Split<select name="split"><option>Equal</option><option>By current cost</option></select></label>'+dateInput();
  } else if(action==='receipt') {
    title='Match sale receipt';
    const eligible=db.items.filter(i=>{
      if(i.deletedAt)return false;
      const last=lastTrade(db,i.id);
      if(receipt.stage==='sold')return i.status==='In Stock'||(i.status==='Sold'&&!last);
      return last&&(!last.orderId||last.orderId===receipt.transactionId)&&tradeStatus(last)!=='Returned';
    });
    content='<p>'+esc(receipt.name)+' · '+esc(receipt.stage)+' · '+esc(dateLabel(receipt.date))+(receipt.amount==null?'':' · '+gbp(receipt.amount))+'</p>'+
      '<label>Match to stock<select name="item" required><option value="">Choose the exact item</option>'+itemOptions(eligible)+'</select></label>'+
      (receipt.stage==='refunded'?'<label>Reason<input name="reason" required maxlength="500"></label>'+moneyInput('postage','Return postage (£)',0)+'<label class="social-toggle"><input type="checkbox" name="restock"> Return to stock for inspection</label>':'')+
      (receipt.stage==='paid'?moneyInput('paid','Actual payout (£)',receipt.amount??''):'')+tradeButton('dismiss','Already recorded');
  } else if(action==='lookup') {
    title='Find a stock label';
    content='<label>Stock ID<input name="stockId" required placeholder="e.g. 0001"></label><label id="scanInput" hidden>Scan a stock QR code or barcode<input type="file" id="scanPhoto" accept="image/*" capture="environment"></label>';
  }
  $('tradeTitle').textContent=title;
  $('tradeForm').innerHTML=(item?'<p class="trade-piece">'+esc(item.brand+' · '+item.name)+'</p>':'')+content+
    '<p id="tradeError" role="alert"></p>'+(!['order','offer'].includes(action)?'<button class="action" id="tradeSave">'+(action==='lookup'?'Find item':action==='receipt'?'Confirm and apply':'Save')+'</button>':'');
  const dialog=$('tradeDialog');
  if(!dialog.open)openPanel(dialog);
  else dialog.dataset.baseline=panelSnapshot(dialog);
  if(action==='offer')showOffer();
  if(action==='advance')updatePaidField();
  if(action==='lookup'&&'BarcodeDetector' in window) enableScan();
}

function showOffer() {
  const item=db.items.find(row=>row.id===openTradeItem);
  const fields=$('tradeForm').elements;
  const recorded = total(db.expenses.filter(row=>row[6]===item.id),row=>row[1]);
  const cost=item.cost+recorded+Number(fields.extra.value);
  const profit=Number(fields.amount.value)-cost;
  const roi=cost?((100*profit/cost).toFixed(1)+'%'):'—';
  $('offerResult').textContent='Profit '+gbp(profit)+' · ROI '+roi+' · Minimum for target '+gbp(cost+Number(fields.goal.value));
}

function updatePaidField() {
  const fields=$('tradeForm').elements;
  const paid=fields.stage.value==='Paid';
  fields.paid.closest('label').hidden=!paid;
  fields.paid.required=paid;
}

async function enableScan() {
  try {
    const formats=(await BarcodeDetector.getSupportedFormats()).filter(format=>['code_128','code_39','qr_code'].includes(format));
    if(!formats.length||!$('scanInput'))return;
    $('scanInput').hidden=false;
    $('scanPhoto').onchange=async event=>{
      const file=event.target.files[0];
      if(!file)return;
      try {
        if(file.size>25000000)throw Error('Choose a photo under 25 MB.');
        const image=await createImageBitmap(file);
        let codes;
        try{codes=await new BarcodeDetector({formats}).detect(image);}
        finally{image.close();}
        if(!codes.length)throw Error('No barcode found. Enter the printed stock ID.');
        const scanned = codes[0];
        const id = scanned.format==='qr_code' ? await scannedLabelId(scanned.rawValue) : scanned.rawValue;
        if (!id) throw Error('This QR code does not belong to your Stockroom workspace.');
        $('tradeForm').elements.stockId.value=id;
      }catch(error){toast(error.message);}
    };
  } catch {}
}

const stockLabelOrigin = 'https://stockroom.bookednpaid.com';
let labelItems = [];
let labelScope = '';
let labelPrintFrame;

async function stockLabelScope(owner) {
  const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode('stockroom-label:'+owner));
  return Array.from(new Uint8Array(hash).slice(0,8),byte=>byte.toString(16).padStart(2,'0')).join('');
}

function stockLabelUrl(id, scope) {
  return stockLabelOrigin+'/?'+new URLSearchParams({i:id,s:scope});
}

async function scannedLabelId(value) {
  try {
    const url = new URL(value);
    if (url.origin!==stockLabelOrigin || url.pathname!=='/') return '';
    const id = url.searchParams.get('i');
    const scope = url.searchParams.get('s');
    if (!id || id.length>100 || !/^[a-f0-9]{16}$/.test(scope||'')) return '';
    return scope===await stockLabelScope(workspaceOwner) ? id : '';
  } catch {
    return '';
  }
}

async function openScannedStock() {
  const params = new URLSearchParams(location.search);
  if (!params.has('i') || !params.has('s')) return;
  const id = await scannedLabelId(stockLabelUrl(params.get('i'),params.get('s')));
  history.replaceState(history.state,'',location.pathname);
  if (!id) return toast('This label belongs to a different Stockroom workspace.');
  if ((pendingLocal && !pendingOffline) || cloudConflict) return toast('Resolve your pending workspace changes, then scan the label again.');
  const item = db.items.find(row=>!row.deletedAt && row.id===id);
  if (!item) return toast('This stock item is no longer available.');
  navigate('Stock');
  openItem(item);
}

function labelElement(item) {
  const label = document.createElement('div');
  label.className = 'stock-print-label stock-qr-label';
  label.innerHTML = '<div class="stock-label-copy"><small>DOMCZARN · STOCKROOM</small><strong>'+esc(item.id)+'</strong><span>'+esc(item.name)+'</span>'+
    (item.location?'<span class="label-location">'+esc(item.location)+'</span>':'')+'</div>';
  const matrix = window.stockroomQrMatrix(stockLabelUrl(item.id,labelScope));
  const quiet = 4;
  const side = matrix.size+quiet*2;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 '+side+' '+side);
  svg.setAttribute('role','img');
  svg.setAttribute('aria-label','QR code for stock '+item.id);
  let modules = '';
  for (let row=0;row<matrix.size;row++) {
    for (let col=0;col<matrix.size;col++) {
      if (matrix.get(row,col)) modules += 'M'+(col+quiet)+' '+(row+quiet)+'h1v1h-1z';
    }
  }
  const path = document.createElementNS(svg.namespaceURI,'path');
  path.setAttribute('d',modules);
  path.setAttribute('fill','#000');
  svg.append(path);
  label.append(svg);
  return label;
}

async function stockLabel(items) {
  try {
    const owner = workspaceOwner;
    const scope = await stockLabelScope(owner);
    if (owner!==workspaceOwner) return;
    labelScope = scope;
    labelItems = Array.isArray(items)?items:[items];
    $('labelBody').replaceChildren(labelElement(labelItems[0]));
    prepareLabelPrint();
    openPanel($('labelDialog'));
  } catch {
    toast('Could not create the QR label. Try reopening the label preview.');
  }
}

function prepareLabelPrint() {
  const thermal=$('labelFormat').value==='thermal';
  const labelsPerPage=thermal?1:24;
  const count=labelItems.length;
  const pages=Math.ceil(count/labelsPerPage);
  const pageSize=thermal?'62mm 30mm':'A4 portrait';
  const margin=thermal?'0':'10mm';
  const sheets=Array.from({length:pages},(_,i)=>{
    const labels=labelItems.slice(i*labelsPerPage,(i+1)*labelsPerPage).map(item=>labelElement(item).outerHTML);
    return '<section class="label-sheet">'+labels.join('')+'</section>';
  });
  $('labelHint').textContent=count+' '+(count===1?'label':'labels')+' · '+pages+' '+(pages===1?'page':'pages')+
    '. '+(thermal?'Choose 62 × 30 mm paper in your printer settings. ':'Choose A4 paper. ')+
    'Use 100% scale and turn off headers and footers.';
  const print=$('printLabel');
  print.disabled=true;
  labelPrintFrame?.remove();
  const frame=document.createElement('iframe');
  frame.className='label-print-frame';
  frame.title='Stock label print document';
  frame.setAttribute('aria-hidden','true');
  frame.tabIndex=-1;
  frame.addEventListener('load',()=>{
    if(labelPrintFrame===frame)print.disabled=false;
  },{once:true});
  frame.srcdoc='<!doctype html><html lang="en"><meta charset="utf-8"><title>Stock labels</title>'+
    '<link rel="stylesheet" href="/labels.css"><style>@page{size:'+pageSize+';margin:'+margin+'}</style>'+
    '<body class="label-print-document" data-paper="'+(thermal?'thermal':'a4')+'">'+sheets.join('')+'</body></html>';
  labelPrintFrame=frame;
  document.body.append(frame);
}

function initialiseTrading() {
  const form=$('tradeForm');
  $('printLabel').onclick=()=>{
    if(labelPrintFrame?.contentWindow)labelPrintFrame.contentWindow.print();
  };
  $('labelFormat').onchange=prepareLabelPrint;
  $('labelDialog').addEventListener('close',()=>{
    if($('labelDialog').open)return;
    labelPrintFrame?.remove();
    labelPrintFrame=null;
    labelItems=[];
  });
  form.addEventListener('input',()=>{
    if(dialogAction==='offer')showOffer();
    if(dialogAction==='advance')updatePaidField();
  });
  document.addEventListener('change',event=>{
    if(event.target.id==='reportMonth'){reportMonth=event.target.value;render();}
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-trade]');
    if(!button||button.disabled)return;
    const {trade:action,stockId:id}=button.dataset;
    const item=db.items.find(row=>row.id===id);
    if(action==='csv'){exportReport();return;}
    if(isReadOnly())return;
    try {
      if(action==='label'&&item)stockLabel(item);
      else if(action==='refresh')await loadSaleReceipts();
      else if(action==='receipt'){
        const receipt=saleReceipts.find(row=>row.id===id);
        if(receipt)tradeEditor(action,'',receipt);
      } else if(action==='dismiss'){
        if(!tradeReceipt || !confirm('Mark this receipt as already recorded?'))return;
        button.disabled=true;
        try{
          await persist({...db,receiptsReviewed:[...new Set([...(db.receiptsReviewed||[]),tradeReceipt.id])]});
          closePanel($('tradeDialog'));
        }finally{button.disabled=false;}
      } else if(item||['bundleBuy','bundleSell','lookup'].includes(action))tradeEditor(action,id);
    } catch(error){toast(error.message);}
  });

  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(isReadOnly()||$('tradeDialog').classList.contains('is-closing'))return;
    const save=$('tradeSave');
    if(!save||save.disabled)return;
    const fields=new FormData(form);
    const amount=Number(fields.get('amount'));
    const date=String(fields.get('date')||'');
    const action=dialogAction;
    const receipt=tradeReceipt;
    const id=openTradeItem;
    save.disabled=true;
    $('tradeError').textContent='';
    try {
      let next;
      if(action==='lookup'){
        const key=String(fields.get('stockId')).trim();
        const item=db.items.find(row=>!row.deletedAt&&row.id.toLowerCase()===key.toLowerCase());
        if(!item)throw Error('No stock item matches this ID.');
        $('tradeDialog').close();
        openItem(item);
        return;
      }
      const extraCost=Number(fields.get('extraCost')||0);
      if(!Number.isFinite(extraCost)||extraCost<0)throw Error('Other costs must be £0 or more.');
      if(action==='sale')next=recordSale(db,id,amount,date,undefined,extraCost);
      if(action==='post'){
        const order=lastTrade(db,id);
        if(!order||tradeStatus(order)!=='Sold')throw Error('This order has already progressed.');
        next=advanceOrder(db,id,'Posted',date);
        const posted=lastTrade(next,id); if(extraCost>0)posted.extraCost=Math.round(extraCost*100)/100; else delete posted.extraCost;
      }
      if(action==='advance')next=advanceOrder(db,id,fields.get('stage'),date,Number(fields.get('paid')));
      const refund=(value,day)=>({amount:value,date:day,reason:String(fields.get('reason')).trim(),postage:Number(fields.get('postage')),restock:fields.has('restock')});
      if(action==='refund')next=returnSale(db,id,refund(amount,date));
      if(action==='receipt'){
        const item=String(fields.get('item'));
        if((db.receiptsReviewed||[]).includes(receipt.id))throw Error('This receipt was already reviewed.');
        if(receipt.stage==='sold')next=recordSale(db,item,receipt.amount,receipt.date,receipt);
        else if(receipt.stage==='refunded')next=returnSale(db,item,refund(receipt.amount,receipt.date),receipt);
        else next=advanceOrder(db,item,receipt.stage[0].toUpperCase()+receipt.stage.slice(1),receipt.date,Number(fields.get('paid')),receipt);
        next.receiptsReviewed=[...(db.receiptsReviewed||[]),receipt.id];
      }
      if(['bundleBuy','bundleSell'].includes(action)){
        const ids=fields.getAll('items');
        const pieces=ids.map(id=>db.items.find(item=>item.id===id));
        if(ids.length<2||pieces.some(item=>!item||item.status!=='In Stock')||!Number.isFinite(amount)||amount<0)throw Error('Select at least two available items and enter the total.');
        const split=splitCost(amount,pieces.map(item=>fields.get('split')==='Equal'?1:cents(item.cost)));
        const batchId=newId();
        next=cloneWorkspace(db);
        if(action==='bundleSell'){
          if(split.some(value=>value===0))throw Error('Each piece needs at least £0.01 of the sale total.');
          for(let i=0;i<ids.length;i++){
            next=recordSale(next,ids[i],split[i],date);
            lastTrade(next,ids[i]).batchId=batchId;
          }
        }else{
          const existing=(db.purchaseBatches||[]).flatMap(batch=>batch.allocations.map(row=>row.itemId));
          if(ids.some(id=>lastTrade(db,id)||existing.includes(id)))throw Error('An item already has a sale or an allocated purchase.');
          for(let i=0;i<ids.length;i++){
            const item=next.items.find(row=>row.id===ids[i]);
            item.cost=split[i];
            item.purchasedAt=date;
            item.purchaseDateReviewed=true;
          }
          (next.purchaseBatches||=[]).push({id:batchId,date,amount,allocations:ids.map((itemId,i)=>({itemId,amount:split[i]}))});
        }
      }
      if(!next)throw Error('Choose a valid action.');
      await persist(next);
      closePanel($('tradeDialog'));
      toast('Saved to Stockroom');
    } catch(error){$('tradeError').textContent=error.message;}
    finally{save.disabled=false;}
  });
}
