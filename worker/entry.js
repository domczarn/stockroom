import app from './server.js';
import {withIdentity} from './access.js';
import {scheduledGmail} from './gmail.js';
import {scheduledWeekly} from './weekly.js';
import {scheduledAlerts} from './alerts.js';
import {rebuildPriceIndex} from './grow.js';
import {inboundEmail} from './inbound.js';
export default {
  async fetch(request,env,context){
    return app.fetch(await withIdentity(request,env),env,context);
  },
  // Forwarded Vinted / courier / eBay / Depop emails (Cloudflare Email Routing → this Worker).
  async email(message,env,context){
    try{await inboundEmail(message,env,context);}
    catch(error){console.error('Inbound email failed',String(error?.message||error).slice(0,160));}
  },
  async scheduled(event,env,context){
    if(event.cron!=='*/10 * * * *'){context.waitUntil(scheduledGmail(env,context));return;}
    context.waitUntil(scheduledAlerts(env).catch(()=>{}));
    context.waitUntil(rebuildPriceIndex(env).catch(error=>console.error('Price index failed',String(error?.message||error).slice(0,160))));
    context.waitUntil(scheduledWeekly(env).catch(error=>console.error('Weekly report failed',String(error?.message||error).slice(0,160))));
  }
};
