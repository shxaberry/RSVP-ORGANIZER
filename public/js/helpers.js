// ═══════════════════════════════════════════════
//  helpers.js — Shared utility functions
// ═══════════════════════════════════════════════

function fmtDate(s) {
  if (!s) return '—';
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  } catch { return s; }
}

function fmtDate2(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts * 1000).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  } catch { return '—'; }
}

function badgeHTML(s) {
  const map = {
    attending:  'badge-attending',
    declined:   'badge-declined',
    pending:    'badge-pending',
    upcoming:   'badge-upcoming',
    completed:  'badge-completed',
    waitlisted: 'badge-waitlisted'
  };
  return `<span class="badge ${map[s] || 'badge-pending'}">${s.toUpperCase()}</span>`;
}

function escapeHtml(str) {
  return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}