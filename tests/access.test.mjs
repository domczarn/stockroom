import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign} from 'node:crypto';
import {withIdentity} from '../worker/access.js';

const team='fixture.cloudflareaccess.com', aud='fixture-aud';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'k1',alg:'RS256',use:'sig'};
const b64u=value=>Buffer.from(value).toString('base64url');
function token(claims,header={alg:'RS256',kid:'k1'}){
  const body=b64u(JSON.stringify(header))+'.'+b64u(JSON.stringify(claims));
  return body+'.'+createSign('RSA-SHA256').update(body).sign(privateKey).toString('base64url');
}
const good={aud:[aud],iss:'https://'+team,sub:'user-1',email:'Member@Example.com',exp:Math.floor(Date.now()/1000)+600};
globalThis.fetch=async url=>{
  assert.equal(String(url),'https://'+team+'/cdn-cgi/access/certs');
  return new Response(JSON.stringify({keys:[jwk]}));
};
const env={ACCESS_TEAM_DOMAIN:team,ACCESS_AUD:aud};
const identify=async(headers,e=env)=>{
  const request=await withIdentity(new Request('https://stockroom.test/api/me',{headers}),e);
  return {id:request.headers.get('oai-authenticated-user-id'),email:request.headers.get('oai-authenticated-user-email')};
};

// A verified token becomes the identity.
assert.deepEqual(await identify({'cf-access-jwt-assertion':token(good)}),{id:'user-1',email:'Member@Example.com'});
// Client-supplied identity headers never survive, with or without a token.
assert.deepEqual(await identify({'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'admin@example.com'}),{id:null,email:null});
assert.deepEqual(await identify({'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'admin@example.com','cf-access-jwt-assertion':token({...good,sub:'real'})}),{id:'real',email:'Member@Example.com'});
// Bad tokens yield no identity.
const none={id:null,email:null};
assert.deepEqual(await identify({'cf-access-jwt-assertion':token({...good,aud:['other']})}),none);
assert.deepEqual(await identify({'cf-access-jwt-assertion':token({...good,iss:'https://evil.example'})}),none);
assert.deepEqual(await identify({'cf-access-jwt-assertion':token({...good,exp:Math.floor(Date.now()/1000)-5})}),none);
assert.deepEqual(await identify({'cf-access-jwt-assertion':token(good,{alg:'RS256',kid:'unknown'})}),none);
assert.deepEqual(await identify({'cf-access-jwt-assertion':token(good,{alg:'none',kid:'k1'})}),none);
assert.deepEqual(await identify({'cf-access-jwt-assertion':token(good).slice(0,-6)+'AAAAAA'}),none);
assert.deepEqual(await identify({'cf-access-jwt-assertion':'not-a-jwt'}),none);
// Several audiences are accepted when configured as a list.
assert.deepEqual(await identify({'cf-access-jwt-assertion':token({...good,aud:['second-aud']})},{...env,ACCESS_AUD:aud+', second-aud'}),{id:'user-1',email:'Member@Example.com'});
assert.deepEqual(await identify({'cf-access-jwt-assertion':token({...good,aud:['third-aud']})},{...env,ACCESS_AUD:aud+', second-aud'}),none);
// Missing configuration fails closed.
assert.deepEqual(await identify({'cf-access-jwt-assertion':token(good)},{}),none);
console.log('access ok');
