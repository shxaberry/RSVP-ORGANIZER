// ═══════════════════════════════════════════════
//  helpers.js — UI utilities, auth forms, modals,
//               toast, alerts, confirm-delete
// ═══════════════════════════════════════════════

// ── Screen navigation ────────────────────────────
function goTo(screenId) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  var el = document.getElementById(screenId);
  if (el) el.classList.add('active');
}

// ── Toast notifications ──────────────────────────
var _toastTimer = null;
function toast(msg, type) {
  var existing = document.getElementById('app-toast');
  if (existing) existing.remove();
  if (_toastTimer) clearTimeout(_toastTimer);

  var el = document.createElement('div');
  el.id = 'app-toast';
  el.className = 'toast toast-' + (type || 'success');
  el.textContent = msg;
  document.body.appendChild(el);

  requestAnimationFrame(function() {
    requestAnimationFrame(function() { el.classList.add('show'); });
  });

  _toastTimer = setTimeout(function() {
    el.classList.remove('show');
    setTimeout(function() { if (el.parentNode) el.remove(); }, 300);
  }, 3500);
}

var showToast = toast;

// ── Alert helpers ────────────────────────────────
function showAlert(id, msg) {
  var el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}

function hideAlert(id) {
  var el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;
  el.textContent = '';
  el.classList.remove('show');
}

// ── Field error helpers ──────────────────────────
function clearErrors(form) {
  form.querySelectorAll('.field-error').forEach(function(e) {
    e.textContent = '';
    e.classList.remove('show');
  });
  form.querySelectorAll('.is-error').forEach(function(e) { e.classList.remove('is-error'); });
}

function showFieldErrors(form, errors) {
  errors.forEach(function(err) {
    var field = form.querySelector('[name="' + err.field + '"]');
    if (field) field.classList.add('is-error');
    var errEl = form.querySelector('#' + err.field.replace(/_/g, '-') + '-err') ||
                form.querySelector('[data-error="' + err.field + '"]');
    if (errEl) showAlert(errEl.id || errEl, err.message);
  });
}

// ── Loading state for buttons ────────────────────
function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.dataset.origText = btn.textContent;
    btn.textContent = '...';
    btn.disabled = true;
    btn.classList.add('loading');
  } else {
    btn.textContent = btn.dataset.origText || btn.textContent;
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

// ── Modal helpers ────────────────────────────────
function openModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

document.addEventListener('click', function(e) {
  if (e.target.classList.contains('modal-backdrop')) {
    e.target.classList.remove('open');
  }
});

// ── Confirm delete ───────────────────────────────
function confirmDeleteItem(id, type, label) {
  pendingDeleteId   = id;
  pendingDeleteType = type;
  var msgEl = document.getElementById('confirm-msg');
  if (msgEl) msgEl.textContent = 'Delete ' + type + ' ' + label + '? This cannot be undone.';
  openModal('modal-confirm');
}

async function confirmDelete() {
  if (!pendingDeleteId || !pendingDeleteType) return;
  var id   = pendingDeleteId;
  var type = pendingDeleteType;
  pendingDeleteId   = null;
  pendingDeleteType = null;
  closeModal('modal-confirm');

  var endpoint = type === 'event' ? '/api/events/' + id
               : type === 'rsvp'  ? '/api/rsvps/'  + id
               : type === 'user'  ? '/api/admin/users/' + id
               : null;

  if (!endpoint) return;

  var d = await api('DELETE', endpoint);
  if (d.success) {
    // Audit the deletion
    var auditAction = type === 'event' ? 'DELETE_EVENT'
                    : type === 'rsvp'  ? 'DELETE_RSVP'
                    : 'DELETE_USER';
    appendAudit(auditAction, type + ' #' + id + ' deleted');

    toast('Deleted successfully.');
    await loadAll();
    if (type === 'event') {
      if (currentSection === 'events') renderEvents();
      else renderOverview();
    } else if (type === 'rsvp') {
      if (currentSection === 'rsvps')       renderRSVPs();
      else if (currentSection === 'guests') renderGuests();
      else renderOverview();
    } else if (type === 'user') {
      loadAdminUsers();
      loadUserActivity();
    }
  } else {
    toast(d.message || 'Delete failed.', 'error');
  }
}

// ── Portal link helper ───────────────────────────
function portalLink(token) {
  return window.location.origin + '/rsvp?token=' +
encodeURIComponent(token);
}

// ── Copy to clipboard ────────────────────────────
function copyToClipboard(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0;';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    var ok = document.execCommand('copy');
    toast(ok ? 'Link copied!' : 'Copy failed.', ok ? 'success' : 'error');
  } catch(e) {
    toast('Copy failed: ' + e.message, 'error');
  }
  document.body.removeChild(ta);
}
// ── HTML escape ──────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Status badge ─────────────────────────────────
function statusBadge(status, waitlisted) {
  if (waitlisted == 1 || waitlisted === true) {
    return '<span class="badge badge-waitlisted">WAITLISTED</span>';
  }
  var map = {
    attending: '<span class="badge badge-attending">ATTENDING</span>',
    declined:  '<span class="badge badge-declined">DECLINED</span>',
    pending:   '<span class="badge badge-pending">PENDING</span>',
  };
  return map[status] || '<span class="badge badge-pending">' + esc(status) + '</span>';
}

// ── Populate event <select> ──────────────────────
function populateEventSelect() {
  var sel = document.getElementById('rsvp-event-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select Event —</option>' +
    allEvents.map(function(ev) {
      return '<option value="' + ev.id + '">' + esc(ev.name) + '</option>';
    }).join('');
}

// ── Nav badges ───────────────────────────────────
function updateNavBadges() {
  var pending = allRSVPs.filter(function(r) { return r.status === 'pending'; }).length;
  var nb = document.getElementById('nb-rsvps');
  if (nb) {
    nb.textContent = pending;
    nb.style.display = pending > 0 ? '' : 'none';
  }
}

// ── Toggle password eye ──────────────────────────
function toggleEye(inputId, btn) {
  var input = document.getElementById(inputId);
  if (!input) return;
  var isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  var icon = btn.querySelector('svg');
  if (icon) {
    if (isHidden) {
      icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
    } else {
      icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
  }
}

// ── Login attempt dots ───────────────────────────
var loginAttempts = 0;

function updateAttemptDots() {
  var attemptsEl = document.getElementById('li-attempts');
  if (attemptsEl) {
    attemptsEl.classList.toggle('show', loginAttempts > 0);
  }
  for (var i = 1; i <= 3; i++) {
    var dot = document.getElementById('li-d' + i);
    if (dot) dot.classList.toggle('used', i > loginAttempts);
  }
}

// ── Login ────────────────────────────────────────
async function doLogin() {
  hideAlert('li-alert');
  hideAlert('li-success');
  var email = document.getElementById('li-email').value.trim();
  var pass  = document.getElementById('li-pass').value;

  if (!email) { showAlert('li-alert', 'Email is required.'); return; }
  if (!pass)  { showAlert('li-alert', 'Password is required.'); return; }

  var d = await api('POST', '/api/auth/login', { email: email, password: pass });

  if (!d.success) {
    loginAttempts = Math.min(loginAttempts + 1, 3);
    updateAttemptDots();
    showAlert('li-alert', d.message || 'Invalid credentials.');
    return;
  }

  loginAttempts = 0;
  updateAttemptDots();
  document.getElementById('li-email').value = '';
  document.getElementById('li-pass').value  = '';
  enterDashboard(d.user);
}

// ── Register ─────────────────────────────────────
async function doRegister() {
  hideAlert('su-alert');
  ['su-fname-err','su-email-err','su-pass-err','su-pass2-err'].forEach(hideAlert);

  var fname = document.getElementById('su-fname').value.trim();
  var email = document.getElementById('su-email').value.trim();
  var pass  = document.getElementById('su-pass').value;
  var pass2 = document.getElementById('su-pass2').value;

  var ok = true;
  if (!fname) { showAlert('su-fname-err', 'Full name is required.'); ok = false; }
  if (!email) { showAlert('su-email-err', 'Email is required.');     ok = false; }
  if (!pass)  { showAlert('su-pass-err',  'Password is required.');  ok = false; }
  if (pass && pass !== pass2) { showAlert('su-pass2-err', 'Passwords do not match.'); ok = false; }
  if (!ok) return;

  var d = await api('POST', '/api/auth/register', {
    full_name:        fname,
    email:            email,
    password:         pass,
    confirm_password: pass2
  });

  if (!d.success) {
    if (d.errors && d.errors.length) {
      d.errors.forEach(function(err) {
        var fieldId = 'su-' + err.field.replace(/_/g, '-') + '-err';
        var el = document.getElementById(fieldId) || document.getElementById('su-alert');
        if (el) showAlert(el.id, err.message);
      });
    } else {
      showAlert('su-alert', d.message || 'Registration failed.');
    }
    return;
  }

  showAlert('li-success', 'Account created! Please log in.');
  goTo('screen-login');
}

// ── Logout ───────────────────────────────────────
async function doLogout() {
  appendAudit('LOGOUT', (currentUser ? currentUser.full_name : 'User') + ' logged out');

  // Stop real-time polling
  stopAdminPolling();

  await api('POST', '/api/auth/logout');
  currentUser    = null;
  allEvents      = [];
  allRSVPs       = [];
  auditLog       = [];
  currentSection = 'overview';

  document.getElementById('app-layout').classList.remove('active');
  document.getElementById('auth-topbar').style.display = '';
  document.getElementById('app-footer').style.display  = '';
  goTo('screen-login');

  document.getElementById('li-email').value = '';
  document.getElementById('li-pass').value  = '';
  loginAttempts = 0;
  updateAttemptDots();
}

// Allow Enter key to submit auth forms
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  var active = document.querySelector('.screen.active');
  if (!active) return;
  if (active.id === 'screen-login')  doLogin();
  if (active.id === 'screen-signup') doRegister();
});

document.addEventListener('mousedown', function(e) {
  var btn = e.target.closest('.copy-link-btn');
  if (!btn) return;
  e.preventDefault();
  var link = btn.getAttribute('data-link');
  copyToClipboard(link);
});