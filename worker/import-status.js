import {HttpError,readBody} from './security.js';

export async function emailSyncState(env){
  const row=await env.DB.prepare("SELECT enabled,mailbox,state,checked_at FROM email_sync WHERE id='vinted'").first();
  return {enabled:row?.enabled!==0,mailbox:row?.mailbox||null,state:row?.state||'unverified',checkedAt:row?.checked_at||null};
}

export async function syncStatusRoute(request,env,user){
  if(request.method==='GET'){
    const row=await env.DB.prepare('SELECT MAX(updated_at) AS last_import, COUNT(*) AS count FROM purchase_imports').first();
    return {lastImport:row.last_import,purchaseCount:row.count,email:await emailSyncState(env)};
  }
  if(request.method!=='PUT'&&request.method!=='POST')throw new HttpError(405,'Method not allowed');
  const body=await readBody(request,1600);
  if(request.method==='PUT'){
    if(!user?.admin)throw new HttpError(403,'Admin access required');
    if(typeof body?.enabled!=='boolean')throw new HttpError(400,'Choose whether Vinted email imports are enabled.');
    await env.DB.prepare("INSERT INTO email_sync (id,enabled) VALUES ('vinted',?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled")
      .bind(Number(body.enabled)).run();
  }else{
    if(user)throw new HttpError(403,'Sync status is set by the Gmail connection check.');
    const {state,mailbox}=body||{};
    if(!['connected','needs_attention','check_failed'].includes(state) ||
      (state==='connected' && (typeof mailbox!=='string'||mailbox.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox))))
      throw new HttpError(400,'Invalid connection check.');
    await env.DB.prepare(`INSERT INTO email_sync (id,mailbox,state,checked_at) VALUES ('vinted',?,?,?)
      ON CONFLICT(id) DO UPDATE SET mailbox=COALESCE(excluded.mailbox,email_sync.mailbox),state=excluded.state,checked_at=excluded.checked_at`)
      .bind(state==='connected'?mailbox:null,state,new Date().toISOString()).run();
  }
  return {email:await emailSyncState(env)};
}
