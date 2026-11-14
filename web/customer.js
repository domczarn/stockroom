'use strict';
const careSteps=[
 {id:'thanks',title:'Thank you',text:'Hi {buyer}! Thanks so much for buying {item} from {shop}. I’ll keep you updated here when it’s on its way. If you have any questions, just message me!'},
 {id:'posted',title:'On its way',text:'Hi {buyer}, your {item} has been sent! {tracking}Thanks again for your order. You can follow its progress in your order tracking.'},
 {id:'delivered',title:'Delivery check-in',text:'Hi {buyer}, I hope your {item} arrived safely and you’re happy with it! If anything isn’t right, please let me know through the order conversation so we can sort it out.'},
 {id:'followup',title:'A little follow-up',text:'Hi {buyer}, thanks again for shopping with {shop}! I hope you’re enjoying your {item}. If you’d like to leave an honest review, I’d really appreciate it. You’re always welcome back!'}
];
let careSelected='',carePreview=null;
function careStore(data){return data.customerCare||{shop:'my shop',templates:{},orders:{}};}
function careReady(trade,order,step,now=new Date()){
 if((trade.refunds||[]).length)return false;
 if(step==='thanks')return !!trade.soldAt;
 if(step==='posted')return !!trade.postedAt;
 if(step==='delivered')return !!order.deliveredAt;
 if(step==='followup')return !!order.deliveredAt&&now.getTime()>=Date.parse(order.deliveredAt+'T00:00:00Z')+3*86400000;
 return false;
}
function careDraft(template,values){return template.replace(/\{(buyer|item|shop|tracking)\}/g,(_,key)=>values[key]||'');}
function careOrders(){return [...(db.trades||[])].sort((a,b)=>b.soldAt.localeCompare(a.soldAt));}
function customerCareView(){
 const data=careStore(db),orders=careOrders();
 if(!orders.some(t=>t.id===careSelected))careSelected=orders[0]?.id||'';
 const trade=orders.find(t=>t.id===careSelected),order=data.orders[careSelected]||{};
 return '<div class="care-intro panel"><img src="/pip.svg" alt="" width="70" height="65"><div><h2>Small touches. Happier customers.</h2><p>Your personal message sequence, from purchase to follow-up. Review and copy each message into the marketplace conversation. Nothing is sent automatically.</p></div></div>'+
 '<details class="panel care-settings"><summary>Personalise your message templates</summary><form id="careTemplates"><label>Shop name<input name="shop" maxlength="100" value="'+esc(data.shop)+'" required></label><p class="footnote">Use {buyer}, {item}, {shop} and {tracking}. Leave the buyer name blank for a friendly “there”.</p>'+careSteps.map(s=>'<label>'+s.title+'<textarea name="'+s.id+'" rows="4" maxlength="3000" required>'+esc(data.templates[s.id]||s.text)+'</textarea></label>').join('')+'<button class="action">Save templates</button><p role="status" id="careTemplateStatus"></p></form></details>'+
 (!trade?'<section class="panel empty-state"><h2>Your next sale starts the journey</h2><p>Record a sale from Stock to prepare its customer messages. Imported receipts need reviewing first.</p></section>':
 '<section class="panel"><label>Choose an order<select id="careOrder">'+orders.map(t=>'<option value="'+esc(t.id)+'" '+(t.id===careSelected?'selected':'')+'>'+esc(t.name)+' · '+esc(dateLabel(t.soldAt))+'</option>').join('')+'</select></label><div class="care-order-heading"><h2>'+esc(trade.name)+'</h2><span class="tag">'+esc(tradeStatus(trade))+'</span></div><p class="footnote">Sold '+esc(dateLabel(trade.soldAt))+(trade.postedAt?' · Posted '+esc(dateLabel(trade.postedAt)):' · Dispatch still to record in Stock')+'</p><form id="careDetails" class="care-details"><label>Buyer first name or username<input name="buyer" maxlength="100" value="'+esc(order.buyer)+'" placeholder="Optional"></label><label>Carrier / tracking note<input name="tracking" maxlength="500" value="'+esc(order.tracking)+'" placeholder="Optional, only confirmed details"></label><label>Confirmed delivery date<input type="date" name="deliveredAt" min="'+esc(trade.postedAt||trade.soldAt)+'" max="'+new Date().toISOString().slice(0,10)+'" value="'+esc(order.deliveredAt)+'" '+(!trade.postedAt?'disabled':'')+'><small>Record dispatch in Stock before confirming delivery.</small></label><button class="secondary">Save order details</button><p role="status" id="careDetailsStatus"></p></form>'+
 ((trade.refunds||[]).length?'<p class="research-note">This order has a refund recorded. The message sequence is paused. Handle the issue in the original order conversation.</p>':'')+
 '<div class="care-sequence">'+careSteps.map((step,n)=>{const sent=order.sent?.[step.id],ready=careReady(trade,order,step.id);return '<section class="care-step"><span class="care-number">'+(n+1)+'</span><div><h3>'+step.title+'</h3><p>'+(sent?'Marked sent '+esc(new Date(sent).toLocaleString('en-GB')):ready?'Ready to personalise':step.id==='posted'?'Available after recorded dispatch':step.id==='delivered'?'Available after confirmed delivery':'Available three days after confirmed delivery')+'</p><button class="secondary" data-care-preview="'+step.id+'" '+(!ready?'disabled':'')+'>'+(sent?'View message':'Prepare message')+'</button></div></section>';}).join('')+'</div></section>')+
 '<dialog id="careMessageDialog" class="utility-dialog"><div class="sheet-heading"><h2 id="careMessageTitle">Customer message</h2><button type="button" class="close-panel" data-close-dialog="careMessageDialog" aria-label="Close message">×</button></div><label>Review before copying<textarea id="careMessageText" rows="8" maxlength="3000"></textarea></label><p class="footnote">Copying does not send it. Paste into the original order conversation, send it there, then mark it sent here.</p><div class="care-buttons"><button class="action" id="careCopy">Copy message</button><button class="secondary" id="careSent">I’ve sent this message</button></div><p id="careMessageStatus" role="status"></p></dialog><p id="careError" role="alert"></p>';
}
function connectCustomerCare(){
 if(tab!=='Customer care')return;
 const fail=e=>{$('careError').textContent=e.message;toast(e.message);};
 if(isReadOnly()){$('view').querySelectorAll('input,textarea,select,form button,[data-care-preview]').forEach(el=>el.disabled=true);return;}
 $('careOrder')?.addEventListener('change',e=>{careSelected=e.target.value;render();});
 async function saveChange(change){const next=cloneWorkspace(db);next.customerCare=cloneWorkspace(careStore(next));change(next.customerCare);await persist(next);toast('Customer care saved across devices');}
 $('careTemplates').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await saveChange(c=>{c.shop=String(f.get('shop')).trim();c.templates=Object.fromEntries(careSteps.map(s=>[s.id,String(f.get(s.id)).trim()]));});}catch(error){fail(error);}};
 if($('careDetails'))$('careDetails').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await saveChange(c=>{c.orders[careSelected]={...(c.orders[careSelected]||{}),buyer:String(f.get('buyer')).trim(),tracking:String(f.get('tracking')).trim(),deliveredAt:String(f.get('deliveredAt')||'')};});}catch(error){fail(error);}};
 for(const button of $('view').querySelectorAll('[data-care-preview]'))button.onclick=()=>{
 const data=careStore(db),order=data.orders[careSelected]||{},trade=careOrders().find(t=>t.id===careSelected),step=careSteps.find(s=>s.id===button.dataset.carePreview);
 if(!trade||!careReady(trade,order,step.id))return;
 carePreview={tradeId:trade.id,step:step.id};$('careMessageTitle').textContent=step.title;
 $('careMessageText').value=careDraft(data.templates[step.id]||step.text,{buyer:order.buyer||'there',item:trade.name,shop:data.shop||'my shop',tracking:order.tracking?order.tracking+'. ':''});
 $('careMessageStatus').textContent='';const dialog=$('careMessageDialog');if(typeof dialog.showModal!=='function'&&window.dialogPolyfill)window.dialogPolyfill.registerDialog(dialog);dialog.showModal();
 };
 $('careCopy').onclick=async()=>{try{await navigator.clipboard.writeText($('careMessageText').value);$('careMessageStatus').textContent='Copied. Paste and send in the order conversation.';}catch{$('careMessageText').focus();$('careMessageText').select();$('careMessageStatus').textContent='Select and copy the message above using your device’s Copy option.';}};
 $('careSent').onclick=async()=>{const preview=carePreview;if(!preview||!$('careMessageText').value.trim())return;const button=$('careSent');button.disabled=true;try{await saveChange(c=>{const order=c.orders[preview.tradeId]||{};c.orders[preview.tradeId]={...order,sent:{...order.sent,[preview.step]:new Date().toISOString()}};});carePreview=null;}catch(error){$('careMessageStatus').textContent=error.message;button.disabled=false;}};
}
