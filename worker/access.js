// Cloudflare Access adapter. Access authenticates viewers at the edge and forwards a signed JWT.
// This module verifies that JWT and is the only place that creates the internal identity headers
// the rest of the Worker trusts. Any identity header sent by a client is discarded first.
const b64 = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));
const decoder = new TextDecoder();
const keyCache = {at:0,keys:null};

async function signingKeys(env){
  if(keyCache.keys&&Date.now()-keyCache.at<3600000)return keyCache.keys;
  const response=await fetch('https://'+env.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('Access keys unavailable');
  keyCache.keys=(await response.json()).keys||[];
  keyCache.at=Date.now();
  return keyCache.keys;
}

export async function verifyAccessJwt(token,env,now=Date.now()){
  if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD||typeof token!=='string')return null;
  const parts=token.split('.');
  if(parts.length!==3)return null;
  try{
    const header=JSON.parse(decoder.decode(b64(parts[0])));
    if(header.alg!=='RS256')return null;
    const jwk=(await signingKeys(env)).find(key=>key.kid===header.kid);
    if(!jwk)return null;
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
    if(!valid)return null;
    const claims=JSON.parse(decoder.decode(b64(parts[1])));
    const audience=Array.isArray(claims.aud)?claims.aud:[claims.aud];
    // ACCESS_AUD may list several Access apps (workers.dev and the custom domain), comma-separated.
    const allowed=String(env.ACCESS_AUD).split(',').map(value=>value.trim()).filter(Boolean);
    if(!audience.some(value=>allowed.includes(value)))return null;
    if(claims.iss!=='https://'+env.ACCESS_TEAM_DOMAIN)return null;
    if(typeof claims.exp!=='number'||claims.exp*1000<=now)return null;
    if(typeof claims.nbf==='number'&&claims.nbf*1000>now+60000)return null;
    if(typeof claims.sub!=='string'||!claims.sub||typeof claims.email!=='string'||!claims.email)return null;
    return {id:claims.sub,email:claims.email};
  }catch{return null;}
}

import {sessionIdentity} from './auth.js';

export async function withIdentity(request,env){
  const headers=new Headers(request.headers);
  headers.delete('oai-authenticated-user-id');
  headers.delete('oai-authenticated-user-email');
  // Cloudflare Access first (while it's switched on), then Stockroom's own sign-in session.
  const user=await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'),env)||await sessionIdentity(request,env);
  if(user){headers.set('oai-authenticated-user-id',user.id);headers.set('oai-authenticated-user-email',user.email);}
  return new Request(request,{headers});
}
