import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {validateWorkspace} from '../worker/security.js';
const base={items:[],sales:[],expenses:[],research:[],sources:[]};
const o={id:'batch1',supplier:'Test supplier',channel:'Wholesale',reference:'A123',url:'https://example.com',date:'2026-11-01',expectedAt:'2026-11-06',receivedAt:'2026-11-07',stage:'Received',goods:100,shipping:10,other:0.01,notes:'',lines:[{name:'Jeans',brand:'',size:'',quantity:3}]};
const c=vm.createContext({document:{addEventListener(){}},cloneWorkspace:structuredClone,db:base,Date,Number});vm.runInContext(readFileSync('web/orders.js','utf8'),c);
const pieces=c.orderAllocation(o);assert.equal(pieces.reduce((n,p)=>n+Math.round(p.cost*100),0),11001);assert.equal(pieces.length,3);
const input={...base,bulkOrders:[o]};let i=0;const result=c.createOrderStock(input,'batch1',()=>`test${++i}`,'2026-11-07T12:00:00.000Z');validateWorkspace(result,'owner');assert.equal(input.items.length,0);assert.equal(result.items.length,3);assert.equal(result.expenses.length,0);assert.equal(result.items[0].bulkOrderId,'batch1');assert.equal(result.items[0].brand,'');assert.throws(()=>c.createOrderStock(result,'batch1',()=>'', '2026-11-07'));
assert.throws(()=>c.createOrderStock({...base,bulkOrders:[{...o,stage:'Ordered'}]},'batch1',()=>'', '2026-11-07'));
for(const patch of [{goods:-1},{url:'javascript:alert(1)'},{receivedAt:''},{date:'2026-02-30'},{lines:[{name:'Jeans',quantity:501}]},{lines:[{name:'Jeans',quantity:1.5}]}])assert.throws(()=>validateWorkspace({...base,bulkOrders:[{...o,...patch}]},'owner'));
console.log('Passed: penny-exact allocation, atomic stock creation, replay prevention, provenance, no duplicate expense and order validation.');

const html=readFileSync('web/index.html','utf8');const scripts=[...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]).filter(n=>!['dialog-polyfill.js','barcode.js','stock-qr.js'].includes(n));new vm.Script(scripts.map(n=>readFileSync('web/'+n,'utf8')).join('\n'));console.log('Passed: all application scripts parse together without global collisions.');
