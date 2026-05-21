// ═══════════════════════════════════════════════
//  state.js — Global state + API helper
// ═══════════════════════════════════════════════

var currentUser    = null;
var currentSection = 'overview';
var allEvents      = [];
var allRSVPs       = [];
var pendingDeleteId   = null;
var pendingDeleteType = null;

// ── Audit log (persistent via localStorage — survives logout) ──
var AUDIT_KEY = 'rsvp_audit_log';
var auditLog  = (function() {
  try { return JSON.parse(localStorage.getItem(AUDIT_KEY)) || []; } catch(e) { return []; }
})();

function _saveAudit() {
  try { localStorage.setItem(AUDIT_KEY, JSON.stringify(auditLog)); } catch(e) {}
}

// overrideUser / overrideRole let logout capture the user before currentUser is cleared
function appendAudit(action, detail, overrideUser, overrideRole) {
  auditLog.unshift({
    ts:     Date.now(),
    action: action,
    user:   overrideUser || (currentUser ? currentUser.full_name : 'System'),
    role:   overrideRole || (currentUser ? (currentUser.role === 1 ? 'ADMIN' : 'ORGANIZER') : '—'),
    detail: detail || ''
  });
  if (auditLog.length > 500) auditLog.length = 500;
  _saveAudit();
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
      if (currentSection !== 'admin-overview') loadAdminOverview();
    }
  }, 10000);
}

function stopAdminPolling() {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
}