// Workspace storage. The core (items, sales, trades: everything stats and leaderboards read with SQL) stays in
// workspaces.payload. Bulky per-item text lives in workspace_parts, keyed by the core's revision, so a save that
// fails half-way can never mix old and new text. Old single-record workspaces load unchanged.
const HEAVY = ['listingDescription', 'listingNotes', 'notes', 'measurements', 'flaws', 'listingTitle'];
const PART_CHARS = 900_000;
export const CORE_LIMIT = 1_900_000, TEXT_LIMIT = 30_000_000;

export function splitWorkspace(data) {
  const texts = {};
  const items = (data.items || []).map(item => {
    const core = {...item}, heavy = {};
    for (const key of HEAVY) if (typeof core[key] === 'string' && core[key].length > 0) { heavy[key] = core[key]; delete core[key]; }
    if (Object.keys(heavy).length) texts[item.id] = heavy;
    return core;
  });
  return {core: {...data, items}, texts};
}
export function mergeWorkspace(core, texts) {
  if (!core || !texts) return core;
  return {...core, items: (core.items || []).map(item => texts[item.id] ? {...item, ...texts[item.id]} : item)};
}

export async function loadWorkspace(env, ownerId) {
  const row = await env.DB.prepare('SELECT payload, revision, updated_at FROM workspaces WHERE owner_id = ?').bind(ownerId).first();
  if (!row) return null;
  const core = JSON.parse(row.payload);
  const parts = (await env.DB.prepare('SELECT data FROM workspace_parts WHERE owner_id = ? AND revision = ? ORDER BY part').bind(ownerId, row.revision).all().catch(() => ({results: []}))).results || [];
  const data = parts.length ? mergeWorkspace(core, JSON.parse(parts.map(p => p.data).join(''))) : core;
  return {data, revision: row.revision, updatedAt: row.updated_at};
}

// Writes text parts under the new revision first, then swaps the core in one guarded update, then tidies old parts.
export async function saveWorkspace(env, ownerId, data, previousRevision) {
  const {core, texts} = splitWorkspace(data);
  const coreJson = JSON.stringify(core), textJson = Object.keys(texts).length ? JSON.stringify(texts) : '';
  if (coreJson.length > CORE_LIMIT || textJson.length > TEXT_LIMIT) return {tooBig: true};
  const revision = crypto.randomUUID(), updatedAt = new Date().toISOString();
  for (let i = 0, part = 0; i < textJson.length; i += PART_CHARS, part++)
    await env.DB.prepare('INSERT INTO workspace_parts (owner_id, revision, part, data) VALUES (?, ?, ?, ?)').bind(ownerId, revision, part, textJson.slice(i, i + PART_CHARS)).run();
  const result = previousRevision
    ? await env.DB.prepare('UPDATE workspaces SET payload = ?, revision = ?, updated_at = ? WHERE owner_id = ? AND revision = ?').bind(coreJson, revision, updatedAt, ownerId, previousRevision).run()
    : await env.DB.prepare('INSERT INTO workspaces (owner_id, payload, revision, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id) DO NOTHING').bind(ownerId, coreJson, revision, updatedAt).run();
  if (!result.meta.changes) {
    await env.DB.prepare('DELETE FROM workspace_parts WHERE owner_id = ? AND revision = ?').bind(ownerId, revision).run();
    return {conflict: true};
  }
  await env.DB.prepare('DELETE FROM workspace_parts WHERE owner_id = ? AND revision <> ?').bind(ownerId, revision).run();
  return {revision, updatedAt, size: coreJson.length + textJson.length};
}
