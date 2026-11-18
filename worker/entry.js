import app from './server.js';
import {withIdentity,explainAccessJwt} from './access.js';
export default {
  async fetch(request,env,context){
    if(new URL(request.url).pathname==='/__access-check')return new Response(JSON.stringify(await explainAccessJwt(request.headers.get('cf-access-jwt-assertion'),env),null,1),{headers:{'content-type':'application/json','cache-control':'no-store'}});
    return app.fetch(await withIdentity(request,env),env,context);
  }
};
