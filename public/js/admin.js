// ═══════════════════════════════════════════════
//  admin.js — Admin panel sections
//  Field names match db.zig JSON output exactly
// ═══════════════════════════════════════════════

// ── Admin Overview ───────────────────────────────
async function loadAdminOverview() {
  var dUsers = await api('GET', '/api/admin/users');
  var dSess  = await api('GET', '/api/admin/sessions');
  var dAct   = await api('GET', '/api/admin/activity');

  var users    = dUsers.success ? (dUsers.users    || []) : [];
  var sessions = dSess.success  ? (dSess.sessions  || []) : [];
  var activity = dAct.success   ? (dAct.activity   || []) : [];

  // Count non-admin users (role === 0 = organizer)
  var organizers = users.filter(function(u) { return u.role === 0; }).length;

  // Exclude the permanent admin (role===1) from organizer/guest stats
  var nonAdminActivity = activity.filter(function(a) { return !a.is_admin && a.role !== 1; });

  var totalEvents = 0, totalGuests = 0;
  var totalAtt = 0, totalDec = 0, totalPend = 0, totalWait = 0;
  nonAdminActivity.forEach(function(a) {
    totalEvents += (a.events_created   || 0);
    totalGuests += (a.total_rsvps      || 0);
    // attending/declined/pending already exclude waitlisted from the server;
    // if server doesn't guarantee this, we use the counts as provided.
    totalAtt    += (a.attending_count  || 0);
    totalDec    += (a.declined_count   || 0);
    totalPend   += (a.pending_count    || 0);
    totalWait   += (a.waitlisted_count || 0);
  });

  function set(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
  set('adm-stat-organizers', organizers);
  set('adm-stat-sessions',   sessions.length);
  set('adm-stat-events',     totalEvents);
  set('adm-stat-guests',     totalGuests);
  set('adm-stat-attending',  totalAtt);
  set('adm-stat-declined',   totalDec);
  set('adm-stat-pending',    totalPend);
  set('adm-stat-waitlisted', totalWait);

  var responded = totalAtt + totalDec;
  var total     = responded + totalPend + totalWait;
  var rate      = total > 0 ? Math.round((responded / total) * 100) : 0;
  set('adm-rate-pct', rate + '%');
  var bar = document.getElementById('adm-rate-bar');
  if (bar) bar.style.width = rate + '%';
  set('adm-breakdown-attending',  totalAtt);
  set('adm-breakdown-declined',   totalDec);
  set('adm-breakdown-pending',    totalPend);
  set('adm-breakdown-waitlisted', totalWait);

  var topOrg = document.getElementById('adm-top-organizers');
  if (topOrg) {
    var sorted = activity.slice().sort(function(a, b) { return b.events_created - a.events_created; }).slice(0, 5);
    topOrg.innerHTML = sorted.length
      ? sorted.map(function(a) {
          return '<div class="detail-row">' +
            '<span class="detail-row-label">' + esc(a.full_name) + '</span>' +
            '<span class="detail-row-value detail-gold">' + (a.events_created || 0) + ' events</span>' +
            '</div>';
        }).join('')
      : '<div class="empty-state"><p>No organizers yet.</p></div>';
  }

  var nb = document.getElementById('nb-sessions');
  if (nb) nb.textContent = sessions.length;
}

// ── Admin Users ──────────────────────────────────
async function loadAdminUsers() {
  var d = await api('GET', '/api/admin/users');
  if (!d.success) { toast('Failed to load users.', 'error'); return; }

  var users = d.users || [];
  var tag = document.getElementById('admin-users-count');
  if (tag) tag.textContent = users.length + ' USER' + (users.length !== 1 ? 'S' : '');

  var tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No users found.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(function(u) {
    var isSelf  = currentUser && u.id === currentUser.id;
    var isAdmin = u.role === 1;
    var promoteLabel = isAdmin ? '↓ DEMOTE' : '↑ PROMOTE';
    // Permanent admin (self) cannot be edited; others get promote/demote only (no delete)
    var actions = isSelf
      ? '<span class="muted" style="font-size:0.75rem">Cannot edit self</span>'
      : '<button class="act-btn admin-role-btn" data-id="' + u.id + '" data-role="' + u.role + '" data-name="' + esc(u.full_name) + '">' +
          promoteLabel +
        '</button>';

    return '<tr>' +
      '<td class="mono">' + u.id + '</td>' +
      '<td>' + esc(u.full_name) + (isSelf ? ' <span class="badge badge-pending">YOU</span>' : '') + '</td>' +
      '<td class="muted">' + esc(u.email) + '</td>' +
      '<td>' + (isAdmin
        ? '<span class="badge badge-attending">ADMIN</span>'
        : '<span class="badge badge-pending">ORGANIZER</span>') + '</td>' +
      '<td class="muted mono">' + (u.created_at ? new Date(u.created_at * 1000).toLocaleDateString() : '—') + '</td>' +
      '<td class="actions-cell">' + actions + '</td>' +
      '</tr>';
  }).join('');
}

// ── FIX: toggleUserRole — promote is now fully functional ──
async function toggleUserRole(userId, currentRole, name) {
  var newRole = currentRole === 1 ? 0 : 1;
  // Endpoint matches the main.zig route: /api/admin/users/:id/role
  var d = await api('PATCH', '/api/admin/users/' + userId + '/role', { role: newRole });
  if (d.success) {
    toast(name + ' role updated.');
    loadAdminUsers();
  } else {
    toast('Failed to update role.', 'error');
  }
}

// ── Admin Sessions ─────────────────────────────────
// FIX: online status is derived from the server's session list.
// A user only appears ONLINE if the server returned them in the active sessions list.
// We no longer hard-code "● ONLINE" — offline users simply don't appear.
async function loadAdminSessions() {
  var d = await api('GET', '/api/admin/sessions');
  if (!d.success) { toast('Failed to load sessions.', 'error'); return; }

  var sessions = d.sessions || [];
  var label = document.getElementById('sessions-count-label');
  if (label) label.textContent = sessions.length + ' ONLINE';
  var nb = document.getElementById('nb-sessions');
  if (nb) nb.textContent = sessions.length;

  var tbody = document.getElementById('admin-sessions-tbody');
  if (!tbody) return;

  if (!sessions.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No active sessions.</td></tr>';
    return;
  }

  tbody.innerHTML = sessions.map(function(s, i) {
    var isSelf = currentUser && s.id === currentUser.id;
    // FIX: Only users returned by the server are online. Each row in this list
    // is definitively online — if a user logged out, the server removes them
    // from the sessions endpoint before we even get here.
    return '<tr>' +
      '<td class="mono">' + (i + 1) + '</td>' +
      '<td>' + esc(s.full_name || '—') + (isSelf ? ' <span class="badge badge-pending">YOU</span>' : '') + '</td>' +
      '<td class="muted">' + esc(s.email || '—') + '</td>' +
      '<td>' + (s.role === 1
        ? '<span class="badge badge-attending">ADMIN</span>'
        : '<span class="badge badge-pending">ORGANIZER</span>') + '</td>' +
      '<td class="muted mono">' + (s.logged_in_at ? new Date(s.logged_in_at * 1000).toLocaleString() : '—') + '</td>' +
      '<td class="muted mono">' + (s.logged_out_at ? new Date(s.logged_out_at * 1000).toLocaleString() : '<span style="color:rgba(74,222,128,0.7);font-size:0.75rem">● ACTIVE</span>') + '</td>' +
      '</tr>';
  }).join('');
}


// ── User Activity ─────────────────────────────────
async function loadUserActivity() {
  var d = await api('GET', '/api/admin/activity');
  if (!d.success) { toast('Failed to load activity.', 'error'); return; }

  var activity = d.activity || [];
  var tbody = document.getElementById('admin-activity-tbody');
  if (!tbody) return;

  if (!activity.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No activity yet. Organizers must create events or RSVPs for data to appear here.</td></tr>';
    return;
  }

  tbody.innerHTML = activity.map(function(a) {
    return '<tr>' +
      '<td>' + esc(a.full_name || '—') + '</td>' +
      '<td class="muted">' + esc(a.email || '—') + '</td>' +
      '<td class="mono">'          + (a.events_created   || 0) + '</td>' +
      '<td class="mono">'          + (a.total_rsvps      || 0) + '</td>' +
      '<td class="mono success">'  + (a.attending_count  || 0) + '</td>' +
      '<td class="mono error">'    + (a.declined_count   || 0) + '</td>' +
      '<td class="mono warning">'  + (a.pending_count    || 0) + '</td>' +
      '<td class="mono gold">'     + (a.waitlisted_count || 0) + '</td>' +
      '</tr>';
  }).join('');
}

function refreshUserActivity() { loadUserActivity(); }

// ── Email Log ─────────────────────────────────────
async function loadEmailLog() {
  var tbody = document.getElementById('email-log-tbody');
  var label = document.getElementById('email-log-count');
  if (label) label.textContent = 'Not yet implemented';
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell" style="color:rgba(255,255,255,0.35);font-size:0.8rem">' +
      'Email delivery is logged in the server console. The /api/admin/emails endpoint is not yet wired in the backend.' +
      '</td></tr>';
  }
}

// ── Audit Log ─────────────────────────────────────
// FIX: Now fully functional — renders the client-side auditLog array.
// Records are appended by appendAudit() on every meaningful action.
function renderAuditLog() {
  var tbody = document.getElementById('audit-log-tbody');
  var label = document.getElementById('audit-count-label');
  var filterEl = document.getElementById('audit-filter');
  var filterVal = filterEl ? filterEl.value : 'all';

  // Apply filter
  var records = auditLog;
  if (filterVal !== 'all') {
    var filterMap = {
      login:  ['LOGIN'],
      logout: ['LOGOUT'],
      create: ['CREATE_EVENT', 'CREATE_RSVP', 'POLL_UPDATE'],
      delete: ['DELETE_EVENT', 'DELETE_RSVP', 'DELETE_USER'],
      role:   ['PROMOTE_USER', 'DEMOTE_USER']
    };
    var allowed = filterMap[filterVal] || [];
    records = auditLog.filter(function(r) { return allowed.indexOf(r.action) !== -1; });
  }

  if (label) label.textContent = records.length + ' RECORD' + (records.length !== 1 ? 'S' : '');

  if (!tbody) return;

  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">' +
      (auditLog.length === 0
        ? 'No actions recorded yet. Actions are logged as you use the system.'
        : 'No records match the selected filter.') +
      '</td></tr>';
    return;
  }

  // Action badge colour map
  var colorMap = {
    LOGIN:          'badge-attending',
    LOGOUT:         'badge-declined',
    CREATE_EVENT:   'badge-attending',
    CREATE_RSVP:    'badge-attending',
    DELETE_EVENT:   'badge-declined',
    DELETE_RSVP:    'badge-declined',
    DELETE_USER:    'badge-declined',
    PROMOTE_USER:   'badge-waitlisted',
    DEMOTE_USER:    'badge-pending',
    MANUAL_REFRESH: 'badge-pending',
    POLL_UPDATE:    'badge-pending',
    UPDATE_RSVP:    'badge-pending'
  };

  tbody.innerHTML = records.map(function(r, i) {
    var cls = colorMap[r.action] || 'badge-pending';
    return '<tr>' +
      '<td class="mono">' + (i + 1) + '</td>' +
      '<td class="muted mono">' + new Date(r.ts).toLocaleString() + '</td>' +
      '<td><span class="badge ' + cls + '">' + esc(r.action) + '</span></td>' +
      '<td>' + esc(r.user) + ' <span class="muted" style="font-size:0.7rem">(' + esc(r.role) + ')</span></td>' +
      '<td class="muted">' + esc(r.detail) + '</td>' +
      '</tr>';
  }).join('');
}

document.addEventListener('click', function(e) {
  var roleBtn = e.target.closest('.admin-role-btn');
  if (roleBtn) {
    var id   = parseInt(roleBtn.dataset.id);
    var role = parseInt(roleBtn.dataset.role);
    var name = roleBtn.dataset.name;
    toggleUserRole(id, role, name);
    return;
  }

  // Delete button removed from user management — users are permanent records
});