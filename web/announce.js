'use strict';
// ---------- Announcement banner for every member ----------
function announcementBar() {
  const a = account?.announcement;
  if (!a?.text) return '';
  let hidden = ''; try { hidden = localStorage.getItem('stockroom-announcement-hidden') || ''; } catch {}
  if (hidden === a.text) return '';
  return '<div class="announce ' + esc(a.tone || 'info') + '" role="status"><img src="/icon.svg" alt="" width="22" height="22"><p>' + esc(a.text) + '</p><button type="button" class="announce-x" data-announce-hide aria-label="Dismiss">×</button></div>';
}
document.addEventListener('click', event => {
  if (!event.target.closest('[data-announce-hide]')) return;
  try { localStorage.setItem('stockroom-announcement-hidden', account.announcement.text); } catch {}
  event.target.closest('.announce')?.remove();
});
