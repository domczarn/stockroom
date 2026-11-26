'use strict';
// Change-based saves (matches worker/ops.js). Only what changed since the last copy the server confirmed is sent,
// so saves are small and two devices editing different items never clash.
let cloudBase = null, pendingOffline = false;
function wsStable(value) {
  if (Array.isArray(value)) return '[' + value.map(wsStable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + wsStable(value[k])).join(',') + '}';
  return JSON.stringify(value ?? null);
}
function wsHash(value) {
  if (value === null || value === undefined) return null;
  const str = wsStable(value);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const wsRecordList = v => Array.isArray(v) && v.every(r => r && typeof r === 'object' && !Array.isArray(r) && typeof r.id === 'string' && r.id);
function wsDiff(base, next) {
  const ops = [];
  for (const k of new Set([...Object.keys(base || {}), ...Object.keys(next || {})])) {
    const a = base?.[k], b = next?.[k];
    if (wsRecordList(a ?? []) && wsRecordList(b ?? []) && (Array.isArray(a) || Array.isArray(b))) {
      const before = new Map((a || []).map(r => [r.id, r]));
      const after = new Set();
      (b || []).forEach((r, i) => {
        after.add(r.id);
        const old = before.get(r.id);
        if (!old) ops.push({k, id: r.id, before: null, rec: r, at: i});
        else if (wsStable(old) !== wsStable(r)) ops.push({k, id: r.id, before: wsHash(old), rec: r});
      });
      for (const [id, old] of before) if (!after.has(id)) ops.push({k, id, before: wsHash(old), rec: null});
    } else if (wsStable(a) !== wsStable(b)) ops.push({k, before: wsHash(a), val: b ?? null});
  }
  return ops;
}
// Put the server's final version of each saved record (stored photo paths etc.) back into the local copy.
function wsApplyChanges(data, changes) {
  const out = {...data};
  for (const c of changes || []) {
    if ('id' in c) {
      const list = out[c.k] = [...(out[c.k] || [])], i = list.findIndex(r => r?.id === c.id);
      if (c.rec === null) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = c.rec; else list.push(c.rec);
    } else if (c.val === null) delete out[c.k]; else out[c.k] = c.val;
  }
  return out;
}
const wsPendingCount = () => (cloudBase && pendingLocal) ? wsDiff(cloudBase, pendingLocal).length : (pendingLocal ? 1 : 0);
function wsOfflineState() {
  const n = wsPendingCount();
  cloudState(n ? 'Offline · ' + n + ' change' + (n === 1 ? '' : 's') + ' waiting' : 'Offline', 'error');
}
// Offline edits are kept on this device and sent as soon as there is signal again.
async function wsFlush() {
  if (!pendingOffline || cloudSaving || cloudConflict || !pendingLocal || isReadOnly() || !navigator.onLine) return;
  try { await persist(db); } catch {}
}
window.addEventListener('online', () => void wsFlush());
setInterval(() => void wsFlush(), 30000);
