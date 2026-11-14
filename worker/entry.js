import app from './server.js';
import {withIdentity} from './access.js';
export default {
  async fetch(request,env,context){
    return app.fetch(await withIdentity(request,env),env,context);
  }
};
