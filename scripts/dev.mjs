// Development only. Synthetic identities never enter the deployed Worker.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {environment} from '../tests/support.mjs';
import app from '../dist/server/app.js';
const env=environment();
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
