'use strict';
let profile = null;
let friends = [];
let friendsLoaded = false;
let friendsRequest = null;
let leaderboardRequest = 0;
const chatDrafts=new Map();
let currentChat = null;

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, n => n.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}

function avatar(seed, className = '') {
  return '<img class="pip-avatar '+className+'" alt="" src="'+(seed ? '/api/avatar?seed='+encodeURIComponent(seed) : '/favicon.svg')+'">';
}

function applyProfile(next) {
  profile = next;
  const name = profile?.username ? '@'+profile.username : 'Your profile';
  $('profileInitial').innerHTML = avatar(profile?.avatarSeed);
  $('navAvatar').innerHTML = avatar(profile?.avatarSeed);
  $('profileDock').innerHTML = avatar(profile?.avatarSeed)+'<span>'+esc(name)+'</span><span class="profile-badge" id="desktopUnread" hidden></span>';
  updateUnreadBadge();
  $('profileName').textContent = name;
}

function updateUnreadBadge() {
  const count = friends.reduce((sum,friend)=>sum+(friend.unread||0),0);
  for(const id of ['mobileUnread','desktopUnread']){
    const badge=$(id);
    if(!badge)continue;
    badge.hidden=!count;
    badge.textContent=count>99?'99+':String(count);
    if(count)badge.setAttribute('aria-label',count+' unread messages');
  }
  renderNotifications();
}

function profileView() {
  return '<div class="profile-layout"><section class="panel pip-profile"><div class="profile-heading">'+avatar(profile?.avatarSeed,'large')+
    '<div><span class="eyebrow">YOUR PIP</span><h2 id="profileHandle">'+esc(profile?.username?'@'+profile.username:'Choose your username')+
    '</h2><span class="tag">'+(account.role==='admin'?'Administrator':'Member')+'</span></div></div>'+
    '<p>Your public identity and privacy controls live in Settings.</p><button class="secondary" type="button" data-settings-section="privacy">Edit profile & privacy</button>'+
    '<button class="link profile-settings" type="button" data-tab="Leaderboard">Revenue leaderboard ↗</button> '+
    '<button class="link profile-settings" type="button" data-tab="Account">Account settings ↗</button></section>'+
    '<section class="panel social-panel"><span class="eyebrow">YOUR NETWORK</span><h2>Friends</h2>'+
    '<form id="friendForm" class="social-inline"><label>Find by username<input name="username" required maxlength="25" autocapitalize="none" spellcheck="false" placeholder="@username"></label><button class="action">Add friend</button></form>'+
    '<div id="friendsList">'+friendsMarkup()+'</div></section></div>';
}

const friendAction = (friend, action, label) => '<button type="button" class="secondary" data-friend="'+esc(friend.id)+'" data-friend-action="'+action+'">'+label+'</button>';
function friendsMarkup() {
  if (!friendsLoaded) return '<p class="footnote">Loading connections…</p>';
  if (!friends.length) return '<p class="footnote">No connections yet. Add someone by their Stockroom username.</p>';
  return friends.map(friend => {
    const state = friend.state === 'accepted' ? (activityLabel(friend.lastActiveAt)||'Connected') : friend.state === 'blocked' ? 'Blocked' : friend.incoming ? 'Request received' : 'Request sent';
    const controls = friend.state === 'accepted'
      ? friendAction(friend,'chat',friend.unread?'Message · '+Math.min(friend.unread,99)+(friend.unread>99?'+':'')+' new':'Message')+friendAction(friend,'remove','Remove')
      : friend.state === 'blocked' ? friendAction(friend,'unblock','Unblock')
      : friend.incoming ? friendAction(friend,'accept','Accept')+friendAction(friend,'remove','Decline')
      : friendAction(friend,'remove','Cancel');
    return '<div class="friend-row">'+avatar(friend.avatarSeed)+'<div class="friend-name"><strong>@'+esc(friend.username)+'</strong><small>'+state+'</small></div><div class="friend-actions">'+controls+'</div></div>';
  }).join('');
}

function activityLabel(value) {
  const minutes=Math.floor((Date.now()-Date.parse(value))/60000);
  if(!Number.isFinite(minutes))return '';
  if(minutes<3)return 'Active recently';
  if(minutes<60)return 'Active '+minutes+' min ago';
  if(minutes<1440)return 'Active '+Math.floor(minutes/60)+' hr ago';
  return 'Active '+Math.floor(minutes/1440)+' days ago';
}

function loadFriends() {
  if(!account)return Promise.resolve();
  if(friendsRequest)return friendsRequest;
  friendsRequest=api('/api/friends').then(({friends:next})=>{
    friends=next;
    friendsLoaded=true;
    updateUnreadBadge();
    const list=$('friendsList'),markup=friendsMarkup();
    if(list&&list.dataset.markup!==markup){list.innerHTML=markup;list.dataset.markup=markup;}
  }).finally(()=>{friendsRequest=null;});
  return friendsRequest;
}

function leaderboardView(){
  return '<section class="panel"><span class="eyebrow">STOCKROOM COMMUNITY</span><h2>All-time sales revenue</h2><p>Ranks use recorded sales after refunds, in GBP. Members choose whether to publish their total.</p><button class="secondary" type="button" data-tab="Profile">Manage my visibility</button><div id="leaderboardList" aria-live="polite">Loading leaderboard…</div></section>';
}

async function loadLeaderboard(page) {
  const list=$('leaderboardList');
  if(!list)return;
  const request=++leaderboardRequest;
  list.setAttribute('aria-busy','true');
  try{
    const {players,hasNext}=await api('/api/leaderboard?page='+page);
    if(request!==leaderboardRequest||!$('leaderboardList'))return;
    const rows=players.map(player=>'<li class="leaderboard-row"><span class="leaderboard-rank">'+
      (player.rank===null?'–':'#'+player.rank)+'</span>'+avatar(player.avatarSeed)+'<strong>'+
      esc(player.username?'@'+player.username:'Stockroom member')+(player.mine?' <small>· You</small>':'')+
      '</strong><span class="leaderboard-total">'+(player.revenue===null?'Private':esc(gbp(player.revenue)))+'</span></li>').join('');
    $('leaderboardList').innerHTML=(rows?'<ul class="leaderboard-rows">'+rows+'</ul>':'<p>No members on this page.</p>')+
      '<div class="leaderboard-pages"><button type="button" class="secondary" data-leaderboard-page="'+(page-1)+'"'+(page===1?' disabled':'')+
      '>Previous</button><span>Page '+page+'</span><button type="button" class="secondary" data-leaderboard-page="'+(page+1)+'"'+(!hasNext?' disabled':'')+'>Next</button></div>';
  }catch(error){if(request===leaderboardRequest&&$('leaderboardList'))$('leaderboardList').textContent=error.message;}
  finally{if(request===leaderboardRequest)$('leaderboardList')?.removeAttribute('aria-busy');}
}

const activePresence=()=>account&&profile?.shareActivity&&!document.hidden
  ?api('/api/profile/activity',{method:'POST'}).catch(()=>{}):Promise.resolve();

function startSocial(){
  void activePresence();
  const target=new URLSearchParams(location.search).get('chat');
  if(/^[a-f0-9]{64}$/.test(target||''))void openChatLink(target);
  else loadFriends().catch(()=>{});
  if(tab==='Leaderboard')void loadLeaderboard(1);
}

function renderChatStatus(chat) {
  const activity=activityLabel(chat.lastActiveAt);
  if($('chatActivity').textContent!==activity)$('chatActivity').textContent=activity;
  const typing=$('chatTyping');
  if(typing.hidden===!chat.typing)return;
  typing.hidden=!chat.typing;
  typing.innerHTML=chat.typing?avatar(chat.friend.avatarSeed,'typing-pip')+
    '<span>'+esc('@'+chat.friend.username)+' is typing</span><span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>':'';
}

function signalTyping(chat,typing){
  if(typing&&Date.now()-(chat.typingSentAt||0)<2500)return;
  if(!typing&&!chat.typingSentAt)return;
  chat.typingSentAt=typing?Date.now():0;
  chat.typingRequest=(chat.typingRequest||Promise.resolve()).then(()=>api('/api/friends/'+chat.friend.id+'/typing',{
    method:'PUT',body:JSON.stringify({typing})
  })).catch(()=>{});
}

async function openChat(friend) {
  if(currentChat?.friend.id===friend.id){await chatUpdate(currentChat);return;}
  const message=$('chatForm').elements.message;
  if(currentChat){
    chatDrafts.set(currentChat.friend.id,message.value);
    signalTyping(currentChat,false);
  }
  const chat={friend,messages:[],next:null,loading:false,pending:null,lastActiveAt:friend.lastActiveAt,typing:false};
  currentChat=chat;
  $('chatHeading').innerHTML=avatar(friend.avatarSeed)+' @'+esc(friend.username);
  $('chatRevenue').textContent='';
  $('chatError').textContent='';
  $('chatMessages').replaceChildren();
  $('chatEarlier').hidden=true;
  $('jumpChat').hidden=true;
  $('chatForm').hidden=false;
  message.value=chatDrafts.get(friend.id)||'';
  renderChatStatus(chat);
  if(!$('chatDialog').open)openPanel($('chatDialog'));
  await chatUpdate(chat);
}

async function openChatLink(id){
  if(!account||!/^[a-f0-9]{64}$/.test(id||''))return;
  if(document.querySelector('dialog[open]:not(#chatDialog):not(#notificationsDialog)')){
    toast('Open Notifications after finishing your edit.');return;
  }
  closePanel($('notificationsDialog'));
  navigate('Profile');
  try{
    await loadFriends();
    const friend=friends.find(row=>row.id===id&&row.state==='accepted');
    if(friend)await openChat(friend);
    else toast('This conversation is unavailable.');
  }catch(error){toast(error.message);}
}

async function chatUpdate(chat, earlier = false) {
  if (chat.loading) return;
  chat.loading = true;
  const path = '/api/friends/'+chat.friend.id;
  try {
    const history=await api(path+'/messages'+(earlier?'?before='+encodeURIComponent(chat.next):''));
    if (currentChat !== chat) return;
    const rows = new Map(chat.messages.map(row => [row.id,row]));
    for (const row of history.messages) rows.set(row.id,row);
    const ordered = [...rows.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    if (!chat.messages.length || earlier) chat.next = history.next;
    const stream = $('chatMessages');
    const previousHeight = stream.scrollHeight;
    const nearBottom = stream.scrollHeight-stream.scrollTop-stream.clientHeight < 80;
    if(!earlier){
      chat.readByPeer=history.read;
      chat.deliveredToPeer=history.delivered;
      chat.typing=history.typing;
      chat.lastActiveAt=history.lastActiveAt;
      renderChatStatus(chat);
    }
    const lastSent=ordered.filter(row=>row.mine).slice(-1)[0];
    const cursor=lastSent&&lastSent.createdAt+':'+lastSent.id;
    const receipt=!cursor?'':chat.readByPeer>=cursor?'Read':chat.deliveredToPeer>=cursor?'Delivered':'Sent';
    if (receipt!==chat.receipt || JSON.stringify(ordered) !== JSON.stringify(chat.messages)) {
      stream.innerHTML = ordered.map(row=>'<div class="chat-bubble '+(row.mine?'mine':'')+'"><span>'+esc(row.body)+
        '</span><div class="chat-bubble-meta"><time datetime="'+esc(row.createdAt)+'">'+esc(new Date(row.createdAt).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))+'</time>'+
        (row.id===lastSent?.id?'<small class="chat-receipt">'+receipt+'</small>':'')+'</div></div>').join('');
      chat.receipt=receipt;
      stream.scrollTop = earlier ? stream.scrollHeight-previousHeight+stream.scrollTop : nearBottom ? stream.scrollHeight : stream.scrollTop;
    }
    chat.messages = ordered;
    $('chatEarlier').hidden = !chat.next;
    if(!earlier&&Date.now()-(chat.revenueCheckedAt||0)>15000){
      chat.revenueCheckedAt=Date.now();
      api(path+'/revenue').then(revenue=>{
        if(currentChat===chat)$('chatRevenue').textContent=revenue.shared?'Total sales revenue '+gbp(revenue.totalRevenue):'Total revenue is private';
      }).catch(()=>{if(currentChat===chat)$('chatRevenue').textContent='';});
    }
    $('jumpChat').hidden=nearBottom || !ordered.length;
    if(!earlier)acknowledgeChat(chat,nearBottom?'read':'delivered');
    $('chatError').textContent = '';
  } catch (error) {
    if (currentChat === chat) {
      $('chatError').textContent = error.message;
      if ([403,404].includes(error.status)) {
        $('chatMessages').replaceChildren();
        $('chatRevenue').textContent = '';
        chat.typing=false;renderChatStatus(chat);
        $('chatForm').hidden = true;
        $('chatEarlier').hidden = true;
      }
    }
  } finally { chat.loading = false; }
}

async function acknowledgeChat(chat,stage='read') {
  const newest=chat.messages.filter(row=>!row.mine).slice(-1)[0];
  if(!newest||chat.read===newest.id||chat[stage]===newest.id||chat.acknowledging||document.hidden||currentChat!==chat)return;
  chat.acknowledging=true;
  try{
    await api('/api/friends/'+chat.friend.id+'/'+stage,{method:'PUT',body:JSON.stringify({messageId:newest.id})});
    chat[stage]=newest.id;
    if(stage==='read')await loadFriends();
  }catch{}finally{chat.acknowledging=false;}
}

function initialiseSocial() {
  const stream=$('chatMessages');
  const jump=$('jumpChat');
  stream.addEventListener('scroll',()=>{
    const near=stream.scrollHeight-stream.scrollTop-stream.clientHeight<80;
    jump.hidden=near;
    if(near&&currentChat)acknowledgeChat(currentChat);
  },{passive:true});
  jump.onclick=()=>{stream.scrollTop=stream.scrollHeight;if(currentChat)acknowledgeChat(currentChat);};
  $('chatForm').addEventListener('keydown',event=>{
    if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();$('chatForm').requestSubmit();}
  });
  const resizeChat=()=>{
    const viewport=window.visualViewport;
    if(viewport)document.documentElement.style.setProperty('--chat-viewport',viewport.height+'px');
  };
  window.visualViewport?.addEventListener('resize',resizeChat);
  resizeChat();
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden||!account)return;
    void activePresence();
    if(currentChat)chatUpdate(currentChat);else loadFriends().catch(()=>{});
  });
  $('chatDialog').addEventListener('close',()=>{
    if(currentChat){
      chatDrafts.set(currentChat.friend.id,$('chatForm').elements.message.value);
      signalTyping(currentChat,false);
    }
    currentChat=null;
  });
  $('chatEarlier').onclick = ()=>{ if (currentChat?.next) chatUpdate(currentChat,true); };
  $('chatForm').addEventListener('input',()=>{
    if(!currentChat)return;
    currentChat.pending=null;
    signalTyping(currentChat,Boolean($('chatForm').elements.message.value.trim()));
  });
  document.addEventListener('submit',async event=>{
    const form = event.target;
    if (!['profileForm','friendForm','chatForm'].includes(form.id)) return;
    event.preventDefault();
    const button = form.querySelector('button[type=submit],button:not([type])');
    if (button.disabled) return;
    button.disabled = true;
    try {
      if (form.id === 'profileForm') {
        const {profile: next} = await api('/api/profile',{method:'PUT',body:JSON.stringify({username:form.elements.username.value,shareRevenue:form.elements.shareRevenue.checked,shareActivity:form.elements.shareActivity.checked,shareLeaderboard:form.elements.shareLeaderboard.checked})});
        applyProfile(next);
        void activePresence();
        form.elements.username.value = next.username;
        if ($('profileHandle')) $('profileHandle').textContent = '@'+next.username;
        toast('Profile saved');
      } else if (form.id === 'friendForm') {
        await api('/api/friends',{method:'POST',body:JSON.stringify({username:form.elements.username.value.trim().replace(/^@/,'')})});
        form.reset();
        toast('Friend request sent');
        await loadFriends();
      } else {
        const chat = currentChat, message = form.elements.message.value.trim();
        if (!chat || !message) return;
        const pending = chat.pending?.message===message ? chat.pending : {message,id:newId()};
        chat.pending = pending;
        await api('/api/friends/'+chat.friend.id+'/messages',{method:'POST',body:JSON.stringify(pending)});
        if (currentChat === chat) {
          if(form.elements.message.value.trim()===message)form.reset();
          chat.pending=null;
          signalTyping(chat,false);
          stream.scrollTop=stream.scrollHeight;
          await chatUpdate(chat);
        }
      }
    } catch (error) { toast(error.message); }
    finally { button.disabled=false; }
  });
  document.addEventListener('click',async event=>{
    const page=event.target.closest('[data-leaderboard-page]');
    if(page&&!page.disabled){void loadLeaderboard(Number(page.dataset.leaderboardPage));return;}
    const button = event.target.closest('[data-friend-action]');
    if (!button || button.disabled) return;
    const friend = friends.find(row=>row.id===button.dataset.friend) || currentChat?.friend;
    if (!friend) return;
    const action = button.dataset.friendAction;
    if(action==='chat'){await openChat(friend);return;}
    if (['remove','block'].includes(action) && friend.state==='accepted' && !confirm((action==='block'?'Block':'Remove')+' @'+friend.username+'?')) return;
    button.disabled=true;
    try {
      await api('/api/friends/'+friend.id,{method:'PUT',body:JSON.stringify({action})});
      if (action==='block' && currentChat?.friend.id===friend.id) closePanel($('chatDialog'));
      await loadFriends();
    } catch (error) { toast(error.message); }
    finally { button.disabled=false; }
  });
  setInterval(()=>{
    if(document.hidden)return;
    if(currentChat&&$('chatDialog').open)chatUpdate(currentChat);
  },2000);
  setInterval(()=>{
    if(!document.hidden&&!currentChat&&account&&!document.activeElement?.closest('#friendsList, #friendForm'))loadFriends().catch(()=>{});
  },8000);
  setInterval(activePresence,60000);
}

function profileSettingsForm(){return '<form id="profileForm"><label>Username<input name="username" required minlength="3" maxlength="24" autocapitalize="none" spellcheck="false" pattern="[a-zA-Z][a-zA-Z0-9_]{2,23}" value="'+esc(profile?.username||'')+'" placeholder="your_username"></label>'+
    '<p class="footnote">Friends can find you by this username. Your email stays private.</p>'+
    '<label class="social-toggle"><input type="checkbox" name="shareRevenue" '+(profile?.shareRevenue?'checked':'')+'> Share my total sales revenue with accepted friends</label>'+
    '<label class="social-toggle"><input type="checkbox" name="shareActivity" '+(profile?.shareActivity?'checked':'')+'> Show when I was last active to accepted friends</label>'+
    '<label class="social-toggle"><input type="checkbox" name="shareLeaderboard" '+(profile?.shareLeaderboard?'checked':'')+'> Show my sales revenue on the member leaderboard</label>'+
    '<p class="footnote">Revenue sharing is optional. Costs, profit, stock and notes stay private.</p><button class="action">Save profile</button></form>';}
