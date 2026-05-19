// ═══════════════════════════════════════════════
//  state.js — Global state + API helper
// ═══════════════════════════════════════════════

var currentUser    = null;
var currentSection = 'overview';
var allEvents      = [];
var allRSVPs       = [];
var pendingDeleteId   = null;
var pendingDeleteType = null;

// ── Audit log (client-side, session-scoped) ───────
var auditLog = [];

function appendAudit(action, detail) {
  auditLog.unshift({
    ts:     Date.now(),
    action: action,
    user:   currentUser ? currentUser.full_name : 'Unknown',
    role:   currentUser ? (currentUser.role === 1 ? 'ADMIN' : 'ORGANIZER') : '—',
    detail: detail || ''
  });
  if (auditLog.length > 200) auditLog.length = 200;
  if (currentSection === 'admin-audit') renderAuditLog();
  var nb = document.getElementById('nb-audit');
  if (nb) {
    nb.textContent = auditLog.length;
    nb.style.display = auditLog.length > 0 ? '' : 'none';
  }
}

// ── API helper ───────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: {}
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    const res  = await fetch(path, opts);
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('API error', method, path, err);
    return { success: false, message: 'Network error. Is the server running?' };
  }
}

// ── Real-time polling (admin only) ───────────────
var _pollInterval   = null;
var _lastEventCount = 0;
var _lastRSVPCount  = 0;

function startAdminPolling() {
  if (_pollInterval) return;
  _lastEventCount = allEvents.length;
  _lastRSVPCount  = allRSVPs.length;

  _pollInterval = setInterval(async function() {
    if (!currentUser || currentUser.role !== 1) { stopAdminPolling(); return; }

    var dE = await api('GET', '/api/events');
    var dR = await api('GET', '/api/rsvps');

    var newEvents = dE.success ? (dE.events || []) : allEvents;
    var newRSVPs  = dR.success ? (dR.rsvps  || []) : allRSVPs;
    var changed   = newEvents.length !== _lastEventCount || newRSVPs.length !== _lastRSVPCount;

    _lastEventCount = newEvents.length;
    _lastRSVPCount  = newRSVPs.length;

    if (changed) {
      allEvents = newEvents;
      allRSVPs  = newRSVPs;
      appendAudit('POLL_UPDATE', 'Real-time update: ' + newEvents.length + ' events, ' + newRSVPs.length + ' RSVPs detected');
      toast('\u27F3 New data detected \u2014 dashboard refreshed.', 'success');
      if (currentSection === 'admin-overview')  loadAdminOverview();
      if (currentSection === 'admin-activity')  loadUserActivity();
      if (currentSection === 'admin-sessions')  loadAdminSessions();
      if (currentSection === 'admin-users')   { loadAdminUsers(); loadUserActivity(); }
      // always keep overview numbers updated in background
      if (currentSection !== 'admin-overview') loadAdminOverview();
    }
  }, 10000);
}

function stopAdminPolling() {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
}