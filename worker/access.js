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
    if(!audience.includes(env.ACCESS_AUD))return null;
    if(claims.iss!=='https://'+env.ACCESS_TEAM_DOMAIN)return null;
    if(typeof claims.exp!=='number'||claims.exp*1000<=now)return null;
    if(typeof claims.nbf==='number'&&claims.nbf*1000>now+60000)return null;
    if(typeof claims.sub!=='string'||!claims.sub||typeof claims.email!=='string'||!claims.email)return null;
    return {id:claims.sub,email:claims.email};
  }catch{return null;}
}

export async function withIdentity(request,env){
  const headers=new Headers(request.headers);
  headers.delete('oai-authenticated-user-id');
  headers.delete('oai-authenticated-user-email');
  const user=await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'),env);
  if(user){headers.set('oai-authenticated-user-id',user.id);headers.set('oai-authenticated-user-email',user.email);}
  return new Request(request,{headers});
}

// TEMPORARY diagnostic: explains why a token was rejected. Reachable only with a token the caller supplies.
export async function explainAccessJwt(token,env,now=Date.now()){
  const out={configured:Boolean(env.ACCESS_TEAM_DOMAIN&&env.ACCESS_AUD),team:env.ACCESS_TEAM_DOMAIN||null,hasToken:typeof token==='string'&&token.length>0};
  if(!out.hasToken||!out.configured)return out;
  try{
    const parts=token.split('.');
    const header=JSON.parse(decoder.decode(b64(parts[0])));
    const claims=JSON.parse(decoder.decode(b64(parts[1])));
    out.tokenIssuer=claims.iss;out.tokenAudMatchesConfig=(Array.isArray(claims.aud)?claims.aud:[claims.aud]).includes(env.ACCESS_AUD);
    out.tokenAudPrefix=String((Array.isArray(claims.aud)?claims.aud[0]:claims.aud)||'').slice(0,8);out.configAudPrefix=String(env.ACCESS_AUD).slice(0,8);
    out.issuerMatches=claims.iss==='https://'+env.ACCESS_TEAM_DOMAIN;out.expired=typeof claims.exp!=='number'||claims.exp*1000<=now;out.hasEmail=typeof claims.email==='string';out.hasSub=typeof claims.sub==='string';
    const keys=await signingKeys(env);out.keyFound=keys.some(key=>key.kid===header.kid);out.verified=Boolean(await verifyAccessJwt(token,env,now));
  }catch(error){out.error=String(error&&error.message||error).slice(0,120);}
  return out;
}
