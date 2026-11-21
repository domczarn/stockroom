'use strict';
const gmailResult=new URLSearchParams(location.search).get('gmail');
let personalGmail=null;
let gmailBusy=false;
let gmailCheckMessage='';
const gmailFilters={category:'All',review:'unreviewed'};
const gmailCategories=['Purchase','Sale','Delivery','Refund / cancellation','Order update'];
const gmailOutcomes={connected:'Gmail connected. Stockroom will check for Vinted updates.',cancelled:'Google access was cancelled.',expired:'The connection link expired. Choose Connect Gmail to try again.',permission:'Google did not grant ongoing Gmail read access. Reconnect to try again.',failed:'Gmail could not be connected. Try again.'};

function gmailSetup(step){
  const steps=['Choose your Vinted inbox','Check for recent emails','Review your first updates'];
  return '<ol class="gmail-steps" aria-label="Gmail setup progress">'+steps.map((label,index)=>
    '<li'+(index===step?' aria-current="step"':'')+'><span aria-hidden="true">'+(index<step?'✓':index+1)+'</span>'+label+'</li>').join('')+'</ol>';
}

function gmailView(settings=false){
  if(isReadOnly())return '<section class="panel"><h2>Personal Vinted inbox</h2><p>Return to your workspace to manage your Gmail connection.</p></section>';
  const connection='<section class="panel vinted-email-panel"><span class="eyebrow">YOUR VINTED INBOX</span><h2>Gmail connection</h2><p>Connect the Gmail inbox that receives your Vinted emails. You can choose a different Google account from your Stockroom sign-in.</p><div id="personalGmailPanel">Checking connection…</div><p id="gmailCheckMessage" class="footnote" role="status"></p><p class="footnote">Stockroom searches for recent Vinted emails and saves a private summary for you to review. <a href="/privacy.html" target="_blank" rel="noopener">Gmail data & privacy</a></p></section>';
  return (settings?connection:'<section class="panel"><h2>Vinted updates</h2><p>Review recent emails from your connected inbox.</p><button class="secondary" data-settings-section="connections">Manage Gmail connection</button></section><div hidden>'+connection+'</div>')+'<section class="panel" id="personalGmailUpdates" hidden aria-label="Vinted email updates"></section>';
}

function renderGmail(){
  const panel=$('personalGmailPanel'), updates=$('personalGmailUpdates');
  if(!panel||!personalGmail||isReadOnly())return;
  const {available,connection,url}=personalGmail;
  $('gmailCheckMessage').textContent=gmailBusy?'Working on your Gmail connection…':gmailCheckMessage;
  const renderPart=(target,markup)=>{if(target.dataset.markup!==markup){target.innerHTML=markup;target.dataset.markup=markup;}};
  if(!connection){
    updates.hidden=true;
    const action=!available?'<p class="footnote">Personal Gmail connection is unavailable until Stockroom’s Google setup is complete. You can still find your receipts in Gmail and record items in Stockroom.</p>':
      location.origin!==url?'<a class="action" href="'+esc(url)+'/?open=Vinted%20updates">Continue on stockroom.bookednpaid.com</a>':
      '<button type="button" class="action" data-gmail-action="connect"'+(gmailBusy?' disabled':'')+'>Choose Gmail account</button>';
    renderPart(panel,gmailSetup(0)+action+' <a class="secondary" href="https://mail.google.com/mail/u/0/#search/from%3Ano-reply%40vinted.co.uk" target="_blank" rel="noopener noreferrer">Find Vinted emails in Gmail ↗</a>');
    return;
  }
  const locked=gmailBusy?' disabled':'';
  const optionsLocked=!available||gmailBusy?' disabled':'';
  const status=!available?'Google authorisation unavailable':!connection.enabled?'Paused':
    connection.state==='reconnect'?'Reconnect needed':connection.state==='check_failed'?'Last check failed':'Connected';
  const checked=connection.checkedAt?new Date(connection.checkedAt).toLocaleString('en-GB'):'Not checked yet';
  const needsCheck=!connection.checkedAt||connection.state!=='connected';
  renderPart(panel,gmailSetup(needsCheck?1:2)+'<div class="mini-stat"><span>Connected inbox</span><b>'+esc(connection.mailbox)+'</b></div>'+
    '<div class="mini-stat"><span>Status</span><b>'+status+'</b></div><div class="mini-stat"><span>Last check</span><b>'+esc(checked)+'</b></div>'+
    '<div class="gmail-actions">'+(available?'<button type="button" class="action" data-gmail-action="check"'+(locked||(!connection.enabled||connection.state==='reconnect'?' disabled':''))+'>Check now</button>'+
    (location.origin===url?'<button type="button" class="secondary" data-gmail-action="connect"'+locked+'>'+(connection.state==='reconnect'?'Reconnect Gmail':'Change Gmail account')+'</button>':
    '<a href="'+esc(url)+'/?open=Vinted%20updates" class="secondary">Change Gmail account</a>'):'')+
    '<button type="button" class="secondary" data-gmail-action="disconnect"'+locked+'>Disconnect</button></div>'+
    '<div class="gmail-options"><label><input type="checkbox" data-gmail-option="enabled"'+(connection.enabled?' checked':'')+optionsLocked+'> Check while Stockroom is open</label>'+
    '<label><input type="checkbox" data-gmail-option="alerts"'+(connection.alerts?' checked':'')+optionsLocked+'> Push alerts on enabled devices</label>'+
    '<label>Search window <select data-gmail-option="days"'+optionsLocked+'>'+[1,3,7].map(day=>'<option value="'+day+'"'+(day===connection.days?' selected':'')+'>'+day+' '+(day===1?'day':'days')+'</option>').join('')+'</select></label></div>');
  updates.hidden=false;
  const filtered=connection.receipts.filter(item=>(gmailFilters.category==='All'||item.category===gmailFilters.category)&&
    (gmailFilters.review==='all'||item.reviewed===(gmailFilters.review==='reviewed')));
  const options=['All',...gmailCategories].map(label=>'<option'+(gmailFilters.category===label?' selected':'')+'>'+esc(label)+'</option>').join('');
  renderPart(updates,'<h2>Vinted updates</h2><p class="footnote">Open the original email to confirm item details and amounts before recording a purchase or sale.</p><div class="gmail-actions">'+
    '<label>Update type <select data-gmail-filter="category">'+options+'</select></label>'+
    '<label>Review status <select data-gmail-filter="review">'+[['unreviewed','To review'],['reviewed','Reviewed'],['all','All updates']].map(([key,label])=>'<option value="'+key+'"'+(gmailFilters.review===key?' selected':'')+'>'+label+'</option>').join('')+'</select></label></div>'+
    '<ul class="gmail-receipts">'+filtered.map(item=>'<li id="gmail-receipt-'+esc(item.id)+'" tabindex="-1"><div><small>'+esc(item.category)+' · '+esc(new Date(item.receivedAt).toLocaleDateString('en-GB'))+'</small><strong>'+esc(item.subject)+'</strong></div>'+
    '<div class="gmail-actions"><a class="secondary" href="https://mail.google.com/mail/u/'+encodeURIComponent(connection.mailbox)+'/#all/'+encodeURIComponent(item.id)+'" target="_blank" rel="noopener noreferrer">Open email ↗</a>'+
    '<button class="secondary" type="button" data-gmail-review="'+esc(item.id)+'"'+optionsLocked+'>'+(item.reviewed?'Mark to review':'Mark reviewed')+'</button></div></li>').join('')+'</ul>'+
    (filtered.length?'':'<p class="footnote">'+(connection.receipts.length?'No updates match these filters.':
      needsCheck?'Your first successful check will show any verified Vinted emails here.':
      'No verified Vinted emails found. Check that this is the inbox Vinted uses, or try a longer search window.')+'</p>'));
}

async function loadGmail(auto=false){
  if(!account||isReadOnly()||gmailBusy)return;
  personalGmail=await api('/api/gmail');
  renderGmail();renderDailyActions();renderNotifications();
  const row=personalGmail.connection;
  if(auto&&personalGmail.available&&row?.enabled&&row.state!=='reconnect'&&(!row.checkedAt||Date.now()-Date.parse(row.checkedAt)>=30*60000))
    await changeGmail('/api/gmail/check',{method:'POST'},true);
}

async function changeGmail(path,options,automatic=false){
  if(gmailBusy||isReadOnly())return;
  gmailBusy=true;gmailCheckMessage='';renderGmail();
  try{
    const result=await api(path,options);
    if(result.authorizeUrl){location.assign(result.authorizeUrl);return;}
    personalGmail=result;
    if(path.endsWith('/check'))gmailCheckMessage=result.added?result.added+' new Vinted '+(result.added===1?'update':'updates')+' ready to review.':
      result.connection?.state==='connected'?'Vinted inbox up to date.':result.connection?.state==='check_failed'?'The last check failed. Try again in a minute.':'';
    else if(options.method==='DELETE')toast('Gmail disconnected and its receipt summaries removed.');
  }catch(error){
    gmailCheckMessage=error.message;
    if(!automatic&&!gmailTabs.includes(tab))toast(error.message);
    try{personalGmail=await api('/api/gmail');}catch{}
  }finally{gmailBusy=false;renderGmail();renderDailyActions();renderNotifications();}
}

// The Gmail section appears on Vinted updates and in Settings (tab 'Account').
const gmailTabs=['Vinted updates','Account'];
function initialiseGmail(){
  if(gmailResult&&gmailOutcomes[gmailResult]){
    tab='Vinted updates';
    history.replaceState(null,'','/?open=Vinted%20updates');
    toast(gmailOutcomes[gmailResult]);
  }
  document.addEventListener('click',event=>{
    const jump=event.target.closest('[data-gmail-jump]');
    if(jump&&!isReadOnly()){
      gmailFilters.category='All';gmailFilters.review='unreviewed';
      navigate('Vinted updates');
      const receipt=$('gmail-receipt-'+jump.dataset.gmailJump);
      receipt?.focus({preventScroll:true});
      receipt?.scrollIntoView({block:'center'});
      return;
    }
    if(!gmailTabs.includes(tab)||isReadOnly()||gmailBusy)return;
    const action=event.target.closest('[data-gmail-action]')?.dataset.gmailAction;
    if((action==='connect'||action==='check')&&account?.plan!=='pro'){openUpgrade('Gmail auto-updates are part of Stockroom Pro.');return;}
    if(action==='connect')void changeGmail('/api/gmail/connect',{method:'POST'});
    else if(action==='check')void changeGmail('/api/gmail/check',{method:'POST'});
    else if(action==='disconnect'){
      if(confirm('Disconnect Gmail and remove its Vinted email summaries from Stockroom?'))void changeGmail('/api/gmail',{method:'DELETE'});
    }else{
      const id=event.target.closest('[data-gmail-review]')?.dataset.gmailReview;
      const receipt=personalGmail?.connection?.receipts.find(item=>item.id===id);
      if(receipt)void changeGmail('/api/gmail/review',{method:'PUT',body:JSON.stringify({id,reviewed:!receipt.reviewed})});
    }
  });
  document.addEventListener('change',event=>{
    if(!gmailTabs.includes(tab)||isReadOnly())return;
    const {gmailOption,gmailFilter}=event.target.dataset;
    if(gmailFilter){gmailFilters[gmailFilter]=event.target.value;renderGmail();return;}
    const row=personalGmail?.connection;
    if(!gmailOption||!row)return;
    const {enabled,alerts,days}=row;
    const value=gmailOption==='days'?Number(event.target.value):event.target.checked;
    void changeGmail('/api/gmail',{method:'PUT',body:JSON.stringify({enabled,alerts,days,[gmailOption]:value})});
  });
  setInterval(()=>{if(!document.hidden)loadGmail(true).catch(()=>{});},5*60000);
}
