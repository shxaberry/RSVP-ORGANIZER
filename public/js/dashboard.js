// ── Dashboard entry ─────────────────────────────
function enterDashboard(user) {
  currentUser = user;
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById('auth-topbar').style.display = 'none';
  document.getElementById('app-footer').style.display  = 'none';
  document.getElementById('app-layout').classList.add('active');

  var initials = user.full_name.trim().split(/\s+/).map(function(w) { return w[0].toUpperCase(); }).slice(0, 2).join('');

  document.getElementById('sb-avatar').textContent = initials;
  document.getElementById('sb-name').textContent   = user.full_name;

  var profAvatar = document.getElementById('prof-avatar');
  if (profAvatar) profAvatar.textContent = initials;
  var profName = document.getElementById('prof-name');
  if (profName) profName.textContent = user.full_name;
  var profEmail = document.getElementById('prof-email');
  if (profEmail) profEmail.textContent = user.email;
  var profFullName = document.getElementById('prof-full-name');
  if (profFullName) profFullName.textContent = user.full_name;
  var profEmailVal = document.getElementById('prof-email-val');
  if (profEmailVal) profEmailVal.textContent = user.email;

  var uidText   = '#' + (user.id || '—');
  var profId    = document.getElementById('prof-id');
  var profIdVal = document.getElementById('prof-id-val');
  if (profId)    profId.textContent    = uidText;
  if (profIdVal) profIdVal.textContent = uidText;

  var since = user.created_at
    ? new Date(user.created_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';
  var profSince  = document.getElementById('prof-since');
  var profJoined = document.getElementById('prof-joined');
  if (profSince)  profSince.textContent  = since;
  if (profJoined) profJoined.textContent = 'Joined ' + since;

  var isAdmin   = user.role === 1;
  var roleLabel = isAdmin ? 'ADMINISTRATOR' : 'EVENT MANAGER';

  document.getElementById('nav-organizer-group').style.display = isAdmin ? 'none'  : 'block';
  document.getElementById('nav-admin-group').style.display     = isAdmin ? 'block' : 'none';

  var sbRole = document.getElementById('sb-role');
  if (sbRole) sbRole.textContent = roleLabel;

  var profRoleText = document.getElementById('prof-role-text');
  if (profRoleText) profRoleText.textContent = roleLabel;

  var profRoleBadgeText = document.getElementById('prof-role-badge-text');
  if (profRoleBadgeText) profRoleBadgeText.textContent = roleLabel;

  var accessLevel = document.getElementById('prof-access-level');
  var permRow     = document.getElementById('prof-permissions-row');
  var badge       = document.getElementById('prof-role-badge');
  var pill        = document.getElementById('prof-role');
  if (isAdmin) {
    if (accessLevel) accessLevel.style.display = 'flex';
    if (permRow)     permRow.style.display      = '';
    if (badge)       badge.classList.add('admin-badge');
    if (pill)        pill.classList.add('admin');
  } else {
    if (accessLevel) accessLevel.style.display = 'none';
    if (permRow)     permRow.style.display      = 'none';
    if (badge)       badge.classList.remove('admin-badge');
    if (pill)        pill.classList.remove('admin');
  }

  currentSection = isAdmin ? 'admin-overview' : 'overview';

  // Audit: log login
  appendAudit('LOGIN', user.full_name + ' logged in as ' + (isAdmin ? 'Admin' : 'Organizer'));

  loadAll();

  // Start real-time polling for admin
  if (isAdmin) startAdminPolling();
}

// ── Data fetching ────────────────────────────────
async function loadAll() {
  await Promise.all([loadEvents(), loadRSVPs()]);
  refreshStats();
  updateNavBadges();
  showSection(currentSection);
}

async function loadEvents() {
  var d = await api('GET', '/api/events');
  if (d.success) allEvents = d.events || [];
}

async function loadRSVPs() {
  var d = await api('GET', '/api/rsvps');
  if (d.success) allRSVPs = d.rsvps || [];
}

// ── Section metadata ─────────────────────────────
var sectionMeta = {
  overview:         { title: 'OVERVIEW',        sub: '/ Dashboard',       action: 'NEW EVENT', email: false, admin: false },
  events:           { title: 'EVENTS',          sub: '/ All Events',      action: 'NEW EVENT', email: false, admin: false },
  rsvps:            { title: 'RSVPs',           sub: '/ Responses',       action: 'ADD RSVP',  email: true,  admin: false },
  guests:           { title: 'GUESTS',          sub: '/ Guest List',      action: 'ADD RSVP',  email: false, admin: false },
  profile:          { title: 'PROFILE',         sub: '/ Account',         action: null,        email: false, admin: false },
  'admin-users':    { title: 'MANAGE USERS',    sub: '/ User Control',    action: null,        email: false, admin: true  },
  'admin-overview': { title: 'ADMIN OVERVIEW',  sub: '/ Dashboard',       action: null,        email: false, admin: true  },
  'admin-sessions': { title: 'ACTIVE SESSIONS', sub: '/ Who Is Online',   action: null,        email: false, admin: true  },
  'admin-activity': { title: 'ACTIVITY',        sub: '/ Organizer Stats', action: null,        email: false, admin: true  },
  'admin-emails':   { title: 'EMAIL LOG',       sub: '/ All Emails',      action: null,        email: false, admin: true  },
  'admin-audit':    { title: 'AUDIT LOG',       sub: '/ Action History',  action: null,        email: false, admin: true  },
};

function showSection(name) {
  var meta = sectionMeta[name];
  if (!meta) return;
  if (meta.admin && (!currentUser || currentUser.role !== 1)) {
    showSection('overview');
    return;
  }

  currentSection = name;
  document.querySelectorAll('.nav-item').forEach(function(el) { el.classList.remove('active'); });
  var navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');

  document.querySelectorAll('.section-page').forEach(function(el) { el.classList.remove('active'); });
  var pageEl = document.getElementById('page-' + name);
  if (pageEl) pageEl.classList.add('active');

  document.getElementById('topnav-title').textContent = meta.title;
  document.getElementById('topnav-sub').textContent   = meta.sub;

  var actionBtn = document.getElementById('topnav-action-btn');
  if (meta.action) {
    actionBtn.style.display = '';
    document.getElementById('topnav-action-label').textContent = meta.action;
  } else {
    actionBtn.style.display = 'none';
  }
  document.getElementById('topnav-email-btn').style.display = meta.email ? '' : 'none';


  if      (name === 'overview')       renderOverview();
  else if (name === 'events')         renderEvents();
  else if (name === 'rsvps')          renderRSVPs();
  else if (name === 'guests')         renderGuests();
  else if (name === 'admin-users')    { loadAdminUsers(); loadUserActivity(); }
  else if (name === 'admin-overview') loadAdminOverview();
  else if (name === 'admin-sessions') loadAdminSessions();
  else if (name === 'admin-activity') loadUserActivity();
  else if (name === 'admin-emails')   loadEmailLog();
  else if (name === 'admin-audit')    renderAuditLog();
}

// ── Stats ────────────────────────────────────────
function refreshStats() {
  function isWL(r) { return r.waitlisted == 1 || r.waitlisted === true; }
  var attending  = allRSVPs.filter(function(r) { return r.status === 'attending' && !isWL(r); }).length;
  var declined   = allRSVPs.filter(function(r) { return r.status === 'declined'  && !isWL(r); }).length;
  var pending    = allRSVPs.filter(function(r) { return r.status === 'pending'   && !isWL(r); }).length;
  var waitlisted = allRSVPs.filter(function(r) { return isWL(r); }).length;
  var total      = allRSVPs.length;
  var rate       = total > 0 ? Math.round(((attending + declined) / total) * 100) : 0;

  function set(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }

  set('stat-total-events', allEvents.length);
  set('stat-attending',    attending);
  set('stat-declined',     declined);
  set('stat-pending',      pending);
  set('stat-waitlisted',   waitlisted);
  set('rate-pct',          rate + '%');
  set('rate-attending',    attending);
  set('rate-declined',     declined);
  set('rate-pending',      pending);
  set('rate-waitlisted',   waitlisted);
  set('prof-events',       allEvents.length);
  set('prof-rsvps',        total);
  set('prof-attending',    attending);
  set('prof-waitlisted',   waitlisted);

  var rateBar = document.getElementById('rate-bar');
  if (rateBar) rateBar.style.width = rate + '%';
}

// ── Open add modal ───────────────────────────────
function openAddModal() {
  var meta = sectionMeta[currentSection];
  if (!meta || !meta.action) return;
  if (meta.action === 'ADD RSVP') {
    populateEventSelect();
    hideAlert('rsvp-modal-alert');
    document.getElementById('rsvp-guest-name').value    = '';
    document.getElementById('rsvp-guest-email').value   = '';
    document.getElementById('rsvp-event-select').value  = '';
    document.getElementById('rsvp-status-select').value = 'attending';
    openModal('modal-add-rsvp');
  } else {
    document.getElementById('ev-name').value     = '';
    document.getElementById('ev-date').value     = '';
    document.getElementById('ev-location').value = '';
    document.getElementById('ev-capacity').value = '';
    document.getElementById('ev-desc').value     = '';
    openModal('modal-add-event');
  }
}