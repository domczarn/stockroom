import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import app from '../dist/server/app.js';
import {environment} from './support.mjs';
const env=environment(), origin='https://stockroom.bookednpaid.com';
const get=path=>app.fetch(new Request(origin+path),env);
const version=readdirSync('dist/client/s')[0];
// Versioned files come straight from static assets with a one-year cache.
const fresh=await get('/s/'+version+'/app.js');
assert.equal(fresh.status,200);
assert.match(fresh.headers.get('cache-control'),/immutable/);
// Old unversioned paths (emails, the manifest, cached pages) still work, but are revalidated.
const old=await get('/icon-192.png');
assert.equal(old.status,200);
assert.equal(old.headers.get('cache-control'),'private, no-cache');
assert.equal((await get('/nope.js')).status,404);
// The Worker no longer carries scripts or fonts, and the landing page points at versioned files.
const page=await (await get('/')).text();
assert.match(page,new RegExp('/s/'+version+'/welcome.css'));
console.log('static assets ok');
