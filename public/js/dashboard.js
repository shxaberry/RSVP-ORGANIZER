// ═══════════════════════════════════════════════
//  dashboard.js — Entry, data loading, navigation
// ═══════════════════════════════════════════════

// ── Dashboard entry ─────────────────────────────
function enterDashboard(user) {
  currentUser = user;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('auth-topbar').style.display = 'none';
  document.getElementById('app-footer').style.display  = 'none';
  document.getElementById('app-layout').classList.add('active');

  const initials = user.full_name.trim().split(/\s+/).map(w => w[0].toUpperCase()).slice(0, 2).join('');
  document.getElementById('sb-avatar').textContent      = initials;
  document.getElementById('sb-name').textContent        = user.full_name;
  document.getElementById('prof-avatar').textContent    = initials;
  document.getElementById('prof-name').textContent      = user.full_name;
  document.getElementById('prof-email').textContent     = user.email;
  document.getElementById('prof-full-name').textContent = user.full_name;
  document.getElementById('prof-email-val').textContent = user.email;
  document.getElementById('prof-id').textContent        = '#' + (user.id || '—');

  const since = user.created_at
    ? new Date(user.created_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';
  document.getElementById('prof-since').textContent  = since;
  document.getElementById('prof-joined').textContent = 'Joined ' + since;

  const isAdmin      = user.role === 1;
  const adminNav     = document.getElementById('nav-admin-users');
  const roleSpan     = document.querySelector('.sidebar-user-role');
  const profRoleSpan = document.getElementById('prof-role');

  if (adminNav)     adminNav.style.display  = isAdmin ? 'flex' : 'none';
  if (roleSpan)     roleSpan.textContent    = isAdmin ? 'ADMINISTRATOR' : 'EVENT MANAGER';
  if (profRoleSpan) profRoleSpan.textContent = isAdmin ? 'ADMINISTRATOR' : 'EVENT MANAGER';

  loadAll();
}

// ── Data fetching ────────────────────────────────
async function loadAll() {
  await Promise.all([loadEvents(), loadRSVPs()]);
  refreshStats();
  showSection(currentSection);
}

async function loadEvents() {
  try {
    const res = await fetch('/api/events', { credentials: 'include' });
    const d   = await res.json();
    if (d.success) allEvents = d.events || [];
  } catch { toast('Failed to load events.', 'error'); }
}

async function loadRSVPs() {
  try {
    const res = await fetch('/api/rsvps', { credentials: 'include' });
    const d   = await res.json();
    if (d.success) allRSVPs = d.rsvps || [];
  } catch { toast('Failed to load RSVPs.', 'error'); }
}

// ── Navigation ───────────────────────────────────
const sectionMeta = {
  overview:      { title: 'OVERVIEW', sub: '/ Dashboard',    action: 'NEW EVENT', email: false, admin: false },
  events:        { title: 'EVENTS',   sub: '/ All Events',   action: 'NEW EVENT', email: false, admin: false },
  rsvps:         { title: 'RSVPs',    sub: '/ Responses',    action: 'ADD RSVP',  email: true,  admin: false },
  guests:        { title: 'GUESTS',   sub: '/ Guest List',   action: 'ADD RSVP',  email: false, admin: false },
  profile:       { title: 'PROFILE',  sub: '/ Account',      action: null,        email: false, admin: false },
  settings:      { title: 'SETTINGS', sub: '/ System Info',  action: null,        email: false, admin: false },
  'admin-users': { title: 'ADMIN',    sub: '/ Manage Users', action: null,        email: false, admin: true  }
};

function showSection(name) {
  const meta = sectionMeta[name];
  if (meta?.admin && (!currentUser || currentUser.role !== 1)) {
    showSection('overview');
    return;
  }

  currentSection = name;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('nav-' + name)?.classList.add('active');
  document.querySelectorAll('.section-page').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + name)?.classList.add('active');
  document.getElementById('topnav-title').textContent = meta.title;
  document.getElementById('topnav-sub').textContent   = meta.sub;

  const actionBtn = document.getElementById('topnav-action-btn');
  if (meta.action) {
    actionBtn.style.display = '';
    document.getElementById('topnav-action-label').textContent = meta.action;
  } else {
    actionBtn.style.display = 'none';
  }
  document.getElementById('topnav-email-btn').style.display = meta.email ? '' : 'none';

  if      (name === 'overview')     renderOverview();
  else if (name === 'events')       renderEvents();
  else if (name === 'rsvps')        renderRSVPs();
  else if (name === 'guests')       renderGuests();
  else if (name === 'admin-users')  { loadAdminUsers(); loadUserActivity(); }
}

// ── Stats ────────────────────────────────────────
function refreshStats() {
  const attending  = allRSVPs.filter(r => r.status === 'attending' && !r.waitlisted).length;
  const declined   = allRSVPs.filter(r => r.status === 'declined').length;
  const pending    = allRSVPs.filter(r => r.status === 'pending').length;
  const waitlisted = allRSVPs.filter(r => r.waitlisted == 1).length;
  const total      = allRSVPs.length;
  const rate       = total > 0 ? Math.round(((attending + declined) / total) * 100) : 0;

  document.getElementById('stat-total-events').textContent = allEvents.length;
  document.getElementById('stat-attending').textContent    = attending;
  document.getElementById('stat-declined').textContent     = declined;
  document.getElementById('stat-pending').textContent      = pending;
  document.getElementById('stat-waitlisted').textContent   = waitlisted;
  document.getElementById('nb-events').textContent         = allEvents.length;
  document.getElementById('nb-rsvps').textContent          = total;
  document.getElementById('rate-pct').textContent          = rate + '%';
  document.getElementById('rate-bar').style.width          = rate + '%';
  document.getElementById('rate-attending').textContent    = attending;
  document.getElementById('rate-declined').textContent     = declined;
  document.getElementById('rate-pending').textContent      = pending;
  document.getElementById('rate-waitlisted').textContent   = waitlisted;
  document.getElementById('prof-events').textContent       = allEvents.length;
  document.getElementById('prof-rsvps').textContent        = total;
  document.getElementById('prof-attending').textContent    = attending;
  document.getElementById('prof-waitlisted').textContent   = waitlisted;
}

// ── Modal helpers ────────────────────────────────
function openAddModal() {
  const meta = sectionMeta[currentSection];
  if (!meta?.action) return;
  if (meta.action === 'ADD RSVP') {
    populateEventSelect();
    hideAlert('rsvp-modal-alert');
    openModal('modal-add-rsvp');
  } else {
    openModal('modal-add-event');
  }
}

function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-backdrop')) e.target.classList.remove('open');
});