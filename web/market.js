'use strict';
let marketReport=null, marketLoading=false;

async function loadMarketResearch(){
  if(marketLoading)return;
  marketLoading=true;
  const panel=$('marketResearch');
  if(panel&&!marketReport)panel.innerHTML='<section class="panel">'+srWait(['Reading the Vinted UK market…','Finding what sells fastest…','Working out the prices…'])+'</section>';
  try{
    const {report}=await api('/api/market-research');
    marketReport=report;
    if($('marketResearch'))renderMarketResearch();
  }catch{
    if($('marketResearch')&&!marketReport)$('marketResearch').innerHTML='<section class="panel"><h2>Market data unavailable</h2><p>Reopen Buying research to try again.</p></section>';
  }finally{marketLoading=false;}
}

function renderMarketResearch(){
  const report=marketReport;
  if(!report)return;
  const number=value=>new Intl.NumberFormat('en-GB').format(value);
  const rows=(data,details)=>data.map(row=>'<tr><td>#'+row.rank+' <b>'+esc(row.name)+'</b></td><td>'+number(row.sales)+'</td><td>'+gbp(row.price)+'</td>'+
    (details?'<td>'+(row.days===null?'—':number(row.days)+' days')+'</td><td>'+(row.sellThrough===null?'—':number(row.sellThrough)+'%')+'</td>':'')+'</tr>').join('');
  const groups=[
    ['Categories by detected sales',report.categories,true,'Median sale price'],
    ['Brands by detected sales',report.brands,false,'Average sale price'],
    ['Brand and category watchlist',report.segments,false,'Average sale price']
  ];
  $('marketResearch').innerHTML='<section class="panel market-intro"><span class="eyebrow">RESELLER INTELLIGENCE</span><h2>What’s selling on Vinted UK</h2>'+
    '<p>'+esc(dateLabel(report.periodStart))+' to '+esc(dateLabel(report.periodEnd))+' · Source checked '+esc(dateLabel(report.checkedOn))+'</p>'+
    '<details class="fold"><summary>About this data</summary><p>'+esc(report.source.method)+' <a href="'+esc(report.source.url)+'" target="_blank" rel="noopener noreferrer">'+esc(report.source.name)+' ↗</a></p></details></section>'+
    '<section class="panel market-analysis"><span class="eyebrow">AI MARKET ANALYSIS</span><h2>What the numbers suggest</h2><div class="market-analysis-grid">'+
    report.analysis.map((note,i)=>'<details class="fold market-note"'+(i===0?' open':'')+'><summary>'+esc(note.title)+'</summary><p>'+esc(note.body)+'</p></details>').join('')+'</div></section>'+
    groups.filter(([,data])=>data.length).map(([title,data,details,price],i)=>'<details class="market-group fold"'+(i===0?' open':'')+'><summary><h2>'+title+'</h2></summary>'+
      table(['Rank and item','Detected sales',price,...(details?['Avg. time to sell','Sell-through']:[])],rows(data,details))+'</details>').join('')+
    '<p class="footnote">Volume measures activity in the source sample. Use comparable sold prices and your own costs when evaluating a specific buy.</p>'+
    '<button type="button" class="secondary" data-tab="Buying insights">See my recorded sales ↗</button>';
  labelViewCells($('marketResearch'));
}

onHook('pullRefresh', t => { if (typeof marketReport !== 'undefined' && /market/i.test(String(t))) { marketReport = null; } });
