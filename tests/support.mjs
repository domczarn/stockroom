import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
const serviceKey='fixture-only-stockroom-key';
export function serviceHeaders(expires=Math.floor(Date.now()/1000)+120){
 const signature=createHmac('sha256',serviceKey).update('stockroom-service-v1:'+expires).digest('hex');
 return {'x-stockroom-service-authorization':'Bearer '+expires+'.'+signature};
}
export function environment(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const DB={prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}};}};
 const objects=new Map();const BUCKET={async put(key,bytes,options){objects.set(key,{body:bytes,httpMetadata:options.httpMetadata});},async get(key){return objects.get(key)||null;}};
 // Stand-in for Cloudflare static assets: serves dist/client like the edge does.
 const types={js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',woff2:'font/woff2'};
 const ASSETS={async fetch(request){const path=new URL(request.url).pathname;
   if(!/^\/s\/[0-9a-f]+\/[\w.-]+$/.test(path))return new Response('Not found',{status:404});
   try{const body=readFileSync('dist/client'+path);return new Response(request.method==='HEAD'?null:body,{headers:{'content-type':(types[path.split('.').pop()]||'application/octet-stream')+(/\.(js|css|svg)$/.test(path)?';charset=utf-8':''),'cache-control':'public, max-age=31536000, immutable'}});}
   catch{return new Response('Not found',{status:404});}}};
 return {DB,BUCKET,ASSETS,sql,STOCKROOM_SERVICE_KEY:serviceKey};
}
