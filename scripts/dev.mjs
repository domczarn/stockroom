// Development only. Synthetic identities never enter the deployed Worker.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {environment} from '../tests/support.mjs';
import app from '../dist/server/app.js';
const env=environment();
// Preview stand-in for Claude: canned answers so AI screens can be checked without a key.
env.ANTHROPIC_API_KEY='dev-preview';env.ANTHROPIC_FETCH=async(url,init)=>{const p=JSON.parse(init.body).messages.at(-1).content.at(-1).text;
 const reply=/buyer's offer/.test(p)?{verdict:'counter',counter:13,reason:'Their £10 leaves you £3.35. Countering at £13 still sells fast and makes £6.35.',reply:'Hi! Thanks for the offer. I could do £13, it’s in great condition. Happy to post tomorrow if that works?'}
  :/QUESTION:/.test(p)?{answer:'October was your best month: **£64.50** in sales from 4 items. Ralph Lauren made the most profit at **£21.40**.',suggestions:['Which brands sell fastest?','What should I reprice?']}
  :/sourcing/.test(p)?{name:'Ralph Lauren quarter zip',brand:'Ralph Lauren',category:'Quarter Zip',condition:'Very good',low:16,high:24,confidence:'medium',reason:'Ralph Lauren knits sell well and yours have averaged £21.'}:{};
 return new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify(reply)}]}),{status:200});};
// Preview stand-in for Cloudflare Images: hands the photo back unchanged.
env.IMAGES={input:stream=>({transform(){return this;},async output(){return {response:()=>new Response(stream)};}})};
// Optional demo members for previewing the admin console (SEED_MEMBERS=1).
if(process.env.SEED_MEMBERS){
 const day=86400000,iso=d=>new Date(Date.now()-d*day).toISOString();
 const people=[['sam','sam.reseller@example.com',2,14,'pro',null,1],['alex','alex.v@example.com',9,22,'free',null,0],['jo','jo.vintage@example.com',20,3,'free',null,0],['mia','mia@example.com',1,0,'free',null,0],['lee','lee.thrift@example.com',40,48,'pro',iso(-300),0]];
 for(const [id,email,joined,items,plan,until,paid] of people){
  env.sql.prepare("INSERT INTO members (email,user_id,name,status,created_at) VALUES (?,?,?,?,?)").run(email,id,id[0].toUpperCase()+id.slice(1),'active',iso(joined));
  env.sql.prepare("INSERT INTO accounts (id,email,created_at,plan,plan_until,stripe_customer,stripe_subscription) VALUES (?,?,?,?,?,?,?)").run(id,email,iso(joined),plan,until,paid?'cus_demo':null,paid?'sub_demo':null);
  const its=Array.from({length:items},(_,i)=>({id:id+i,name:'Item '+i,cost:5,price:15,status:i%3?'In Stock':'Sold',sale:i%3?null:18,photos:[],purchasedAt:'2026-11-01'}));
  env.sql.prepare("INSERT INTO workspaces (owner_id,payload,revision,updated_at) VALUES (?,?,?,?)").run(id,JSON.stringify({items:its,sales:[],expenses:[],research:[],sources:[]}),'r',iso(joined/3));
  for(let i=0;i<Math.min(items,20);i++)env.sql.prepare("INSERT INTO item_adds (owner_id,item_id,month) VALUES (?,?,?)").run(id,id+i,new Date().toISOString().slice(0,7));
  env.sql.prepare("INSERT INTO sessions (token_hash,account_id,created_at,expires_at,device) VALUES (?,?,?,?,?)").run('t'+id,id,Date.now()-joined*day/4,Date.now()+day*30,'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)');
 }
 env.sql.prepare("INSERT INTO members (email,name,status,created_at) VALUES ('invited@example.com','invited','active',?)").run(iso(0));
 env.sql.prepare("UPDATE members SET status='suspended' WHERE email='mia@example.com'").run();
}
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/__qa/mobile'){
   res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stockroom mobile preview</title><body style="margin:0;background:#e2dce9;display:flex;justify-content:center;padding:12px"><iframe title="Stockroom mobile" src="/" style="width:390px;height:844px;border:0;border-radius:18px"></iframe>');return;
  }
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
  const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id','preview-owner');headers.set('oai-authenticated-user-email','dom.czr11@gmail.com');
  const request=new Request('http://'+headers.get('host')+req.url,{method:req.method,headers,...(body.length?{body}: {})});
  const response=await app.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.writeHead(500);res.end(error.message);}
}).listen(Number(process.env.PORT||4173),'0.0.0.0');
