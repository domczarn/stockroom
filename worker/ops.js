// Change-based saves. The app sends only what changed since the copy it last got from the server:
//   {k:'items', id:'0034', before:<hash of that record then | null if new>, rec:<new record | null to delete>, at:<index>}
//   {k:'sales', before:<hash of the whole value then>, val:<new value>}
// Each change is checked on its own, so two devices editing different items never clash. Only a record that both
// devices changed (to different things) is reported as a conflict.
export function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value ?? null);
}
// cyrb53: fast, well-spread 53-bit string hash (not for security, only for "did this record change").
export function hash(value) {
  if (value === null || value === undefined) return null;
  const str = stable(value);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
// Apply changes to the server's current copy. Returns {data, conflicts, touched} without mutating `current`.
export function applyOps(current, ops) {
  if (!Array.isArray(ops) || ops.length > 5000) return {error: 'Invalid changes.'};
  const data = {...current}, conflicts = [], touched = [];
  const copied = new Set();
  for (const op of ops) {
    if (!op || typeof op !== 'object' || typeof op.k !== 'string' || !KEY.test(op.k) || op.k === '__proto__') return {error: 'Invalid changes.'};
    if (op.before !== null && op.before !== undefined && typeof op.before !== 'string') return {error: 'Invalid changes.'};
    if ('id' in op) {
      if (typeof op.id !== 'string' || !op.id || op.id.length > 100) return {error: 'Invalid changes.'};
      if (op.rec !== null && (typeof op.rec !== 'object' || Array.isArray(op.rec) || op.rec.id !== op.id)) return {error: 'Invalid changes.'};
      if (!copied.has(op.k)) { data[op.k] = Array.isArray(data[op.k]) ? [...data[op.k]] : []; copied.add(op.k); }
      const list = data[op.k], index = list.findIndex(r => r && r.id === op.id), now = index < 0 ? null : list[index];
      if (hash(now) !== (op.before ?? null)) {
        if (stable(now) === stable(op.rec)) continue;   // both devices made the same change
        conflicts.push({k: op.k, id: op.id, name: String(now?.name || op.rec?.name || op.id).slice(0, 80)});
        continue;
      }
      if (op.rec === null) { if (index >= 0) list.splice(index, 1); }
      else if (index >= 0) list[index] = op.rec;
      else list.splice(Number.isInteger(op.at) ? Math.max(0, Math.min(op.at, list.length)) : list.length, 0, op.rec);
      touched.push({k: op.k, id: op.id});
    } else {
      if (!('val' in op)) return {error: 'Invalid changes.'};
      const now = data[op.k];
      if (hash(now) !== (op.before ?? null)) {
        if (stable(now) === stable(op.val)) continue;
        conflicts.push({k: op.k, name: op.k});
        continue;
      }
      if (op.val === null || op.val === undefined) delete data[op.k]; else data[op.k] = op.val;
      copied.delete(op.k);
      touched.push({k: op.k});
    }
  }
  return {data, conflicts, touched};
}
// The final server version of everything a save touched, so the app can pick up stored photo paths etc.
export function touchedRecords(data, touched) {
  return touched.map(t => 'id' in t ? {k: t.k, id: t.id, rec: (data[t.k] || []).find(r => r && r.id === t.id) || null} : {k: t.k, val: data[t.k] ?? null});
}
