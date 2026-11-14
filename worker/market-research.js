import {exactDate,HttpError,readBody} from './security.js';
import seed from './market-seed.json';

const shortText=(value,limit)=>typeof value==='string'&&value.trim().length>0&&value.length<=limit;
const metric=(value,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max;
const validUrl=value=>{
  try{
    const url=new URL(value);
    return shortText(value,400)&&url.protocol==='https:'&&!url.username&&!url.password;
  }catch{return false;}
};
const validRows=(rows,limit,details=false)=>Array.isArray(rows)&&rows.length<=limit&&rows.every(row=>
  row&&Number.isInteger(row.rank)&&metric(row.rank,500)&&row.rank>0&&shortText(row.name,120)&&
  Number.isSafeInteger(row.sales)&&row.sales>=0&&metric(row.price,100000)&&
  (!details||((row.days===null||metric(row.days,3650))&&(row.sellThrough===null||metric(row.sellThrough,100)))));

export async function marketResearchRoute(request,env,user){
  if(request.method==='GET'){
    const row=await env.DB.prepare("SELECT payload FROM market_research WHERE id='vinted-uk'").first();
    return {report:row?JSON.parse(row.payload):seed};
  }
  if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
  if(user)throw new HttpError(403,'Market research updates require Stockroom service access.');
  const {report}=await readBody(request,30000)||{};
  if(!report||report.market!=='Vinted UK'||![report.periodStart,report.periodEnd,report.checkedOn].every(exactDate)||
    report.periodStart>report.periodEnd||report.periodEnd>report.checkedOn||
    !shortText(report.source?.name,140)||!validUrl(report.source?.url)||!shortText(report.source?.method,750)||
    !validRows(report.categories,20,true)||!report.categories.length||!validRows(report.brands,20)||!validRows(report.segments,20)||
    !Array.isArray(report.analysis)||!report.analysis.length||report.analysis.length>6||
    report.analysis.some(row=>!shortText(row?.title,100)||!shortText(row?.body,700)))
    throw new HttpError(400,'Invalid Vinted UK market report.');
  if(report.periodEnd<seed.periodEnd)throw new HttpError(409,'This market report is older than the current edition.');
  const publicRows=(rows,details)=>rows.map(({rank,name,sales,price,days,sellThrough})=>
    ({rank,name,sales,price,...(details?{days,sellThrough}:{})}));
  const snapshot={
    market:report.market,periodStart:report.periodStart,periodEnd:report.periodEnd,checkedOn:report.checkedOn,
    source:{name:report.source.name,url:report.source.url,method:report.source.method},
    categories:publicRows(report.categories,true),brands:publicRows(report.brands),segments:publicRows(report.segments),
    analysis:report.analysis.map(({title,body})=>({title,body}))
  };
  const row=await env.DB.prepare(`INSERT INTO market_research (id,payload,period_end,checked_on) VALUES ('vinted-uk',?,?,?)
    ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,period_end=excluded.period_end,checked_on=excluded.checked_on
    WHERE excluded.period_end>market_research.period_end OR
      (excluded.period_end=market_research.period_end AND excluded.checked_on>=market_research.checked_on)
    RETURNING period_end,checked_on`).bind(JSON.stringify(snapshot),report.periodEnd,report.checkedOn).first();
  if(!row)throw new HttpError(409,'A newer market report is already available.');
  return {success:true,periodEnd:row.period_end,checkedOn:row.checked_on};
}
