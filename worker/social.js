import {notifyAccount} from './push.js';
import { HttpError, readBody } from './security.js';

const idPattern = /^[a-f0-9]{64}$/;
const usernamePattern = /^[a-z][a-z0-9_]{2,23}$/;
const reserved = new Set(['admin', 'support', 'system', 'stockroom', 'pip']);
// Instagram handles: letters, digits, dots and underscores, up to 30 characters. Accepts "@name" or an instagram.com link.
export const instagramHandle = value => {
  const v = String(value ?? '').trim().toLowerCase().replace(/^https?:\/\/(?:www\.)?instagram\.com\//, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  return /^(?!.*\.\.)(?!\.)(?!.*\.$)[a-z0-9._]{1,30}$/.test(v) ? v : null;
};
const profileDTO = row => ({
  instagram: row.instagram || '',
  username: row.username, avatarSeed: row.avatar_seed, shareRevenue: Boolean(row.share_revenue),
  shareActivity: Boolean(row.share_activity), shareLeaderboard: Boolean(row.share_leaderboard)
});

export async function ownProfile(env, user) {
  await env.DB.prepare('INSERT INTO profiles (user_id,avatar_seed,owner) VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING')
    .bind(user.id, crypto.randomUUID(), Number(user.admin)).run();
  return profileDTO(await env.DB.prepare('SELECT * FROM profiles WHERE user_id=?').bind(user.id).first());
}

async function connectionId(a, b) {
  const bytes = new TextEncoder().encode(JSON.stringify([a, b].sort()));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
}

const active = "(p.owner=1 OR EXISTS (SELECT 1 FROM members m WHERE m.user_id=p.user_id AND m.status='active'))";
const activePeer = "(EXISTS (SELECT 1 FROM profiles p WHERE p.user_id=CASE WHEN c.sender=? THEN c.recipient ELSE c.sender END AND " + active + "))";
const memberOf = '(c.sender=? OR c.recipient=?)';

// Match the workspace report: recorded sales, less recorded sale refunds, in pennies.
const revenueCents = `COALESCE((SELECT SUM(ROUND(json_extract(s.value,'$[1]')*100)) FROM json_each(w.payload,'$.sales') s),0)
  + COALESCE((SELECT SUM(ROUND(json_extract(i.value,'$.sale')*100)) FROM json_each(w.payload,'$.items') i
    WHERE json_extract(i.value,'$.status')='Sold' AND NOT EXISTS (SELECT 1 FROM json_each(w.payload,'$.trades') t
      WHERE json_extract(t.value,'$.itemId')=json_extract(i.value,'$.id'))),0)
  + COALESCE((SELECT SUM(ROUND(json_extract(t.value,'$.amount')*100) - COALESCE(
    (SELECT SUM(ROUND(json_extract(f.value,'$.amount')*100)) FROM json_each(t.value,'$.refunds') f),0))
    FROM json_each(w.payload,'$.trades') t),0)`;

async function leaderboard(url,env,user){
  const raw=url.searchParams.get('page')||'1';
  if(!/^[1-9][0-9]{0,5}$/.test(raw))throw new HttpError(400,'Invalid leaderboard page.');
  const page=Number(raw),size=30;
  const {results}=await env.DB.prepare(`WITH visible AS (
    SELECT p.user_id,p.username,p.avatar_seed,CASE WHEN p.share_leaderboard=1 AND p.username IS NOT NULL THEN ${revenueCents} END AS revenue
    FROM profiles p LEFT JOIN workspaces w ON w.owner_id=p.user_id AND p.share_leaderboard=1
    WHERE ${active}
    UNION ALL
    SELECT m.user_id,NULL,NULL,NULL FROM members m
    WHERE m.status='active' AND m.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id=m.user_id)
  ), ranked AS (
    SELECT *,CASE WHEN revenue IS NOT NULL THEN DENSE_RANK() OVER (ORDER BY revenue DESC NULLS LAST) END AS rank FROM visible
  )
  SELECT * FROM ranked ORDER BY revenue DESC NULLS LAST,username IS NULL,username,user_id LIMIT ? OFFSET ?`)
    .bind(size+1,(page-1)*size).all();
  return {page,hasNext:results.length>size,players:results.slice(0,size).map(row=>({
    username:row.username,avatarSeed:row.avatar_seed,rank:row.rank,revenue:row.revenue===null?null:row.revenue/100,mine:row.user_id===user.id
  }))};
}

function touchPresence(env,user){
  const now=Date.now();
  return env.DB.prepare(`UPDATE profiles SET last_active_at=? WHERE user_id=? AND share_activity=1 AND COALESCE(last_active_at,'')<?`)
    .bind(new Date(now).toISOString(),user.id,new Date(now-45000).toISOString()).run();
}


export async function findConnection(env,userId,id){
  return env.DB.prepare(`SELECT c.*,p.user_id AS peer_id,p.share_revenue,CASE WHEN p.share_activity=1 THEN p.last_active_at END AS last_active FROM connections c
    JOIN profiles p ON p.user_id=CASE WHEN c.sender=? THEN c.recipient ELSE c.sender END
    WHERE c.id=? AND ${memberOf} AND ${active}`).bind(userId,id,userId,userId).first();
}

export async function socialRoute(request, url, env, user, context) {
  const method = request.method;
  if(url.pathname==='/api/leaderboard'){
    if(method!=='GET')throw new HttpError(405,'Method not allowed.');
    return leaderboard(url,env,user);
  }
  if(url.pathname==='/api/profile/activity'){
    if(method!=='POST')throw new HttpError(405,'Method not allowed.');
    await touchPresence(env,user);
    return {ok:true};
  }
  if (url.pathname === '/api/profile') {
    if (method === 'GET') return {profile: await ownProfile(env, user)};
    if (method !== 'PUT') throw new HttpError(405, 'Method not allowed.');
    const body = await readBody(request, 1000);
    const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
    if (!usernamePattern.test(username) || reserved.has(username) || typeof body?.shareRevenue !== 'boolean' || ['shareActivity','shareLeaderboard'].some(key=>body[key]!==undefined&&typeof body[key]!=='boolean'))
      throw new HttpError(400, 'Use 3–24 letters, digits or underscores, starting with a letter.');
    let handle;
    if (body.instagram !== undefined) {
      handle = body.instagram === '' ? null : instagramHandle(body.instagram);
      if (body.instagram !== '' && !handle) throw new HttpError(400, 'That doesn’t look like an Instagram handle.');
      if (handle && await env.DB.prepare('SELECT 1 FROM profiles WHERE instagram=? AND user_id<>?').bind(handle, user.id).first())
        throw new HttpError(409, 'That Instagram handle is already linked to another Stockroom account.');
    }
    const current=await ownProfile(env,user);
    const shareActivity=Number(body.shareActivity??current.shareActivity);
    const result = await env.DB.prepare('UPDATE OR IGNORE profiles SET username=?,share_revenue=?,share_activity=?,share_leaderboard=?,last_active_at=CASE WHEN ?=0 THEN NULL ELSE last_active_at END WHERE user_id=?')
      .bind(username,Number(body.shareRevenue),shareActivity,Number(body.shareLeaderboard??current.shareLeaderboard),shareActivity,user.id).run();
    if (!result.meta.changes) throw new HttpError(409, 'That username is taken.');
    if (body.instagram !== undefined) {
      const ig = await env.DB.prepare('UPDATE OR IGNORE profiles SET instagram=? WHERE user_id=?').bind(handle, user.id).run();
      if (!ig.meta.changes) throw new HttpError(409, 'That Instagram handle is already linked to another Stockroom account.');
    }
    return {profile: await ownProfile(env, user)};
  }
  if (url.pathname === '/api/friends') {
    if (method === 'GET') {
      const rows = await env.DB.prepare(`SELECT c.*,p.username,p.avatar_seed,CASE WHEN c.state='accepted' THEN p.instagram END AS instagram,CASE WHEN c.state='accepted' AND p.share_activity=1 THEN p.last_active_at END AS last_active,
        CASE WHEN c.state='accepted' THEN (SELECT MAX(m.created_at) FROM messages m WHERE m.connection=c.id) END AS last_message,
        CASE WHEN c.state='accepted' THEN (SELECT COUNT(*) FROM messages m
          WHERE m.connection=c.id AND m.sender<>? AND (m.created_at || ':' || m.id)>COALESCE(r.cursor,'')) ELSE 0 END AS unread
        FROM connections c JOIN profiles p ON p.user_id=CASE WHEN c.sender=? THEN c.recipient ELSE c.sender END
        LEFT JOIN message_reads r ON r.key=c.id || ':' || ?
        WHERE ${memberOf} AND ${active} AND c.state<>'removed'
        AND (c.state<>'blocked' OR c.blocked_by=?) ORDER BY c.state,last_message DESC,p.username LIMIT 200`)
        .bind(user.id,user.id,user.id,user.id,user.id,user.id).all();
      return {friends: rows.results.map(row => ({
        id: row.id, username: row.username, avatarSeed: row.avatar_seed, instagram: row.instagram || '',
        state: row.state, incoming: row.recipient === user.id, unread:row.unread, lastMessageAt:row.last_message,lastActiveAt:row.last_active
      }))};
    }
    if (method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const body = await readBody(request, 1000);
    const raw = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
    const viaInstagram = raw.startsWith('@') || /instagram\.com\//.test(raw);
    const username = viaInstagram ? '' : raw, handle = viaInstagram ? instagramHandle(raw) : null;
    if (!(viaInstagram ? handle : usernamePattern.test(username))) throw new HttpError(400, 'Enter their exact Stockroom username, or their Instagram as @handle.');
    if (!(await ownProfile(env, user)).username) throw new HttpError(400, 'Save your username first.');
    let peer = await env.DB.prepare(`SELECT p.user_id FROM profiles p WHERE ${viaInstagram ? 'p.instagram=?' : 'p.username=?'} AND p.username IS NOT NULL AND ${active}`).bind(viaInstagram ? handle : username).first();
    // "@name" could also be someone's Stockroom username.
    if (!peer && viaInstagram && usernamePattern.test(handle)) peer = await env.DB.prepare(`SELECT p.user_id FROM profiles p WHERE p.username=? AND ${active}`).bind(handle).first();
    if (!peer || peer.user_id === user.id) throw new HttpError(404, viaInstagram ? 'Nobody on Stockroom has linked that Instagram yet. Send them an invite instead.' : 'No other active account matches that username.');
    const id = await connectionId(user.id, peer.user_id);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM connections WHERE state IN ('pending','accepted') AND (sender=? OR recipient=?)").bind(user.id, user.id).first();
    if (count.n >= 150) throw new HttpError(409, 'Remove a connection before adding another.');
    const result = await env.DB.prepare(`INSERT INTO connections (id,sender,recipient,state) VALUES (?,?,?,'pending')
      ON CONFLICT(id) DO UPDATE SET sender=excluded.sender,recipient=excluded.recipient,state='pending',blocked_by=NULL
      WHERE connections.state='removed'`).bind(id,user.id,peer.user_id).run();
    if (!result.meta.changes) throw new HttpError(409, 'A new request is unavailable for this account.');
    notifyAccount(context,env,peer.user_id,'friend');
    return {ok: true};
  }

  const match = url.pathname.match(/^\/api\/friends\/([^/]+)(?:\/(messages|revenue|read|delivered|typing))?$/);
  if (!match) return null;
  const [, id, section] = match;
  if (!idPattern.test(id)) throw new HttpError(404, 'Connection unavailable.');
  const peer = await findConnection(env,user.id,id);
  if (!peer) throw new HttpError(404, 'Connection unavailable.');
  if (!section && method === 'PUT') {
    const {action} = (await readBody(request, 1000)) || {};
    const permitted = {
      accept: peer.state === 'pending' && peer.recipient === user.id,
      remove: ['pending','accepted'].includes(peer.state),
      block: ['pending','accepted'].includes(peer.state),
      unblock: peer.state === 'blocked' && peer.blocked_by === user.id
    };
    if (!Object.hasOwn(permitted, action) || !permitted[action]) throw new HttpError(409, 'That connection has changed.');
    const state = action === 'accept' ? 'accepted' : action === 'block' ? 'blocked' : 'removed';
    const result = await env.DB.prepare('UPDATE connections SET state=?,blocked_by=? WHERE id=? AND state=? AND sender=? AND recipient=?')
      .bind(state, action === 'block' ? user.id : null,id,peer.state,peer.sender,peer.recipient).run();
    if (!result.meta.changes) throw new HttpError(409, 'That connection has changed.');
    if(action!=='accept')await env.DB.prepare('DELETE FROM chat_typing WHERE key IN (?,?)').bind(id+':'+user.id,id+':'+peer.peer_id).run();
    if(action==='accept')notifyAccount(context,env,peer.peer_id,'friend');
    return {ok:true};
  }
  if (peer.state !== 'accepted') throw new HttpError(403, 'Accept the connection before viewing this.');
  if(section==='typing'&&method==='PUT'){
    const {typing}=(await readBody(request,500))||{};
    if(typeof typing!=='boolean')throw new HttpError(400,'Invalid typing status.');
    await env.DB.prepare(`INSERT INTO chat_typing(key,expires_at)
      SELECT ?,? FROM connections c WHERE c.id=? AND ${memberOf} AND c.state='accepted' AND ${activePeer}
      ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at`)
      .bind(id+':'+user.id,typing?Date.now()+6500:0,id,user.id,user.id,user.id).run();
    return {ok:true};
  }
  if(['read','delivered'].includes(section) && method==='PUT'){
    const {messageId}=(await readBody(request,500))||{};
    if(typeof messageId!=='string'||!/^[a-f0-9-]{36}$/.test(messageId))throw new HttpError(400,'Invalid message.');
    const table=section==='read'?'message_reads':'message_deliveries';
    const result=await env.DB.prepare(`INSERT INTO ${table}(key,cursor)
      SELECT ?,m.created_at || ':' || m.id FROM messages m JOIN connections c ON c.id=m.connection
      WHERE m.id=? AND c.id=? AND m.sender<>? AND ${memberOf} AND c.state='accepted' AND ${activePeer}
      ON CONFLICT(key) DO UPDATE SET cursor=MAX(${table}.cursor,excluded.cursor)`)
      .bind(id+':'+user.id,messageId,id,user.id,user.id,user.id,user.id).run();
    if(!result.meta.changes)throw new HttpError(404,'Message unavailable.');
    return {ok:true};
  }
  if (section === 'revenue' && method === 'GET') {
    if (!peer.share_revenue) return {shared:false,totalRevenue:null};
    const row = await env.DB.prepare(`SELECT (${revenueCents}) AS revenue FROM connections c
      JOIN profiles p ON p.user_id=CASE WHEN c.sender=? THEN c.recipient ELSE c.sender END
      LEFT JOIN workspaces w ON w.owner_id=p.user_id
      WHERE c.id=? AND ${memberOf} AND c.state='accepted' AND p.share_revenue=1 AND ${active}`)
      .bind(user.id,id,user.id,user.id).first();
    return row?{shared:true,totalRevenue:row.revenue/100}:{shared:false,totalRevenue:null};
  }
  if (section === 'messages' && method === 'GET') {
    const before = url.searchParams.get('before');
    if (before && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z:[a-f0-9-]{36}$/.test(before)) throw new HttpError(400,'Invalid message cursor.');
    const rows = await env.DB.prepare(`SELECT m.id,m.sender,m.body,m.created_at FROM messages m JOIN connections c ON c.id=m.connection
      WHERE c.id=? AND ${memberOf} AND c.state='accepted' AND ${activePeer}
      AND (m.created_at || ':' || m.id) < ? ORDER BY m.created_at DESC,m.id DESC LIMIT 51`)
      .bind(id,user.id,user.id,user.id,before || '9999').all();
    const messages = rows.results.slice(0,50).reverse().map(row => ({id:row.id,mine:row.sender===user.id,body:row.body,createdAt:row.created_at}));
    if(before)return {messages,next:rows.results.length>50?messages[0].createdAt+':'+messages[0].id:null};
    const key=id+':'+peer.peer_id;
    const meta=await env.DB.prepare(`SELECT (SELECT cursor FROM message_reads WHERE key=?) AS read,
      (SELECT cursor FROM message_deliveries WHERE key=?) AS delivered,(SELECT expires_at FROM chat_typing WHERE key=?) AS typing`)
      .bind(key,key,key).first();
    return {messages,next:rows.results.length>50?messages[0].createdAt+':'+messages[0].id:null,
      read:meta.read,delivered:meta.delivered,typing:meta.typing>Date.now(),lastActiveAt:peer.last_active};
  }
  if (section === 'messages' && method === 'POST') {
    const body = await readBody(request, 12000);
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message || message.length>2000 || typeof body?.id!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.id))
      throw new HttpError(400,'Enter a message of up to 2,000 characters.');
    const result = await env.DB.prepare(`INSERT INTO messages (id,connection,sender,body,created_at)
      SELECT ?,c.id,?,?,? FROM connections c WHERE c.id=? AND ${memberOf} AND c.state='accepted' AND ${activePeer}
      ON CONFLICT(id) DO NOTHING`).bind(body.id,user.id,message,new Date().toISOString(),id,user.id,user.id,user.id).run();
    if (!result.meta.changes) {
      const prior = await env.DB.prepare('SELECT id FROM messages WHERE id=? AND connection=? AND sender=? AND body=?')
        .bind(body.id,id,user.id,message).first();
      if (!prior) throw new HttpError(409,'Message could not be sent. Refresh the conversation.');
    }else notifyAccount(context,env,peer.peer_id,'message',id);
    return {ok:true};
  }
  throw new HttpError(405,'Method not allowed.');
}
