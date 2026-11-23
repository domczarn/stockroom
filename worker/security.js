// Identity headers are set only by worker/access.js after verifying the Cloudflare Access JWT. Never accept identity in request bodies.
export const ADMIN_EMAIL = 'dom.czr11@gmail.com';
export const emptyWorkspace = () => ({items:[],sales:[],expenses:[],research:[],sources:[]});
export function identity(request) {
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  return id && id.length <= 200 && email ? {id,email,admin:email===ADMIN_EMAIL} : null;
}
export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export async function authorize(request,env) {
  const user=identity(request);
  if(!user) throw new HttpError(401,'Sign in again to continue.');
  if(user.admin) return user;
  // Verified Access sign-in creates an active workspace member on first use.
  let member=await env.DB.prepare('SELECT * FROM members WHERE email = ?').bind(user.email).first();
  if(!member){
    const created=await env.DB.prepare("INSERT OR IGNORE INTO members (email,user_id,name,status,created_at) VALUES (?,?,?,'active',?)")
      .bind(user.email,user.id,user.email.split('@')[0].slice(0,100),new Date().toISOString()).run();
    if(created.meta.changes)await audit(env,user,user.id,'member_joined');
    member=await env.DB.prepare('SELECT * FROM members WHERE email = ?').bind(user.email).first();
  }
  if(!member||member.status!=='active'||(member.user_id&&member.user_id!==user.id))
    throw new HttpError(403,'This account cannot access Stockroom. Contact your administrator.');
  if(!member.user_id){
    await env.DB.prepare('UPDATE OR IGNORE members SET user_id = ? WHERE email = ? AND user_id IS NULL').bind(user.id,user.email).run();
    const bound=await env.DB.prepare('SELECT user_id,status FROM members WHERE email = ?').bind(user.email).first();
    if(bound?.user_id!==user.id||bound.status!=='active')throw new HttpError(403,'Account identity does not match.');
  }
  return user;
}
export function adminOnly(user){if(!user.admin)throw new HttpError(403,'Admin access required.');}
export async function readBody(request,max=1000000) {
  if(!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415,'Send JSON data.');
  if(Number(request.headers.get('content-length'))>max) throw new HttpError(413,'Request too large.');
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Missing request body.');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new HttpError(413,'Request too large.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(400,'Invalid JSON.');}
}
const date=v=>!v || (typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v);
const money=v=>v==null||(Number.isFinite(v)&&v>=0&&v<=1000000);
const string=(v,max=20000)=>v==null||(typeof v==='string'&&v.length<=max);
const exactDate = value => typeof value==='string' && Boolean(value) && date(value);
const paid = value => typeof value==='number' && money(value) && Math.abs(value*100-Math.round(value*100))<0.00001;
const cents = value => Math.round(value*100);
const uuid = value => typeof value==='string' && /^[a-f0-9-]{36}$/.test(value);
const tx = value => typeof value==='string' && /^[0-9]{5,30}$/.test(value);
export {exactDate, paid, tx};

function validateTrades(data, itemIds) {
  const trades = data.trades === undefined ? [] : data.trades;
  const batches = data.purchaseBatches === undefined ? [] : data.purchaseBatches;
  const reviewed = data.receiptsReviewed === undefined ? [] : data.receiptsReviewed;
  if(!Array.isArray(trades)||trades.length>3000||!Array.isArray(batches)||batches.length>1000||
    !Array.isArray(reviewed)||reviewed.length>2000||reviewed.some(id=>typeof id!=='string'||!/^\d{5,30}:(sold|posted|completed|paid|refunded)$/.test(id)))
    throw new HttpError(400,'Invalid sales history.');
  const ids=new Set(), orders=new Set(), previous=new Map();
  for(const trade of trades){
    if(!trade||!uuid(trade.id)||ids.has(trade.id)||!itemIds.has(trade.itemId)||!string(trade.name,500)||
      !paid(trade.amount)||trade.amount<=0||!paid(trade.cost)||!exactDate(trade.soldAt)||
      ![trade.postedAt,trade.completedAt,trade.paidAt,trade.listedAt].every(value=>value==null||value===''||exactDate(value))||
      (trade.paidAt&&!paid(trade.paidAmount))||(trade.orderId&&(!tx(trade.orderId)||orders.has(trade.orderId)))||
      (trade.batchId&&!uuid(trade.batchId))||(trade.extraCost!=null&&(!paid(trade.extraCost)||trade.extraCost<0))||!Array.isArray(trade.refunds)||trade.refunds.length>60)
      throw new HttpError(400,'Invalid order details.');
    ids.add(trade.id);
    if(trade.orderId)orders.add(trade.orderId);
    const stages=[trade.soldAt,trade.postedAt,trade.completedAt,trade.paidAt].filter(Boolean);
    if(stages.some((day,index)=>index&&day<stages[index-1]))throw new HttpError(400,'Order dates must follow the sale.');
    const prior=previous.get(trade.itemId);
    if(prior&&(!prior.refunds.at(-1)?.restock||trade.soldAt<prior.refunds.at(-1).date))throw new HttpError(400,'Finish the previous return before recording a resale.');
    previous.set(trade.itemId,trade);
    let remaining=cents(trade.amount), lastDate=trade.soldAt;
    for(let index=0;index<trade.refunds.length;index++){
      const refund=trade.refunds[index];
      if(!refund||!paid(refund.amount)||refund.amount<=0||cents(refund.amount)>remaining||!paid(refund.postage)||
        !exactDate(refund.date)||refund.date<lastDate||typeof refund.reason!=='string'||!refund.reason.trim()||
        refund.reason.length>500||typeof refund.restock!=='boolean')throw new HttpError(400,'Invalid sale refund.');
      remaining-=cents(refund.amount);
      lastDate=refund.date;
      if(refund.restock&&(remaining!==0||index!==trade.refunds.length-1))throw new HttpError(400,'Restocking requires a full refund.');
    }
  }
  for(const item of data.items){
    const trade=previous.get(item.id);
    if(trade&&(trade.refunds.at(-1)?.restock?item.status!=='In Stock':item.status!=='Sold'||item.sale!==trade.amount))
      throw new HttpError(400,'Stock and sale history must match.');
  }
  const allocated=new Set();
  for(const batch of batches){
    if(!batch||!uuid(batch.id)||ids.has(batch.id)||!exactDate(batch.date)||!paid(batch.amount)||
      !Array.isArray(batch.allocations)||batch.allocations.length<2||batch.allocations.length>2000)
      throw new HttpError(400,'Invalid purchase bundle.');
    ids.add(batch.id);
    let total=0;
    for(const row of batch.allocations){
      if(!row||!itemIds.has(row.itemId)||allocated.has(row.itemId)||!paid(row.amount))throw new HttpError(400,'Invalid bundle allocation.');
      allocated.add(row.itemId);
      total+=cents(row.amount);
    }
    if(total!==cents(batch.amount))throw new HttpError(400,'Bundle allocations must equal the total paid.');
  }
}

const photoPattern=/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export function validateWorkspace(data,owner) {
  if(!data||!['items','sales','expenses','sources','research'].every(k=>Array.isArray(data[k])&&data[k].length<=20000)) throw new HttpError(400,'Invalid workspace.');
  const ids=new Set(),transactions=new Set();
  for(const item of data.items) {
    if(!item||typeof item.id!=='string'||!item.id||item.id.length>100||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||!money(item.cost)||item.cost==null||!['In Stock','Sold','Refund pending','Refunded'].includes(item.status)||!['price','sale','refund','targetPrice'].every(k=>money(item[k]))) throw new HttpError(400,'Invalid stock item or duplicate stock ID.');
    ids.add(item.id);
    if(item.sourceTransactionId){if(transactions.has(item.sourceTransactionId))throw new HttpError(400,'Duplicate purchase transaction.');transactions.add(item.sourceTransactionId);}
    if(!Object.entries(item).every(([k,v])=>['photos','referencePhotos'].includes(k)||typeof v!=='object'||v===null))throw new HttpError(400,'Invalid item fields.');
    for(const [k,v] of Object.entries(item))if(typeof v==='string'&&!string(v))throw new HttpError(400,'Item text is too long.');
    if(!Array.isArray(item.photos||[])||(item.photos||[]).length>4)throw new HttpError(400,'Use up to four photos per item.');
    for(const p of item.photos||[])if(typeof p!=='string'||!((photoPattern.test(p)&&p.length<2000000)||new RegExp('^/api/media/'+encodeURIComponent(owner).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/[a-f0-9-]{36}$').test(p)))throw new HttpError(400,'Invalid or foreign account photo.');
    if(item.shipQr!==undefined&&item.shipQr!==''&&(typeof item.shipQr!=='string'||!((photoPattern.test(item.shipQr)&&item.shipQr.length<3000000)||new RegExp('^/api/media/'+encodeURIComponent(owner).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/[a-f0-9-]{36}$').test(item.shipQr))))throw new HttpError(400,'Invalid shipping QR code.');
    if(item.shipQrAt!==undefined&&item.shipQrAt!==''&&!exactDate(item.shipQrAt))throw new HttpError(400,'Invalid shipping QR date.');
    const ownMedia=new RegExp('^/api/media/'+encodeURIComponent(owner).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/[a-f0-9-]{36}$');
    if(item.shipLabel!==undefined&&item.shipLabel!==''&&(typeof item.shipLabel!=='string'||!ownMedia.test(item.shipLabel)))throw new HttpError(400,'Invalid shipping label.');
    if(item.shipTracking!==undefined&&item.shipTracking!==''&&(typeof item.shipTracking!=='string'||!/^[A-Z0-9]{8,30}$/.test(item.shipTracking)))throw new HttpError(400,'Invalid tracking number.');
    for(const f of ['shipCarrier','shipCode'])if(item[f]!==undefined&&(typeof item[f]!=='string'||item[f].length>40))throw new HttpError(400,'Invalid shipping details.');
    for(const f of ['shipDeadline','shipPostedAt','shipDeliveredAt'])if(item[f]!==undefined&&item[f]!==''&&!exactDate(item[f]))throw new HttpError(400,'Invalid shipping date.');
    if(item.referencePhotos && (!Array.isArray(item.referencePhotos)||item.referencePhotos.length>4||item.referencePhotos.some(p=>!p||!/^\/api\/photos\/\d{5,30}\/[0-3]$/.test(p.url))))throw new HttpError(400,'Invalid reference photo.');
    if(!string(item.brand,150)||!string(item.listingTitle,150)||!string(item.listingDescription,20000)||!string(item.purchasedAt,10)|| (item.purchasedAt&&!/^\d{4}-\d{2}-\d{2}$/.test(item.purchasedAt)))throw new HttpError(400,'Invalid item details.');
    if(![item.receivedAt,item.listedAt,item.soldAt,item.refundedAt,item.priceChangedAt,item.deletedAt].every(v=>v==null||v===''||exactDate(v)) || (item.stage&&!['Awaiting delivery','Ready to photograph','Ready to list','Listed','Return inspection'].includes(item.stage)))throw new HttpError(400,'Invalid stock timeline.');
    if(!date(item.purchasedAt))throw new HttpError(400,'Invalid purchase date.');
    if(item.listingUrl && !/^https:\/\/www\.vinted\.co\.uk\/items\/\d+[^\s]*$/.test(item.listingUrl))throw new HttpError(400,'Use a Vinted UK item URL.');
  }
  for(const row of [...data.sales,...data.expenses])if(!Array.isArray(row)||!string(row[0],500)||!money(row[1])||row[1]==null||!money(row[3])||row.some(v=>typeof v==='string'&&v.length>20000))throw new HttpError(400,'Invalid transaction.');
  for(const row of [...data.sales,...data.expenses])if(!date(row[4]))throw new HttpError(400,'Invalid transaction date.');
  for(const row of data.research)if(!Array.isArray(row)||!string(row[0],500)||!Number.isInteger(row[1])||row[1]<0||![row[2],row[3],row[4],row[5]].every(Number.isFinite))throw new HttpError(400,'Invalid research values.');
  for(const row of data.sources)if(!Array.isArray(row)||!string(row[0],500)||!money(row[1])||!row.every(v=>v==null||typeof v==='string'||typeof v==='number'))throw new HttpError(400,'Invalid research source.');
  if(data.expenses.some(row=>row[6]&&!ids.has(row[6])))throw new HttpError(400,'Linked expense stock could not be found.');
  for(const archive of ['removedExpenses','removedSales'])if(data[archive]!==undefined){
    const removed=data[archive],archiveIds=new Set();
    if(!Array.isArray(removed)||removed.length>2000)throw new HttpError(400,'Invalid removed expenses.');
    for(const entry of removed){
      const row=entry?.row;
      if(!entry||typeof entry.id!=='string'||!entry.id||entry.id.length>100||archiveIds.has(entry.id)||typeof entry.removedAt!=='string'||!Number.isFinite(Date.parse(entry.removedAt))||!Array.isArray(row)||!string(row[0],500)||!money(row[1])||row[1]==null||!money(row[3])||!date(row[4])||row.some(v=>typeof v==='string'&&v.length>20000)||row.some(v=>v!==null&&typeof v==='object'))throw new HttpError(400,'Invalid removed expense.');
      archiveIds.add(entry.id);
    }
  }
  if(data.bulkOrders!==undefined){
    const seen=new Set(),safeLink=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
    if(!Array.isArray(data.bulkOrders)||data.bulkOrders.length>1000)throw new HttpError(400,'Invalid bulk orders.');
    for(const o of data.bulkOrders){
      if(!o||typeof o.id!=='string'||!o.id||o.id.length>100||seen.has(o.id)||typeof o.supplier!=='string'||!o.supplier.trim()||!string(o.supplier,200)||!string(o.reference,150)||!string(o.notes,3000)||!['Wholesale','Whatnot','Vinted','eBay','Kilo sale','Handpick','Charity shop','Other'].includes(o.channel)||!['Ordered','Dispatched','Received','Cancelled'].includes(o.stage)||!exactDate(o.date)||![o.expectedAt,o.receivedAt].every(v=>v==null||v===''||exactDate(v))||!['goods','shipping','other'].every(k=>Number.isFinite(o[k])&&o[k]>=0&&o[k]<=1000000)||!string(o.url,2000)||(o.url&&!safeLink(o.url)))throw new HttpError(400,'Invalid bulk order details.');
      seen.add(o.id);
      if(!Array.isArray(o.lines)||!o.lines.length||o.lines.length>500||o.lines.some(l=>!l||typeof l.name!=='string'||!l.name.trim()||!string(l.name,200)||!string(l.brand,150)||!string(l.size,100)||!Number.isInteger(l.quantity)||l.quantity<1||l.quantity>500)||o.lines.reduce((n,l)=>n+l.quantity,0)>500)throw new HttpError(400,'Use 1 to 500 pieces per batch.');
      if(o.receivedAt&&o.receivedAt<o.date)throw new HttpError(400,'Received date cannot precede purchase date.');
      if(o.stage==='Received'&&!exactDate(o.receivedAt))throw new HttpError(400,'Received orders need a received date.');
      if(o.stockCreatedAt&&(typeof o.stockCreatedAt!=='string'||!Number.isFinite(Date.parse(o.stockCreatedAt))||o.stage!=='Received'))throw new HttpError(400,'Invalid stock allocation.');
    }
    for(const item of data.items)if(item.bulkOrderId&&!seen.has(item.bulkOrderId))throw new HttpError(400,'Stock batch could not be found.');
  }
  if(data.sourcingRuns!==undefined){
    const seen=new Set(),num=(v,max)=>v==null||(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max);
    if(!Array.isArray(data.sourcingRuns)||data.sourcingRuns.length>5000)throw new HttpError(400,'Invalid sourcing trips.');
    for(const r of data.sourcingRuns){
      if(!r||typeof r.id!=='string'||!r.id||r.id.length>100||seen.has(r.id)||typeof r.place!=='string'||!r.place.trim()||!string(r.place,150)||!exactDate(r.date)||!['Charity shop','Car boot','Kilo sale','Wholesale','Online','Market','Other'].includes(r.kind)||!num(r.spend,1000000)||!num(r.miles,10000)||!num(r.minutes,10000)||!string(r.notes,2000))throw new HttpError(400,'Invalid sourcing trip details.');
      seen.add(r.id);
    }
    for(const item of data.items)if(item.sourcingRunId&&!seen.has(item.sourcingRunId))throw new HttpError(400,'Sourcing trip could not be found.');
  }
  if(data.resourceDirectory!==undefined){
    const r=data.resourceDirectory,object=v=>v&&typeof v==='object'&&!Array.isArray(v);
    const link=v=>{try{const u=new URL(v);return typeof v==='string'&&v.length<=2000&&u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
    const statuses=['Not tested','Researching','Tested','Trusted','Avoid'];
    if(!object(r)||!object(r.entries)||Object.keys(r.entries).length>2000||!Array.isArray(r.opportunities)||r.opportunities.length>1000)throw new HttpError(400,'Invalid resource directory.');
    for(const [id,v] of Object.entries(r.entries))if(!/^resource-\d{1,6}$/.test(id)||!object(v)||(v.favourite!==undefined&&typeof v.favourite!=='boolean')||!string(v.notes,3000)||(v.status!==undefined&&!statuses.includes(v.status))||(v.visitedAt!==undefined&&(typeof v.visitedAt!=='string'||!Number.isFinite(Date.parse(v.visitedAt)))))throw new HttpError(400,'Invalid resource notes.');
    const opportunityIds=new Set();
    for(const o of r.opportunities){
      if(!object(o)||typeof o.id!=='string'||!o.id||o.id.length>100||opportunityIds.has(o.id)||typeof o.name!=='string'||!o.name.trim()||!string(o.name,200)||!link(o.url)||!string(o.seller,200)||!string(o.notes,3000)||!exactDate(o.discoveredAt)||!['Discovered','Researching','Approved','Purchased','Received','Listed','Sold'].includes(o.stage)||!['price','shipping','target'].every(k=>o[k]===null||typeof o[k]==='number'&&Number.isFinite(o[k])&&o[k]>=0&&o[k]<=1000000))throw new HttpError(400,'Invalid sourcing opportunity.');
      opportunityIds.add(o.id);
    }
  }
  validateTrades(data,ids);
  if(data.customerCare!==undefined){
    const care=data.customerCare,steps=['thanks','posted','delivered','followup'];
    const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
    const text=(v,n)=>typeof v==='string'&&v.length<=n;
    const trades=new Map((data.trades||[]).map(t=>[t.id,t]));
    if(!object(care)||!text(care.shop,100)||!object(care.templates)||!object(care.orders)||Object.keys(care.orders).length>2000||Object.entries(care.templates).some(([k,v])=>!steps.includes(k)||!text(v,3000)))throw new HttpError(400,'Invalid customer care settings.');
    for(const [id,o] of Object.entries(care.orders)){
      const trade=trades.get(id);
      if(!trade||!object(o)||!text(o.buyer||'',100)||!text(o.tracking||'',500)|| (o.deliveredAt&&(!exactDate(o.deliveredAt)||!trade.postedAt||o.deliveredAt<trade.postedAt||o.deliveredAt>new Date().toISOString().slice(0,10))) || (o.sent&&(!object(o.sent)||Object.entries(o.sent).some(([k,v])=>!steps.includes(k)||typeof v!=='string'||!Number.isFinite(Date.parse(v))))))throw new HttpError(400,'Invalid customer order details or delivery date.');
    }
  }
  // Research is factual display data, never interpreted as markup.
  if(JSON.stringify(data).length>18000000)throw new HttpError(413,'Workspace too large.');
  return data;
}
// Move an inline image (data URL) into private storage and return its media path.
async function storeImage(p,owner,env){
  const [,type,body]=p.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/)||[];
  if(!body)throw new HttpError(400,'Invalid photo.');
  const raw=atob(body);const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
  const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if(!((type==='image/jpeg'&&jpeg)||(type==='image/png'&&png)||(type==='image/webp'&&webp)))throw new HttpError(400,'Photo content does not match its type.');
  const id=crypto.randomUUID();await env.BUCKET.put('users/'+owner+'/'+id,bytes,{httpMetadata:{contentType:type}});
  return '/api/media/'+encodeURIComponent(owner)+'/'+id;
}
export async function storePhotos(data,owner,env) {
  for(const item of data.items){
    for(let n=0;n<(item.photos||[]).length;n++)if(item.photos[n].startsWith('data:'))item.photos[n]=await storeImage(item.photos[n],owner,env);
    if(typeof item.shipQr==='string'&&item.shipQr.startsWith('data:'))item.shipQr=await storeImage(item.shipQr,owner,env);
  }
  return data;
}
export async function audit(env,user,owner,action) {
  await env.DB.prepare('INSERT INTO audit_events (id,actor_id,owner_id,action,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),user.id,owner,action,new Date().toISOString()).run();
}

export async function rateLimit(env,key){
 const window=Math.floor(Date.now()/60000);
 const row=await env.DB.prepare('INSERT INTO rate_limits (key,window,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window = excluded.window THEN count + 1 ELSE 1 END, window=excluded.window RETURNING count').bind(key,window).first();
 if(row.count>60)throw new HttpError(429,'Too many changes. Wait a minute and try again.');
}
