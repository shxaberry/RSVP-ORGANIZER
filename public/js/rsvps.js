// ═══════════════════════════════════════════════
//  rsvps.js — RSVP CRUD, guests rendering, search
// ═══════════════════════════════════════════════

function populateEventSelect() {
  const sel = document.getElementById('rsvp-event-select');
  sel.innerHTML = '<option value="">— Select Event —</option>';
  allEvents.forEach(ev => {
    const o = document.createElement('option');
    o.value = ev.id;
    o.textContent = ev.name;
    sel.appendChild(o);
  });
}

async function addRSVP() {
  const guestName = document.getElementById('rsvp-guest-name').value.trim();
  const email     = document.getElementById('rsvp-guest-email').value.trim();
  const eventId   = parseInt(document.getElementById('rsvp-event-select').value);
  const status    = document.getElementById('rsvp-status-select').value;

  hideAlert('rsvp-modal-alert');
  if (!guestName || !email || !eventId) {
    showAlert('rsvp-modal-alert', 'All fields are required.');
    return;
  }

  try {
    const res = await fetch('/api/rsvps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ guest_name: guestName, email, event_id: eventId, status })
    });
    const d = await res.json();
    if (d.success) {
      ['rsvp-guest-name', 'rsvp-guest-email'].forEach(id => document.getElementById(id).value = '');
      closeModal('modal-add-rsvp');
      await loadAll();
      toast(
        d.waitlisted ? `Added to waitlist! Token: ${d.token}` : `RSVP saved! Portal: /rsvp?token=${d.token}`,
        d.waitlisted ? 'info' : 'success'
      );
    } else {
      showAlert('rsvp-modal-alert', d.message || 'Failed to save RSVP.');
    }
  } catch { showAlert('rsvp-modal-alert', 'Network error.'); }
}

async function updateRSVPStatus(id, status) {
  try {
    const res = await fetch(`/api/rsvps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status })
    });
    const d = await res.json();
    if (d.success) { await loadAll(); renderRSVPs(); toast('RSVP updated.', 'success'); }
    else toast(d.message || 'Failed.', 'error');
  } catch { toast('Network error.', 'error'); }
}

function deleteRSVP(id) {
  const r = allRSVPs.find(r => r.id == id);
  deleteTarget = { type: 'rsvp', id };
  document.getElementById('confirm-msg').textContent = `Remove RSVP from "${r?.guest_name}"?`;
  openModal('modal-confirm');
}

function copyPortalLink(token) {
  const url = `${location.origin}/rsvp?token=${token}`;
  navigator.clipboard?.writeText(url)
    .then(() => toast('Portal link copied!', 'success'))
    .catch(() => toast(url, 'info'));
}

function filterRSVPs(val) { renderRSVPs(val); }

function renderRSVPs(filterStatus) {
  filterStatus = filterStatus ?? document.getElementById('rsvp-filter')?.value ?? 'all';

  const filtered = filterStatus === 'all'
    ? allRSVPs
    : filterStatus === 'waitlisted'
      ? allRSVPs.filter(r => r.waitlisted == 1)
      : allRSVPs.filter(r => r.status === filterStatus && !r.waitlisted);

  const tbody = document.getElementById('rsvps-tbody');
  document.getElementById('rsvp-count-label').textContent = filtered.length + ' records';

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No RSVP records found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((r, i) => {
    const ev = allEvents.find(e => e.id == r.event_id);
    return `<tr>
      <td class="mono muted">${String(i + 1).padStart(2, '0')}</td>
      <td><strong>${r.guest_name}</strong></td>
      <td class="muted small">${r.email}</td>
      <td class="muted small">${ev?.name || '—'}</td>
      <td>${r.waitlisted == 1 ? badgeHTML('waitlisted') : badgeHTML(r.status)}</td>
      <td>
        <button class="act-btn" type="button" onclick="copyPortalLink('${r.token}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          COPY LINK
        </button>
      </td>
      <td class="mono muted small">${fmtDate2(r.created_at)}</td>
      <td>
        ${r.status !== 'attending' && !r.waitlisted
          ? `<button class="act-btn success" type="button" onclick="updateRSVPStatus(${r.id},'attending')">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>
             </button>` : ''}
        ${r.status !== 'declined'
          ? `<button class="act-btn danger" type="button" onclick="updateRSVPStatus(${r.id},'declined')">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
             </button>` : ''}
        <button class="act-btn danger" type="button" onclick="deleteRSVP(${r.id})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          </svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

function renderGuests() {
  const tbody = document.getElementById('guests-tbody');
  const map   = {};

  allRSVPs.forEach(r => {
    if (!map[r.email]) map[r.email] = { name: r.guest_name, email: r.email, count: 0 };
    map[r.email].count++;
  });

  const guests = Object.values(map);
  document.getElementById('guests-count-tag').textContent = guests.length + ' GUESTS';

  if (!guests.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No guests yet. Add RSVPs to see guests here.</td></tr>';
    return;
  }

  tbody.innerHTML = guests.map((g, i) => `
    <tr>
      <td class="mono muted">${String(i + 1).padStart(2, '0')}</td>
      <td><strong>${g.name}</strong></td>
      <td class="muted small">${g.email}</td>
      <td class="gold mono">${g.count}</td>
    </tr>`).join('');
}

// ── Search ───────────────────────────────────────
function handleSearch(q) {
  if (!q) { showSection(currentSection); return; }
  q = q.toLowerCase();

  const matchRsvps = allRSVPs.filter(r =>
    r.guest_name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)
  );

  showSection('rsvps');

  if (matchRsvps.length) {
    const tbody = document.getElementById('rsvps-tbody');
    tbody.innerHTML = matchRsvps.map((r, i) => {
      const ev = allEvents.find(e => e.id == r.event_id);
      return `<tr>
        <td class="mono muted">${String(i + 1).padStart(2, '0')}</td>
        <td><strong>${r.guest_name}</strong></td>
        <td class="muted small">${r.email}</td>
        <td class="muted small">${ev?.name || '—'}</td>
        <td>${r.waitlisted == 1 ? badgeHTML('waitlisted') : badgeHTML(r.status)}</td>
        <td>—</td>
        <td class="mono muted small">${fmtDate2(r.created_at)}</td>
        <td>
          <button class="act-btn danger" type="button" onclick="deleteRSVP(${r.id})">DEL</button>
        </td>
      </tr>`;
    }).join('');
  }
}