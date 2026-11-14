'use strict';

const financeDay = 86400000;
const financeDate = timestamp => new Date(timestamp).toISOString().slice(0,10);
const financeTime = date => Date.parse(date+'T00:00:00Z');
const financeShortDate = new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
const financeRangeLabel = (from,to) => from===to?financeShortDate.format(financeTime(from)):
  financeShortDate.format(financeTime(from))+' – '+financeShortDate.format(financeTime(to));
const financePeriods = { '1W':7, '1M':30, '3M':90 };
let financePeriod = '1M';

function revenueChart(rows, today) {
  const count = financePeriods[financePeriod];
  const end = financeTime(today);
  const start = end-(count-1)*financeDay;
  const recent = rows.filter(row=>row.date>=financeDate(start)&&row.date<=today);
  const totals = reportTotals(recent);
  const stride = count===90 ? 7 : count===30 ? 3 : 1;
  const groups = Array.from({length:Math.ceil(count/stride)},(_,i)=>{
    const from=financeDate(start+i*stride*financeDay);
    const to=financeDate(Math.min(end,start+((i+1)*stride-1)*financeDay));
    return {from,to,...reportTotals(recent.filter(row=>row.date>=from&&row.date<=to))};
  });
  const values=groups.flatMap(g=>[g.revenue,g.profit]);
  const min=Math.min(0,...values),max=Math.max(1,...values);
  const x=i=>i*600/(groups.length-1);
  const y=v=>10+140*(max-v)/(max-min);
  const line=key=>groups.map((g,i)=>x(i).toFixed(2)+','+y(g[key]).toFixed(2)).join(' ');
  const controls=Object.keys(financePeriods).map(key=>'<button type="button" data-finance-period="'+key+'" aria-pressed="'+(financePeriod===key)+'">'+key+'</button>').join('');
  const points=groups.map((group,i)=>[x(i),y(group.revenue),y(group.profit)]);
  const last=points[points.length-1];
  const details=groups.map((group,i)=>({
    label:financeRangeLabel(group.from,group.to),
    revenue:gbp(group.revenue),
    profit:gbp(group.profit),
    position:points[i]
  }));
  const latest=details[details.length-1];
  return '<section class="finance-dark revenue-chart"><div class="finance-dark-heading"><h2>Revenue &amp; profit</h2>'+
    '<div class="finance-periods" role="group" aria-label="Chart period">'+controls+'</div></div>'+
    '<div class="finance-dark-metrics"><div><span class="revenue-key">Revenue</span><strong>'+gbp(totals.revenue)+'</strong></div>'+
    '<div><span class="profit-key">Net profit</span><strong>'+gbp(totals.profit)+'</strong></div>'+
    '<div><span>Net margin</span><strong>'+(totals.revenue>0?(100*totals.profit/totals.revenue).toFixed(1)+'%':'—')+'</strong></div></div>'+
    (recent.length?'<svg class="finance-plot" viewBox="-4 0 608 160" preserveAspectRatio="none" role="img" aria-label="Revenue and net profit by date">'+
      '<defs><linearGradient id="financeArea" x2="0" y2="1"><stop stop-color="#48d9ad" stop-opacity=".27"/><stop offset="1" stop-color="#48d9ad" stop-opacity=".02"/></linearGradient></defs>'+
      [0,.25,.5,.75,1].map(v=>'<line x1="0" x2="600" y1="'+(10+v*140)+'" y2="'+(10+v*140)+'" stroke="#33343e"/>').join('')+
      '<line x1="0" x2="600" y1="'+y(0)+'" y2="'+y(0)+'" stroke="#6b6c78"/>'+
      '<g class="finance-series"><polygon fill="url(#financeArea)" points="0,'+y(0)+' '+line('profit')+' 600,'+y(0)+'"/>'+
      '<polyline fill="none" stroke="#8eafff" stroke-width="2.5" vector-effect="non-scaling-stroke" points="'+line('revenue')+'"/>'+
      '<polyline fill="none" stroke="#53dfb3" stroke-width="2.5" vector-effect="non-scaling-stroke" points="'+line('profit')+'"/>'+
      '</g><g class="finance-cursor" style="--point-x:'+last[0]+'px">'+
      '<line y1="10" y2="150" stroke="#a5a6b4" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>'+
      ['revenue','profit'].map((key,i)=>'<circle class="finance-dot '+key+'" r="4" style="--point-y:'+last[i+1]+'px" vector-effect="non-scaling-stroke"/>').join('')+
      '</g></svg>'+
      '<div class="finance-axis"><span>'+esc(financeShortDate.format(start))+'</span><span>'+esc(financeShortDate.format(end))+'</span></div>'+
      '<div class="finance-inspector" role="group" aria-label="Inspect chart dates">'+
      '<div class="finance-inspection-nav"><button type="button" data-finance-step="-1" aria-label="Previous date">‹</button>'+
      '<label><span>Inspect dates</span><input type="range" min="0" max="'+(details.length-1)+'" value="'+(details.length-1)+'" data-finance-point data-points="'+esc(JSON.stringify(details))+'" aria-valuetext="'+esc(latest.label)+'"></label>'+
      '<button type="button" data-finance-step="1" aria-label="Next date" disabled>›</button></div>'+
      '<dl class="finance-chart-detail"><div><dt>Selected date</dt><dd data-point-date>'+esc(latest.label)+'</dd></div>'+
      '<div><dt class="revenue-key">Revenue</dt><dd data-point-revenue>'+latest.revenue+'</dd></div>'+
      '<div><dt class="profit-key">Net profit</dt><dd data-point-profit>'+latest.profit+'</dd></div></dl>'+
      '<span class="finance-sr-only" data-finance-detail aria-live="polite">'+esc(financePointText(latest))+'</span></div>':
      '<p class="finance-note">No dated sales or expenses in this period.</p>')+
    (totals.missing?'<p class="finance-note">Provisional · '+totals.missing+' sale costs missing.</p>':'')+'</section>';
}

function financePointText(point) {
  return point.label+'. Revenue '+point.revenue+'. Net profit '+point.profit+'.';
}

function financeProjection(rows,today) {
  const year=Number(today.slice(0,4)), month=Number(today.slice(5,7));
  const day=Number(today.slice(8,10)), days=new Date(Date.UTC(year,month,0)).getUTCDate();
  const taxYear=today.slice(5)>='04-06'?year:year-1;
  const taxStart=taxYear+'-04-06',taxEnd=(taxYear+1)+'-04-05';
  const ytd=rows.filter(row=>row.date>=taxStart&&row.date<=today);
  const monthly=rows.filter(row=>row.date.startsWith(today.slice(0,7))&&row.date<=today);
  const m=reportTotals(monthly),y=reportTotals(ytd);
  const elapsed=1+(financeTime(today)-financeTime(taxStart))/financeDay;
  const duration=1+(financeTime(taxEnd)-financeTime(taxStart))/financeDay;
  const forecast=(value,ratio)=>gbp(pounds(Math.round(cents(value)*ratio)));
  const label=new Intl.DateTimeFormat('en-GB',{month:'long',timeZone:'UTC'}).format(financeTime(today));
  const gross=pounds(ytd.filter(row=>row.kind==='Sale').reduce((n,row)=>n+cents(row.revenue),0));
  const allowance=taxYear<=2026?1000:null;
  return '<div class="finance-insight-grid"><section class="finance-dark"><div class="finance-dark-heading"><h2>Projected profit this month</h2><span>'+label+'</span></div>'+
    '<strong class="finance-projection">'+(monthly.length?forecast(m.profit,days/day):'—')+'</strong>'+
    '<div class="finance-progress pace" aria-label="Day '+day+' of '+days+'"><span style="width:'+(100*day/days)+'%"></span></div>'+
    '<div class="finance-axis"><span>'+gbp(m.profit)+' so far</span><span>Day '+day+' of '+days+'</span></div>'+
    '<dl class="finance-figures"><div><dt>Profit this tax year</dt><dd>'+gbp(y.profit)+'</dd></div>'+
    '<div><dt>Projected to 5 April '+(taxYear+1)+'</dt><dd>'+(ytd.length?forecast(y.profit,duration/elapsed):'—')+'</dd></div>'+
    '<div><dt>Monthly profit at current pace</dt><dd>'+(ytd.length?forecast(y.profit,duration/(12*elapsed)):'—')+'</dd></div></dl>'+
    '<p class="finance-note">Projects recorded net profit at the same daily pace. '+(m.missing||y.missing?'Provisional while sale costs are missing.':'')+'</p></section>'+
    '<section class="finance-dark"><div class="finance-dark-heading"><h2>Trading allowance</h2><span>'+taxYear+'/'+String(taxYear+1).slice(-2)+'</span></div>'+
    '<div class="finance-ring" style="--used:'+(allowance?Math.min(100,100*gross/allowance):0)+'%"><div><strong>'+gbp(gross)+'</strong><span>'+(allowance?'of £1,000':'Recorded gross sales')+'</span></div></div>'+
    '<p class="finance-note">'+(allowance?'£1,000 allowance for eligible individuals. Include qualifying income from other trades when checking your total.':'Check the applicable allowance with HMRC.')+' <a href="https://www.gov.uk/guidance/check-if-you-need-to-tell-hmrc-about-your-income-from-online-platforms" target="_blank" rel="noopener">HMRC guidance ↗</a></p></section></div>';
}

function platformReporting(data,today) {
  const year=today.slice(0,4);
  const inYear=date=>date>=year+'-01-01'&&date<=today;
  const vinted=new Map();
  for(const trade of data.trades||[]){
    if(inYear(trade.soldAt)&&/^\d+$/.test(trade.orderId||''))vinted.set(trade.orderId,trade.amount);
  }
  const amount=pounds([...vinted.values()].reduce((n,v)=>n+cents(v),0));
  const sales=accountingRows(data).filter(row=>row.kind==='Sale'&&inYear(row.date)).length;
  const unassigned=Math.max(0,sales-vinted.size);
  const bar=(label,value,target,formatted)=>'<div class="finance-platform-row"><span>'+label+'</span>'+
    '<div class="finance-progress"><span style="width:'+Math.min(100,100*value/target)+'%"></span></div><strong>'+formatted+'</strong></div>';
  return '<section class="finance-dark"><div class="finance-dark-heading"><h2>Platform reporting</h2><span>'+year+' calendar year</span></div>'+
    '<h3>Vinted</h3>'+bar('Sales',vinted.size,30,vinted.size+' / 30')+
    bar('Sales value',amount,1700,gbp(amount)+' / ~£1,700')+
    '<p class="finance-note">Based on recorded sales linked to Vinted receipts. '+unassigned+' dated sales have no verified platform link. Depop and eBay totals require platform data.</p>'+
    '<p class="finance-note">The goods-selling exclusion applies below 30 sales and at €2,000 or less. The GBP bar is an approximate guide. Compare with your platform statement. <a href="https://www.gov.uk/guidance/selling-goods-or-services-on-a-digital-platform" target="_blank" rel="noopener">HMRC guidance ↗</a></p></section>';
}

function financeInsights(rows) {
  const today=todayUK();
  return '<div class="finance-insights"><div id="financeChart">'+revenueChart(rows,today)+'</div>'+
    financeProjection(rows,today)+platformReporting(db,today)+'</div>';
}

document.addEventListener('click',event=>{
  const button=event.target.closest('[data-finance-period]');
  if(!button||button.dataset.financePeriod===financePeriod)return;
  financePeriod=button.dataset.financePeriod;
  $('financeChart').innerHTML=revenueChart(accountingRows(db),todayUK());
  $('financeChart').querySelector('[aria-pressed="true"]').focus({preventScroll:true});
});

function inspectFinancePoint(input,index) {
  const points=JSON.parse(input.dataset.points);
  index=Math.max(0,Math.min(points.length-1,index));
  const point=points[index];
  const chart=input.closest('.revenue-chart');
  input.value=index;
  input.setAttribute('aria-valuetext',point.label);
  chart.querySelector('[data-finance-step="-1"]').disabled=index===0;
  chart.querySelector('[data-finance-step="1"]').disabled=index===points.length-1;
  chart.querySelector('[data-point-date]').textContent=point.label;
  chart.querySelector('[data-point-revenue]').textContent=point.revenue;
  chart.querySelector('[data-point-profit]').textContent=point.profit;
  chart.querySelector('[data-finance-detail]').textContent=financePointText(point);
  const [x,revenue,profit]=point.position;
  const cursor=chart.querySelector('.finance-cursor');
  cursor.style.setProperty('--point-x',x+'px');
  cursor.querySelector('.finance-dot.revenue').style.setProperty('--point-y',revenue+'px');
  cursor.querySelector('.finance-dot.profit').style.setProperty('--point-y',profit+'px');
}

document.addEventListener('input',event=>{
  if(event.target.matches('[data-finance-point]'))inspectFinancePoint(event.target,event.target.valueAsNumber);
});

document.addEventListener('click',event=>{
  const step=event.target.closest('[data-finance-step]');
  const plot=event.target.closest('.finance-plot');
  const chart=(step||plot)?.closest('.revenue-chart');
  if(!chart)return;
  const input=chart.querySelector('[data-finance-point]');
  if(step){
    inspectFinancePoint(input,input.valueAsNumber+Number(step.dataset.financeStep));
    if(step.disabled)input.focus({preventScroll:true});
    return;
  }
  const bounds=plot.getBoundingClientRect();
  const svgX=608*(event.clientX-bounds.left)/bounds.width-4;
  inspectFinancePoint(input,Math.round(svgX/600*Number(input.max)));
});
