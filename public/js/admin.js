// ═══════════════════════════════════════════════
//  admin.js — User management & activity stats
// ═══════════════════════════════════════════════

async function loadAdminUsers() {
  if (!currentUser || currentUser.role !== 1) return;
  try {
    const res  = await fetch('/api/admin/users', { credentials: 'include' });
    const data = await res.json();
    if (data.success) renderAdminUsers(data.users);
    else toast('Failed to load users.', 'error');
  } catch { toast('Network error.', 'error'); }
}

function renderAdminUsers(users) {
  const tbody = document.getElementById('admin-users-tbody');
  document.getElementById('admin-users-count').textContent = users.length + ' USERS';

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No users found.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => `
    <tr>
      <td class="mono muted">${u.id}</td>
      <td><strong>${escapeHtml(u.full_name)}</strong></td>
      <td class="muted small">${escapeHtml(u.email)}</td>
      <td>${u.role === 1
        ? '<span class="badge badge-attending">ADMIN</span>'
        : '<span class="badge badge-pending">USER</span>'}</td>
      <td class="mono small">${new Date(u.created_at * 1000).toLocaleDateString()}</td>
      <td>
        ${u.id !== currentUser.id ? `
          <button class="act-btn" onclick="promoteUser(${u.id}, ${u.role === 1 ? 0 : 1})">
            ${u.role === 1 ? 'DEMOTE' : 'PROMOTE'}
          </button>
          <button class="act-btn danger" onclick="deleteUser(${u.id})">DELETE</button>
        ` : '<span class="muted">—</span>'}
      </td>
    </tr>`).join('');
}

async function promoteUser(userId, newRole) {
  try {
    const res  = await fetch(`/api/admin/users/${userId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ role: newRole })
    });
    const data = await res.json();
    if (data.success) { toast('Role updated.', 'success'); loadAdminUsers(); }
    else toast(data.message || 'Failed.', 'error');
  } catch { toast('Network error.', 'error'); }
}

async function deleteUser(userId) {
  if (!confirm('Delete this user? All their events and RSVPs will be permanently removed.')) return;
  try {
    const res  = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE', credentials: 'include' });
    const data = await res.json();
    if (data.success) { toast('User deleted.', 'success'); loadAdminUsers(); }
    else toast(data.message || 'Deletion failed.', 'error');
  } catch { toast('Network error.', 'error'); }
}

// ── Activity table ───────────────────────────────
async function loadUserActivity() {
  if (!currentUser || currentUser.role !== 1) return;
  const tbody = document.getElementById('admin-activity-tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Loading activity data...</td></tr>';
  try {
    const res  = await fetch('/api/admin/activity', { credentials: 'include' });
    const data = await res.json();
    if (data.success && data.activity) renderUserActivity(data.activity);
    else tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No activity data available.</td></tr>';
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Failed to load activity data.</td></tr>';
  }
}

function renderUserActivity(activity) {
  const tbody = document.getElementById('admin-activity-tbody');
  if (!activity.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No activity records found.</td></tr>';
    return;
  }
  tbody.innerHTML = activity.map(a => `
    <tr>
      <td><strong>${escapeHtml(a.full_name)}</strong></td>
      <td class="muted small">${escapeHtml(a.email)}</td>
      <td class="mono gold">${a.events_created}</td>
      <td class="mono">${a.total_rsvps}</td>
      <td class="mono success">${a.attending_count}</td>
      <td class="mono error">${a.declined_count}</td>
      <td class="mono warning">${a.pending_count}</td>
      <td class="mono gold">${a.waitlisted_count}</td>
    </tr>`).join('');
}

function refreshUserActivity() { loadUserActivity(); }