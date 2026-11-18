import app from './server.js';
import {withIdentity} from './access.js';
import {scheduledGmail} from './gmail.js';
export default {
  async fetch(request,env,context){
    return app.fetch(await withIdentity(request,env),env,context);
  },
  async scheduled(event,env,context){
    context.waitUntil(scheduledGmail(env,context));
  }
};
