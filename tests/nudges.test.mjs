import assert from 'node:assert/strict';
import {pickNudge, nudgeCopy} from '../worker/nudges.js';

const now = Date.parse('2026-11-27T12:00:00Z'), DAY = 86400000;
const ago = d => new Date(now - d * DAY).toISOString();
// Signed up, nothing added: nudge after a day, give up after two weeks.
assert.equal(pickNudge({createdAt: ago(0.5), lastChange: null, items: 0}, now), null);
assert.equal(pickNudge({createdAt: ago(2), lastChange: null, items: 0}, now), 'start');
assert.equal(pickNudge({createdAt: ago(2), lastChange: ago(2), items: 0}, now), 'start');
assert.equal(pickNudge({createdAt: ago(20), lastChange: null, items: 0}, now), null);
// Has stock: quiet 7 days, then 21, then silence. Keys change with each quiet spell.
assert.equal(pickNudge({createdAt: ago(90), lastChange: ago(3), items: 5}, now), null);
assert.equal(pickNudge({createdAt: ago(90), lastChange: ago(8), items: 5}, now), 'quiet7:' + ago(8).slice(0, 10));
assert.equal(pickNudge({createdAt: ago(90), lastChange: ago(25), items: 5}, now), 'quiet21:' + ago(25).slice(0, 10));
assert.equal(pickNudge({createdAt: ago(200), lastChange: ago(90), items: 5}, now), null);
// Copy uses real numbers and stays short enough for a push.
const c = nudgeCopy('quiet7:2026-11-19', {inStock: 12, tiedUp: 240, stale: 3});
assert.match(c.push, /12 items in stock, £240\.00 tied up\. 3 have been up 30\+ days/);
assert.ok(c.push.length <= 170 && !/—/.test(JSON.stringify(c)));
assert.match(nudgeCopy('start', {}).subject, /empty/);
console.log('nudges ok');
