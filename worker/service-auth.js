const servicePaths = new Set(['/api/purchases','/api/sale-imports','/api/sync-status','/api/market-research']);
const encoder = new TextEncoder();

export async function isStockroomService(request,env,path) {
  if (!servicePaths.has(path) || !['GET','POST'].includes(request.method) || !env.STOCKROOM_SERVICE_KEY) return false;
  const match = request.headers.get('x-stockroom-service-authorization')?.match(/^Bearer (\d{10})\.([a-f0-9]{64})$/);
  if (!match) return false;
  const expires = Number(match[1]), now = Math.floor(Date.now()/1000);
  if (expires <= now || expires > now+610) return false;
  const key = await crypto.subtle.importKey('raw',encoder.encode(env.STOCKROOM_SERVICE_KEY),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const signature = Uint8Array.from(match[2].match(/../g),part=>Number.parseInt(part,16));
  return crypto.subtle.verify('HMAC',key,signature,encoder.encode('stockroom-service-v1:'+expires));
}
