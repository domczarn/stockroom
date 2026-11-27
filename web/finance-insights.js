'use strict';

const financeDay = 86400000;
const financeTime = date => Date.parse(date+'T00:00:00Z');

// The Home chart lives in revenue.js (revenueChart). This file keeps the projection and tax-reporting cards.

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
  const allowance=taxYear<=2026?1000:3000; // £3,000 from 6 April 2027 (Finance Bill 2026-27)
  return '<div class="finance-insight-grid"><section class="finance-dark"><div class="finance-dark-heading"><h2>Projected profit this month</h2><span>'+label+'</span></div>'+
    '<strong class="finance-projection">'+(monthly.length?forecast(m.profit,days/day):'—')+'</strong>'+
    '<div class="finance-progress pace" aria-label="Day '+day+' of '+days+'"><span style="width:'+(100*day/days)+'%"></span></div>'+
    '<div class="finance-axis"><span>'+gbp(m.profit)+' so far</span><span>Day '+day+' of '+days+'</span></div>'+
    '<dl class="finance-figures"><div><dt>Profit this tax year</dt><dd>'+gbp(y.profit)+'</dd></div>'+
    '<div><dt>Projected to 5 April '+(taxYear+1)+'</dt><dd>'+(ytd.length?forecast(y.profit,duration/elapsed):'—')+'</dd></div>'+
    '<div><dt>Monthly profit at current pace</dt><dd>'+(ytd.length?forecast(y.profit,duration/(12*elapsed)):'—')+'</dd></div></dl>'+
    '<p class="finance-note">Projects recorded net profit at the same daily pace. '+(m.missing||y.missing?'Provisional while sale costs are missing.':'')+'</p></section>'+
    '</div>';
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

