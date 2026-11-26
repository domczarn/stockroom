import {build,transform} from 'esbuild';
import {resolve} from 'node:path';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const files = ['index.html','login.html','welcome.html','welcome.css','welcome.js','login.css','privacy.html','terms.html','gmail.js','compat.js','sync.js','app.js','finance-insights.js','shell.js','screenshots.js','revenue.js','pricing.js','tax.js','performance.js','addstock.js','refresh.js','autoupdate.js','reveal.js','iap.js','customer.js','expenses.js','settings.js','billing.js','admin.js','announce.js','studio.js','pipai.js','grow.js','island.js','pipplus.js','mobilehome.js','onboarding.js','shipqr.js','nav.js','start.js','orders.js','labels.css','app.css','resources.js','resources-data.json','seed.json','receipt.js','listing.js','experience.js','manifest.webmanifest','favicon.svg','icon.svg','pip.svg','pip-orb.svg','constellation.svg','social.js','trading.js','bulk.js','stock.js','market.js','notifications.js','stockroom-sw.js'];
const assets = {};
for (const file of files) {
  const source=await readFile('web/'+file,'utf8');
  assets['/'+file]=file.endsWith('.js')?(await transform(source,{target:'es2019',minifyWhitespace:true,minifySyntax:true})).code
    :file.endsWith('.css')?(await transform(source,{loader:'css',minify:true,target:['safari14','chrome100']})).code:source;
}
assets['/dialog-polyfill.js']=await readFile('node_modules/dialog-polyfill/dist/dialog-polyfill.js','utf8');
assets['/dialog-polyfill.css']=(await readFile('node_modules/dialog-polyfill/dist/dialog-polyfill.css','utf8')).replace(/(^|\n)(dialog|\._dialog_overlay)/g,'$1.dialog-fallback $2');
const qr = await build({
  stdin:{contents:"import QRCode from 'qrcode/lib/core/qrcode.js'; window.stockroomQrMatrix = value => QRCode.create(value, {errorCorrectionLevel:'M'}).modules;",resolveDir:resolve('.')},
  bundle:true,platform:'browser',format:'iife',minify:true,write:false
});
assets['/stock-qr.js']=qr.outputFiles[0].text;
const login = await build({entryPoints:['web/login-src.js'],bundle:true,platform:'browser',format:'iife',minify:true,target:'es2019',write:false});
assets['/login.js']=login.outputFiles[0].text;
const passkeyKit = await build({stdin:{contents:"import {startRegistration,browserSupportsWebAuthn} from '@simplewebauthn/browser'; window.stockroomPasskeys = {startRegistration, browserSupportsWebAuthn};",resolveDir:resolve('.')},bundle:true,platform:'browser',format:'iife',minify:true,target:'es2019',write:false});
assets['/passkeys.js']=passkeyKit.outputFiles[0].text;
assets['/receipt-ocr.js']=await readFile('node_modules/tesseract.js/dist/tesseract.esm.min.js','utf8');
assets['/receipt-ocr-worker.js']=await readFile('node_modules/tesseract.js/dist/worker.min.js','utf8');
assets['/barcode.js']=await readFile('node_modules/jsbarcode/dist/barcodes/JsBarcode.code128.min.js','utf8');
for(const f of ['apple-touch-icon.png','icon-192.png','icon-maskable.png'])assets['/'+f]={base64:(await readFile('web/'+f)).toString('base64'),type:'image/png'};
assets['/pip-icon.png']={base64:(await readFile('web/pip-icon.png')).toString('base64'),type:'image/png'};
assets['/geist.woff2']={base64:(await readFile('node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2')).toString('base64'),type:'font/woff2'};
assets['/geist-mono.woff2']={base64:(await readFile('node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2')).toString('base64'),type:'font/woff2'};
// Build version: open apps poll /version.json and reload when it changes.
const version=createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0,12);
assets['/version.json']=JSON.stringify({version});
assets['/index.html']=assets['/index.html'].replace('<meta charset="utf-8">','<meta charset="utf-8"><meta name="stockroom-version" content="'+version+'">');
assets['/'] = assets['/index.html'];
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});
// Static files (scripts, styles, fonts, images) are served by Cloudflare straight from dist/client/s/<version>/,
// cached for a year because the version is in the path. The Worker keeps only pages, JSON, the manifest and the
// service worker, so it stays small and starts fast. Old unversioned paths still work through the Worker.
const keepInWorker=name=>/\.(?:html|json|webmanifest)$/.test(name)||name==='/'||name==='/stockroom-sw.js';
const staticNames=Object.keys(assets).filter(name=>!keepInWorker(name));
const base='/s/'+version+'/';
const escapeRe=v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const refs=new RegExp('(["\'(])\\/?('+staticNames.map(n=>escapeRe(n.slice(1))).sort((a,b)=>b.length-a.length).join('|')+')(?=["\')?#])','g');
const rewrite=text=>text.replace(refs,(_,quote,name)=>quote+base+name);
for(const name of Object.keys(assets))if(typeof assets[name]==='string'&&!/\.json$/.test(name)&&name!=='/stockroom-sw.js')assets[name]=rewrite(assets[name]);
await mkdir('dist/client'+base,{recursive:true});
for(const name of staticNames){
  const a=assets[name];
  await writeFile('dist/client'+base+name.slice(1),typeof a==='object'?Buffer.from(a.base64,'base64'):a);
}
await writeFile('dist/client/_headers','/s/*\n  Cache-Control: public, max-age=31536000, immutable\n  X-Content-Type-Options: nosniff\n');
const workerAssets=Object.fromEntries(Object.entries(assets).filter(([name])=>keepInWorker(name)));
const banner={js:'const assets = '+JSON.stringify(workerAssets)+';\nconst staticAssets = '+JSON.stringify({base,names:staticNames})+';'};
// index.js is the deployed Worker (verifies Cloudflare Access). app.js skips that wrapper for tests and local dev only.
await build({entryPoints:{index:'worker/entry.js',app:'worker/server.js'},banner,
  bundle:true,format:'esm',platform:'browser',target:'es2022',outdir:'dist/server'});
console.log('Built Stockroom Worker');
