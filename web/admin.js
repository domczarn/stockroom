// Admin console: overview, members (with a full profile sheet per person), invites, activity and app settings.
let adminTab = 'overview', adminData = {overview: null, people: null, activity: null, settings: null}, adminError = '';
let adminQuery = '', adminFilter = 'all', adminSort = 'newest', adminActivityQuery = '', adminMember = null, adminInviteResults = null;

const ACTION_LABELS = {
  member_joined: 'Joined', member_invited: 'Invited', member_approved: 'Approved', member_suspended: 'Suspended', member_reactivated: 'Reactivated',
  admin_view: 'Viewed workspace (admin)', admin_export: 'Exported data (admin)', admin_signed_out_everywhere: 'Signed out everywhere (admin)',
  admin_removed_pro: 'Pro removed (admin)', admin_reset_allowance: 'Monthly allowance reset (admin)', admin_renamed_member: 'Renamed (admin)',
  admin_deleted_member: 'Account deleted (admin)', admin_granted_pro_forever: 'Pro granted forever (admin)', workspace_save: 'Saved workspace',
};
const actionLabel = a => ACTION_LABELS[a] || (/^admin_granted_pro_(\d+)m$/.test(a) ? 'Pro granted for ' + a.match(/(\d+)m$/)[1] + ' months (admin)' : /^admin_settings_/.test(a) ? 'App settings changed' : a.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()));
const ago = iso => {
  if (!iso) return 'Never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'Just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});
};
const dateGB = iso => iso ? new Date(iso).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}) : '—';
const initial = m => esc(((m.username || m.name || m.email || '?')[0] || '?').toUpperCase());
function planBadge(m) {
  if (m.status === 'suspended') return '<span class="adm-badge bad">Suspended</span>';
  if (m.plan === 'pro') return '<span class="adm-badge pro">' + (m.comped ? 'Pro · comped' : 'Pro') + '</span>';
  return '<span class="adm-badge">Free</span>';
}

async function loadAdmin() {
  adminError = '';
  try {
    const [overview, people, activity, settings] = await Promise.all([
      api('/api/admin/overview'), api('/api/admin/people'), api('/api/admin/activity?limit=300'), api('/api/admin/settings')]);
    adminData = {overview, people, activity, settings: settings.settings};
    members = people.members.map(m => ({email: m.email, user_id: m.userId, name: m.name, status: m.status})); // workspace picker
    adminEvents = activity.events;
  } catch (error) { adminError = error.message; }
}

function adminView() {
  const tabs = [['overview', 'Overview'], ['members', 'Members'], ['invite', 'Invite'], ['activity', 'Activity'], ['settings', 'App settings']];
  const head = '<div class="view-tabs adm-tabs" role="tablist" aria-label="Admin sections">' + tabs.map(([k, l]) =>
    '<button type="button" role="tab" data-adm-tab="' + k + '" aria-selected="' + (k === adminTab) + '">' + l +
    (k === 'members' && adminData.people ? ' <span class="view-count">' + adminData.people.members.length + '</span>' : '') + '</button>').join('') + '</div>';
  if (adminError) return head + '<section class="panel"><p>' + esc(adminError) + '</p><button class="secondary" data-adm-reload>Try again</button></section>';
  if (!adminData.overview) return head + '<section class="panel">' + srWait(['Loading members…', 'Adding up the numbers…', 'Nearly there…']) + '</section>';
  const body = {overview: admOverview, members: admMembers, invite: admInvite, activity: admActivity, settings: admSettings}[adminTab]();
  return head + '<div class="adm-body">' + body + '</div>';
}

function admOverview() {
  const o = adminData.overview;
  const tile = (label, value, note) => '<div class="metric"><span>' + label + '</span><strong>' + value + '</strong><small>' + note + '</small></div>';
  const max = Math.max(1, ...o.signups.map(d => d.count));
  const bars = o.signups.map((d, i) => '<rect x="' + (i * 10 + 1) + '" y="' + (60 - Math.round(d.count / max * 56)) + '" width="8" height="' + Math.max(1, Math.round(d.count / max * 56)) + '" rx="2"' + (d.count ? '' : ' class="zero"') + '><title>' + esc(dateGB(d.date)) + ': ' + d.count + '</title></rect>').join('');
  const people = adminData.people.members;
  const limit = Number(adminData.settings.free_limit);
  const list = (title, rows, why) => rows.length ? '<div class="adm-attn"><h3>' + title + ' <span class="view-count">' + rows.length + '</span></h3>' + rows.slice(0, 5).map(m =>
    '<button type="button" class="adm-row compact" data-adm-open="' + esc(m.userId || '') + '"' + (m.userId ? '' : ' disabled') + '><span class="adm-avatar">' + initial(m) + '</span><span class="adm-who"><b>' + esc(m.name) + '</b><small>' + esc(m.email) + '</small></span><small class="adm-why">' + esc(why(m)) + '</small></button>').join('') + '</div>' : '';
  return '<div class="metrics adm-kpis">' +
    tile('Members', o.members, o.new30 + ' joined in 30 days') + tile('Active this week', o.active7, o.active30 + ' in the last 30 days') +
    tile('Pro', o.pro, o.paid + ' paying · ' + o.comped + ' comped') + tile('Monthly revenue', '£' + o.mrr, 'From paid Pro plans') +
    tile('Stock tracked', o.items.toLocaleString('en-GB'), 'Items across all members') + tile('Sales recorded', gbp(o.revenue), 'By all members') +
    '</div>' +
    '<section class="panel"><div class="adm-panel-head"><h2>Sign-ups</h2><span class="footnote">Last 30 days · ' + o.new30 + ' total</span></div><svg class="adm-bars" viewBox="0 0 300 62" preserveAspectRatio="none" role="img" aria-label="Sign-ups per day">' + bars + '</svg></section>' +
    '<section class="panel"><h2>Needs attention</h2>' +
    (list('At the free limit', people.filter(m => m.plan === 'free' && m.status === 'active' && m.addedThisMonth >= limit), m => m.addedThisMonth + ' of ' + limit + ' items') +
     list('Signed up but never added stock', people.filter(m => !m.items && m.userId), m => 'Joined ' + ago(m.joined)) +
     list('Invited, not joined yet', people.filter(m => !m.userId), () => 'Waiting') +
     list('Suspended', people.filter(m => m.status === 'suspended'), () => 'No access') ||
     '<p class="footnote">Nothing needs you right now.</p>') + '</section>' +
    '<section class="panel"><div class="adm-panel-head"><h2>What people use</h2><span class="footnote">Last 7 days · screen opens, not people</span></div>' +
      (o.usage?.length ? '<div class="adm-usage">' + o.usage.map(u => { const max = o.usage[0].n || 1; return '<div><span>' + esc(String(u.feature).replace(/^tab:/, '').replace(/^use:/, '⚡ ')) + '</span><i><b class="w' + Math.max(1, Math.round(u.n / max * 10)) + '"></b></i><em>' + u.n + '</em></div>'; }).join('') + '</div>' : '<p class="footnote">Nothing yet.</p>') + '</section>' +
    '<section class="panel"><div class="adm-panel-head"><h2>Errors</h2><span class="footnote">Last 24 hours · server and phones</span></div>' +
      (o.errors?.count ? '<p><b class="err-count">' + o.errors.count + '</b> error' + (o.errors.count === 1 ? '' : 's') + '. You get an email if 10+ happen within an hour.</p><details class="adm-errors"><summary>Show latest</summary>' + o.errors.recent.slice(0, 15).map(e => '<div class="mini-stat"><span>' + esc(e.status + ' ' + e.path) + '<small>' + esc(e.message) + '</small></span><b>' + esc(ago(e.at)) + '</b></div>').join('') + '</details>'
        : '<p class="ai-status ok"><b>✓ No errors</b></p>') + '</section>' +
    '<section class="panel adm-status"><h2>App status</h2>' +
    '<div class="mini-stat"><span>Sign-ups</span><b>' + (adminData.settings.signups_open === '1' ? 'Open to anyone' : 'Invite-only') + '</b></div>' +
    '<div class="mini-stat"><span>Free plan</span><b>' + esc(adminData.settings.free_limit) + ' new items a month</b></div>' +
    '<div class="mini-stat"><span>Announcement</span><b>' + (adminData.settings.announcement_on === '1' && adminData.settings.announcement ? 'Showing' : 'Off') + '</b></div>' +
    '<button type="button" class="secondary" data-adm-tab="settings">Change app settings</button></section>';
}

function admFiltered() {
  const q = adminQuery.trim().toLowerCase(), limit = Number(adminData.settings.free_limit), day = 86400000;
  let rows = adminData.people.members.filter(m => !q || [m.name, m.email, m.username].some(v => (v || '').toLowerCase().includes(q)));
  const f = {
    pro: m => m.plan === 'pro', free: m => m.plan === 'free', comped: m => m.comped, suspended: m => m.status === 'suspended',
    inactive: m => !m.lastActive || Date.now() - Date.parse(m.lastActive) > 30 * day, limit: m => m.plan === 'free' && m.addedThisMonth >= limit, invited: m => !m.userId,
  }[adminFilter];
  if (f) rows = rows.filter(f);
  const by = {newest: (a, b) => (b.joined || '').localeCompare(a.joined || ''), active: (a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''),
    items: (a, b) => b.items - a.items, revenue: (a, b) => b.revenue - a.revenue, name: (a, b) => (a.name || '').localeCompare(b.name || '')}[adminSort];
  return rows.sort(by);
}
function admMembers() {
  const filters = [['all', 'All'], ['pro', 'Pro'], ['free', 'Free'], ['comped', 'Comped'], ['limit', 'At limit'], ['inactive', 'Inactive 30d'], ['invited', 'Invited'], ['suspended', 'Suspended']];
  const rows = admFiltered();
  return '<div class="adm-toolbar"><input type="search" id="admSearch" placeholder="Search name, email or username" value="' + esc(adminQuery) + '" aria-label="Search members">' +
    '<select id="admSort" aria-label="Sort members">' + [['newest', 'Newest'], ['active', 'Last active'], ['items', 'Most stock'], ['revenue', 'Most sales'], ['name', 'Name A–Z']].map(([k, l]) => '<option value="' + k + '"' + (k === adminSort ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
    '<button type="button" class="secondary" data-adm-csv>Export CSV</button></div>' +
    '<div class="stock-filters adm-filters" role="group" aria-label="Filter members">' + filters.map(([k, l]) => '<button type="button" data-adm-filter="' + k + '" aria-pressed="' + (k === adminFilter) + '">' + l + '</button>').join('') + '</div>' +
    '<section class="panel adm-list">' + (rows.length ? rows.map(m =>
      '<button type="button" class="adm-row" data-adm-open="' + esc(m.userId || '') + '"' + (m.userId ? '' : ' disabled title="Hasn’t signed in yet"') + '>' +
      '<span class="adm-avatar">' + initial(m) + '</span><span class="adm-who"><b>' + esc(m.name) + (m.username ? ' <i>@' + esc(m.username) + '</i>' : '') + '</b><small>' + esc(m.email) + '</small></span>' +
      '<span class="adm-meta"><small>' + m.items + ' items · ' + gbp(m.revenue) + '</small><small>' + (m.userId ? 'Active ' + ago(m.lastActive) : 'Invited ' + ago(m.joined)) + '</small></span>' + planBadge(m) + '</button>').join('')
      : '<p class="footnote">No members match.</p>') + '</section>';
}

function admInvite() {
  const open = adminData.settings.signups_open === '1';
  return '<section class="panel"><h2>Invite people</h2><p>Add one or more emails. They can sign in straight away with a code' + (open ? '' : ', even while sign-ups are invite-only') + '.</p>' +
    '<label>Email addresses<textarea id="admInviteEmails" rows="4" placeholder="sam@example.com, alex@example.com"></textarea></label>' +
    '<label class="adm-check"><input type="checkbox" id="admInviteSend" checked> Email them an invite with a link</label>' +
    '<button type="button" class="action" data-adm-invite>Send invites</button>' +
    (adminInviteResults ? '<ul class="adm-results">' + adminInviteResults.map(r => '<li><b>' + esc(r.email) + '</b><small>' + (r.existed ? 'Already a member' : 'Added') + (r.sent ? ' · invite emailed' : document.getElementById('admInviteSend')?.checked === false ? '' : ' · email not sent') + '</small></li>').join('') + '</ul>' : '') +
    '</section><p class="footnote">Sign-ups are currently <b>' + (open ? 'open to anyone' : 'invite-only') + '</b>. Change this in App settings.</p>';
}

function admActivity() {
  const q = adminActivityQuery.trim().toLowerCase();
  const rows = adminData.activity.events.filter(e => e.action !== 'workspace_save').filter(e => !q || [actionLabel(e.action), e.target, e.actor].some(v => (v || '').toLowerCase().includes(q)));
  return '<div class="adm-toolbar"><input type="search" id="admActivitySearch" placeholder="Filter by person or action" value="' + esc(adminActivityQuery) + '" aria-label="Filter activity"></div>' +
    '<section class="panel adm-list">' + (rows.length ? rows.map(e => '<div class="adm-event"><span class="adm-dot ' + (/suspend|delete/.test(e.action) ? 'bad' : /pro|invite|joined|reactiv/.test(e.action) ? 'good' : '') + '"></span><span class="adm-who"><b>' + esc(actionLabel(e.action)) + '</b><small>' + esc(e.target || '') + (e.actor && e.actor !== e.target ? ' · by ' + esc(e.actor) : '') + '</small></span><time>' + esc(ago(e.at)) + '</time></div>').join('') : '<p class="footnote">No activity matches.</p>') + '</section>';
}

let adminAi = null;
async function admLoadAi() { adminAi = {checking: true}; if (tab === 'Admin') render(); try { adminAi = await api('/api/admin/ai-status'); } catch (error) { adminAi = {ok: false, reason: error.message}; } if (tab === 'Admin') render(); }
function admAiCard() {
  const a = adminAi;
  const body = !a ? '<p>Check whether Pip is using Claude or the free model.</p>' : a.checking ? '<p>Checking with Anthropic…</p>'
    : '<p class="ai-status ' + (a.ok ? 'ok' : 'bad') + '"><b>' + (a.ok ? '✓ Claude connected' : '✕ Not using Claude') + '</b>' + (a.model ? ' · ' + esc(a.model) : '') + '</p><p class="footnote">' + esc(a.reason) + '</p>';
  return '<section class="panel"><h2>Pip’s AI</h2>' + body + '<button type="button" class="secondary" data-adm-ai>' + (a ? 'Check again' : 'Check connection') + '</button></section>';
}
let adminBilling = null;
async function admSetupBilling() { adminBilling = {checking: true}; if (tab === 'Admin') render(); try { adminBilling = await api('/api/billing/setup', {method: 'POST', body: '{}'}); } catch (error) { adminBilling = {ok: false, reason: error.message}; } if (tab === 'Admin') render(); }
function admBillingCard() {
  const b = adminBilling;
  const body = !b ? '<p>Creates the Pro plan in Stripe (£7 a month, £60 a year) if it isn’t there yet, and checks your Stripe key works.</p>' : b.checking ? '<p>Talking to Stripe…</p>'
    : b.ok ? '<p class="ai-status ok"><b>✓ Stripe ready</b> · ' + (b.live ? 'live mode' : 'TEST mode') + '</p><p class="footnote">Product ' + esc(b.product) + '</p>'
    : '<p class="ai-status bad"><b>✕ Stripe not working</b></p><p class="footnote">' + esc(b.reason) + '</p>';
  return '<section class="panel"><h2>Billing</h2>' + body + '<button type="button" class="secondary" data-adm-billing>' + (b ? 'Check again' : 'Set up billing') + '</button></section>';
}
function admSettings() {
  const s = adminData.settings;
  return admAiCard() + admBillingCard() + '<section class="panel"><h2>Sign-ups</h2>' +
    '<label class="adm-switch"><input type="checkbox" id="admSignups"' + (s.signups_open === '1' ? ' checked' : '') + '><span></span><div><b>Anyone can sign up</b><small>Turn off for invite-only. Existing members can always sign in.</small></div></label></section>' +
    '<section class="panel"><h2>Gmail beta</h2><label>Spaces for Gmail auto-updates<input type="number" id="admGmailCap" min="0" max="100000" step="1" inputmode="numeric" value="' + esc(s.gmail_cap) + '"></label><p class="footnote">Google allows 100 people to connect an unverified app. Keep this below 100 until Google verifies Stockroom.</p></section>' +
    '<section class="panel"><h2>Company details</h2><p>Shown on the Privacy policy and Terms.</p><label>Company number<input id="admCompanyNumber" maxlength="12" value="' + esc(s.company_number) + '" placeholder="e.g. 12345678"></label><label>Registered office address<input id="admCompanyAddress" maxlength="200" value="' + esc(s.company_address) + '" placeholder="Street, town, postcode"></label></section>' +
    '<section class="panel"><h2>Free plan</h2><label>New items per month on Free<input type="number" id="admFreeLimit" min="0" max="10000" step="1" inputmode="numeric" value="' + esc(s.free_limit) + '"></label><p class="footnote">Pro is always unlimited. Changes apply immediately.</p></section>' +
    '<section class="panel"><h2>Announcement banner</h2><p>Shows at the top of the app for every member. Good for updates, new features or downtime.</p>' +
    '<label>Message<textarea id="admAnnouncement" rows="3" maxlength="280" placeholder="e.g. New: Pip can now write your Vinted listings.">' + esc(s.announcement) + '</textarea></label>' +
    '<label>Style<select id="admTone">' + [['info', 'Info (violet)'], ['success', 'Good news (green)'], ['warning', 'Warning (amber)']].map(([k, l]) => '<option value="' + k + '"' + (k === s.announcement_tone ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
    '<label class="adm-switch"><input type="checkbox" id="admAnnounceOn"' + (s.announcement_on === '1' ? ' checked' : '') + '><span></span><div><b>Show the banner</b><small>Members can dismiss it. A new message shows again.</small></div></label>' +
    '</section><button type="button" class="action" data-adm-save-settings>Save app settings</button>';
}

// ---------- Member profile sheet ----------
function admSheet() {
  let dialog = document.getElementById('admMemberDialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'admMemberDialog';
    dialog.className = 'utility-dialog adm-dialog';
    document.body.append(dialog);
  }
  return dialog;
}
function admMemberHtml(d) {
  const m = d.member, limit = Number(adminData.settings?.free_limit || 20);
  const row = (label, value) => '<div class="mini-stat"><span>' + label + '</span><b>' + value + '</b></div>';
  const plan = m.plan === 'pro' ? (m.paid ? 'Pro · paying' : 'Pro · comped') + (m.planUntil ? ' until ' + dateGB(m.planUntil) : ' · forever') : 'Free · ' + m.addedThisMonth + ' of ' + limit + ' items this month';
  return '<div class="sheet-heading"><div class="adm-sheet-who"><span class="adm-avatar big">' + initial(m) + '</span><div><h2>' + esc(m.name) + '</h2><small>' + esc(m.email) + (m.username ? ' · @' + esc(m.username) : '') + '</small><div>' + planBadge(m) + '</div></div></div><button type="button" class="close-panel" data-close-dialog="admMemberDialog" aria-label="Close">×</button></div>' +
    '<div class="metrics adm-mini"><div class="metric"><span>Stock</span><strong>' + m.items + '</strong><small>' + m.sold + ' sold</small></div><div class="metric"><span>Sales</span><strong>' + gbp(m.revenue) + '</strong><small>Recorded</small></div><div class="metric"><span>Last active</span><strong>' + esc(ago(m.lastActive)) + '</strong><small>Joined ' + esc(dateGB(m.joined)) + '</small></div></div>' +
    '<section class="adm-sec"><h3>Plan</h3>' + row('Current plan', esc(plan)) +
      (d.stripeUrl ? '<a class="link" href="' + esc(d.stripeUrl) + '" target="_blank" rel="noopener">Open in Stripe ↗</a>' : '') +
      (m.paid ? '' : '<div class="adm-inline"><select id="admGrantMonths" aria-label="How long"><option value="1">1 month</option><option value="3">3 months</option><option value="6">6 months</option><option value="12" selected>12 months</option><option value="">Forever</option></select><button type="button" class="secondary" data-adm-act="grant_pro">Give Pro free</button>' +
      (m.comped ? '<button type="button" class="secondary" data-adm-act="remove_pro">Remove Pro</button>' : '') + '</div>') +
      (m.plan === 'free' ? '<button type="button" class="secondary" data-adm-act="reset_allowance">Reset this month’s allowance</button>' : '') + '</section>' +
    '<section class="adm-sec"><h3>Access</h3>' + row('Status', m.status === 'active' ? 'Active' : 'Suspended') + row('Signed in on', d.sessions.length + (d.sessions.length === 1 ? ' device' : ' devices')) + row('Passkeys', d.passkeys.length) + row('Gmail auto-updates', m.gmail ? 'Connected' : 'Not connected') +
      (d.sessions.length ? '<ul class="adm-devices">' + d.sessions.map(s => '<li><b>' + esc(admDevice(s.device)) + '</b><small>Signed in ' + esc(ago(new Date(s.created_at).toISOString())) + '</small></li>').join('') + '</ul>' : '') +
      '<div class="adm-inline"><button type="button" class="secondary" data-adm-view>View their workspace</button><button type="button" class="secondary" data-adm-export>Export their data</button>' +
      (d.sessions.length ? '<button type="button" class="secondary" data-adm-act="signout">Sign out everywhere</button>' : '') +
      '<button type="button" class="secondary ' + (m.status === 'active' ? 'stock-delete' : '') + '" data-adm-act="' + (m.status === 'active' ? 'suspend' : 'reactivate') + '">' + (m.status === 'active' ? 'Suspend access' : 'Reactivate') + '</button></div></section>' +
    '<section class="adm-sec"><h3>Details</h3><label>Display name<div class="adm-inline"><input id="admRename" value="' + esc(m.name) + '" maxlength="100"><button type="button" class="secondary" data-adm-act="rename">Save</button></div></label>' +
      '<label>Private note<textarea id="admNote" rows="3" maxlength="4000" placeholder="Only you can see this">' + esc(d.note) + '</textarea></label><button type="button" class="secondary" data-adm-act="note">Save note</button>' + (d.noteUpdated ? '<small class="footnote"> Updated ' + esc(ago(d.noteUpdated)) + '</small>' : '') + '</section>' +
    '<section class="adm-sec"><h3>History</h3>' + (d.events.filter(e => e.action !== 'workspace_save').slice(0, 12).map(e => row(esc(actionLabel(e.action)), esc(ago(e.created_at)))).join('') || '<p class="footnote">Nothing yet.</p>') + '</section>' +
    '<section class="adm-sec adm-danger"><h3>Delete account</h3><p>Removes their stock, sales, photos, sign-ins and profile for good. Type <b>' + esc(m.email) + '</b> to confirm.</p><div class="adm-inline"><input id="admDeleteConfirm" placeholder="' + esc(m.email) + '" autocomplete="off"><button type="button" class="secondary stock-delete" data-adm-act="delete">Delete forever</button></div></section>';
}
const admDevice = ua => !ua ? 'Unknown device' : /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Browser';

async function admOpen(id) {
  const dialog = admSheet();
  dialog.innerHTML = srWait('Opening…', {small: true, ghost: false});
  if (!dialog.open) dialog.showModal();
  try { adminMember = await api('/api/admin/people/' + encodeURIComponent(id)); dialog.innerHTML = admMemberHtml(adminMember); }
  catch (error) { dialog.innerHTML = '<p>' + esc(error.message) + '</p><button class="secondary" data-close-dialog="admMemberDialog">Close</button>'; }
}

async function admAct(action, button) {
  const m = adminMember?.member; if (!m) return;
  const body = {action};
  if (action === 'suspend' && !confirm('Suspend ' + m.email + '? They’re signed out now and can’t get back in. Their data is kept.')) return;
  if (action === 'signout' && !confirm('Sign ' + m.email + ' out on every device?')) return;
  if (action === 'remove_pro' && !confirm('Move ' + m.email + ' back to Free?')) return;
  if (action === 'grant_pro') { const v = document.getElementById('admGrantMonths').value; body.months = v ? Number(v) : null; }
  if (action === 'rename') body.name = document.getElementById('admRename').value;
  if (action === 'note') body.note = document.getElementById('admNote').value;
  if (action === 'delete') { body.confirm = document.getElementById('admDeleteConfirm').value; if (!confirm('Delete ' + m.email + ' and all their data forever? This can’t be undone.')) return; }
  button.disabled = true;
  try {
    const result = await api('/api/admin/people/' + encodeURIComponent(m.userId) + '/action', {method: 'POST', body: JSON.stringify(body)});
    toast({suspend: 'Access suspended.', reactivate: 'Access restored.', signout: 'Signed out everywhere.', grant_pro: 'Pro granted.', remove_pro: 'Moved to Free.', reset_allowance: 'Allowance reset.', rename: 'Name saved.', note: 'Note saved.', delete: 'Account deleted.'}[action] || 'Done.');
    await loadAdmin(); if (tab === 'Admin') render();
    if (result.deleted) { admSheet().close(); return; }
    await admOpen(m.userId);
  } catch (error) { toast(error.message); button.disabled = false; }
}

function admCsv() {
  exportCsv('Stockroom members - ' + todayUK(), [
    {label: 'Name', get: m => m.name}, {label: 'Email', get: m => m.email}, {label: 'Username', get: m => m.username}, {label: 'Status', get: m => m.status},
    {label: 'Plan', get: m => m.plan}, {label: 'Paying', get: m => m.paid ? 'Yes' : 'No'}, {label: 'Plan until', type: 'date', get: m => m.planUntil},
    {label: 'Joined', type: 'date', get: m => m.joined}, {label: 'Last active', type: 'date', get: m => m.lastActive},
    {label: 'Items', type: 'number', get: m => m.items}, {label: 'Sold', type: 'number', get: m => m.sold}, {label: 'Sales (GBP)', type: 'money', get: m => m.revenue},
    {label: 'Added this month', type: 'number', get: m => m.addedThisMonth},
  ], admFiltered());
}

document.addEventListener('click', async event => {
  const t = event.target;
  const tabBtn = t.closest('[data-adm-tab]');
  if (tabBtn) { adminTab = tabBtn.dataset.admTab; render(); return; }
  if (t.closest('[data-adm-reload]')) { await loadAdmin(); render(); return; }
  if (t.closest('[data-adm-ai]')) { await admLoadAi(); return; }
  if (t.closest('[data-adm-billing]')) { await admSetupBilling(); return; }
  const filter = t.closest('[data-adm-filter]');
  if (filter) { adminFilter = filter.dataset.admFilter; render(); return; }
  const open = t.closest('[data-adm-open]');
  if (open && open.dataset.admOpen) { await admOpen(open.dataset.admOpen); return; }
  const act = t.closest('[data-adm-act]');
  if (act) { await admAct(act.dataset.admAct, act); return; }
  if (t.closest('[data-adm-csv]')) { admCsv(); return; }
  if (t.closest('[data-adm-view]') && adminMember) { admSheet().close(); await switchWorkspace(adminMember.member.userId).catch(e => toast(e.message)); return; }
  if (t.closest('[data-adm-export]') && adminMember) {
    try { const {data} = await api('/api/admin/people/' + encodeURIComponent(adminMember.member.userId) + '/export'); downloadJSON(data || {}, 'stockroom-' + adminMember.member.email.replace(/[^a-z0-9]+/gi, '-') + '.json'); } catch (error) { toast(error.message); }
    return;
  }
  if (t.closest('[data-adm-invite]')) {
    const button = t.closest('[data-adm-invite]'); button.disabled = true;
    try {
      const {results} = await api('/api/admin/invite', {method: 'POST', body: JSON.stringify({emails: document.getElementById('admInviteEmails').value, send: document.getElementById('admInviteSend').checked})});
      adminInviteResults = results; toast(results.length + (results.length === 1 ? ' person' : ' people') + ' invited.'); await loadAdmin(); render();
    } catch (error) { toast(error.message); button.disabled = false; }
    return;
  }
  if (t.closest('[data-adm-save-settings]')) {
    const button = t.closest('[data-adm-save-settings]'); button.disabled = true;
    try {
      const {settings} = await api('/api/admin/settings', {method: 'PUT', body: JSON.stringify({
        signups_open: document.getElementById('admSignups').checked, free_limit: Number(document.getElementById('admFreeLimit').value),
        announcement: document.getElementById('admAnnouncement').value, announcement_tone: document.getElementById('admTone').value, announcement_on: document.getElementById('admAnnounceOn').checked,
        gmail_cap: Number(document.getElementById('admGmailCap').value), company_number: document.getElementById('admCompanyNumber').value, company_address: document.getElementById('admCompanyAddress').value})});
      adminData.settings = settings; account.announcement = settings.announcement_on === '1' && settings.announcement ? {text: settings.announcement, tone: settings.announcement_tone} : null;
      toast('App settings saved.'); await loadAdmin(); render();
    } catch (error) { toast(error.message); button.disabled = false; }
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'admSearch') { adminQuery = event.target.value; const list = document.querySelector('.adm-list'); if (list) { const pos = event.target.selectionStart; render(); const box = document.getElementById('admSearch'); box?.focus(); box?.setSelectionRange(pos, pos); } }
  if (event.target.id === 'admActivitySearch') { adminActivityQuery = event.target.value; const pos = event.target.selectionStart; render(); const box = document.getElementById('admActivitySearch'); box?.focus(); box?.setSelectionRange(pos, pos); }
});
document.addEventListener('change', event => { if (event.target.id === 'admSort') { adminSort = event.target.value; render(); } });

