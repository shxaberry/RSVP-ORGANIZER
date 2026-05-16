// ═══════════════════════════════════════════════
//  events.js — Event CRUD and rendering
// ═══════════════════════════════════════════════

async function addEvent() {
  const name     = document.getElementById('ev-name').value.trim();
  const date     = document.getElementById('ev-date').value;
  const location = document.getElementById('ev-location').value.trim();
  const capacity = parseInt(document.getElementById('ev-capacity').value) || 0;
  const desc     = document.getElementById('ev-desc').value.trim();

  if (!name || !date) { toast('Event name and date are required.', 'error'); return; }

  try {
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, date, location, description: desc, capacity })
    });
    const d = await res.json();
    if (d.success) {
      ['ev-name', 'ev-date', 'ev-location', 'ev-capacity', 'ev-desc']
        .forEach(id => document.getElementById(id).value = '');
      closeModal('modal-add-event');
      await loadAll();
      toast('Event created!', 'success');
    } else {
      toast(d.message || 'Failed to create event.', 'error');
    }
  } catch { toast('Network error.', 'error'); }
}

function deleteEvent(id) {
  const ev = allEvents.find(e => e.id == id);
  deleteTarget = { type: 'event', id };
  document.getElementById('confirm-msg').textContent = `Delete "${ev?.name}"? All RSVPs will also be removed.`;
  openModal('modal-confirm');
}

function renderEvents() {
  const grid = document.getElementById('events-grid');
  document.getElementById('events-count-tag').textContent = allEvents.length + ' EVENTS';

  if (!allEvents.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <p>No events yet. Click NEW EVENT to get started.</p>
      </div>`;
    return;
  }

  const accents = ['accent-gold', 'accent-blue', 'accent-green'];
  grid.innerHTML = '';

  allEvents.forEach(ev => {
    const evRsvps = allRSVPs.filter(r => r.event_id == ev.id);
    const card    = document.createElement('div');
    card.className = 'event-card';
    card.innerHTML = `
      <div class="event-card-accent ${accents[ev.id % accents.length]}"></div>
      <div class="event-card-header">
        <div class="event-card-name">${ev.name}</div>
        ${badgeHTML(ev.status || 'upcoming')}
      </div>
      <div class="event-card-date">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        ${fmtDate(ev.date)}
        ${ev.location ? `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="margin-left:8px">
            <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg> ${ev.location}` : ''}
      </div>
      ${ev.description ? `<div class="event-card-desc">${ev.description}</div>` : ''}
      <div class="event-card-stats">
        <div class="event-stat">
          <div class="event-stat-val">${evRsvps.length}</div>
          <div class="event-stat-lbl">RSVPs</div>
        </div>
        <div class="event-stat">
          <div class="event-stat-val green">${evRsvps.filter(r => r.status === 'attending' && !r.waitlisted).length}</div>
          <div class="event-stat-lbl">GOING</div>
        </div>
        <div class="event-stat">
          <div class="event-stat-val gold">${evRsvps.filter(r => r.waitlisted == 1).length}</div>
          <div class="event-stat-lbl">WAITLIST</div>
        </div>
      </div>
      <div class="event-card-actions">
        ${ev.capacity > 0 ? `<span class="capacity-tag">Cap: ${ev.capacity}</span>` : ''}
        <button class="act-btn" type="button" onclick="event.stopPropagation(); emailAllForEvent(${ev.id})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          EMAIL PENDING
        </button>
        <button class="act-btn danger" type="button" onclick="event.stopPropagation(); deleteEvent(${ev.id})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
          DELETE
        </button>
      </div>`;
    grid.appendChild(card);
  });
}

function renderOverview() {
  const el       = document.getElementById('overview-events-list');
  const upcoming = allEvents.filter(e => e.status === 'upcoming').slice(0, 3);

  if (!upcoming.length) {
    el.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <p>No upcoming events.</p>
      </div>`;
  } else {
    el.innerHTML = upcoming.map(ev => {
      const evR = allRSVPs.filter(r => r.event_id == ev.id);
      return `
        <div class="event-card" onclick="showSection('events')">
          <div class="event-card-accent accent-gold"></div>
          <div class="event-card-header">
            <div class="event-card-name">${ev.name}</div>
            ${badgeHTML('upcoming')}
          </div>
          <div class="event-card-date">${fmtDate(ev.date)}${ev.location ? ' · ' + ev.location : ''}</div>
          <div class="event-card-stats">
            <div class="event-stat"><div class="event-stat-val">${evR.length}</div><div class="event-stat-lbl">RSVPs</div></div>
            <div class="event-stat"><div class="event-stat-val green">${evR.filter(r => r.status === 'attending' && !r.waitlisted).length}</div><div class="event-stat-lbl">GOING</div></div>
            <div class="event-stat"><div class="event-stat-val gold">${evR.filter(r => r.status === 'pending').length}</div><div class="event-stat-lbl">PENDING</div></div>
          </div>
        </div>`;
    }).join('');
  }

  const tbody  = document.getElementById('overview-rsvp-tbody');
  const recent = [...allRSVPs].sort((a, b) => b.id - a.id).slice(0, 5);

  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">No RSVPs yet.</td></tr>';
    return;
  }
  tbody.innerHTML = recent.map(r => {
    const ev = allEvents.find(e => e.id == r.event_id);
    return `<tr>
      <td>${r.guest_name}</td>
      <td class="muted small">${ev?.name || '—'}</td>
      <td>${r.waitlisted == 1 ? badgeHTML('waitlisted') : badgeHTML(r.status)}</td>
    </tr>`;
  }).join('');
}

// ── Email ────────────────────────────────────────
async function emailAllPending() {
  const ids = [...new Set(allRSVPs.filter(r => r.status === 'pending').map(r => r.event_id))];
  if (!ids.length) { toast('No pending RSVPs found.', 'info'); return; }
  for (const eid of ids) await emailAllForEvent(eid, true);
  toast('Email reminders queued for all pending guests.', 'success');
}

async function emailAllForEvent(eventId, silent = false) {
  try {
    const res = await fetch(`/api/events/${eventId}/email-all`, { method: 'POST', credentials: 'include' });
    const d   = await res.json();
    if (!silent) toast(d.message || 'Done.', d.success ? 'success' : 'error');
    return d;
  } catch { if (!silent) toast('Network error.', 'error'); }
}

// ── Confirm delete ───────────────────────────────
async function confirmDelete() {
  if (!deleteTarget) return;
  closeModal('modal-confirm');

  const url    = deleteTarget.type === 'event' ? `/api/events/${deleteTarget.id}` : `/api/rsvps/${deleteTarget.id}`;
  const onDone = deleteTarget.type === 'event'
    ? () => { loadAll().then(renderEvents); toast('Event deleted.', 'success'); }
    : () => { loadAll().then(renderRSVPs);  toast('RSVP deleted.', 'success'); };

  try {
    const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
    const d   = await res.json();
    if (d.success) onDone();
    else toast(d.message || 'Failed.', 'error');
  } catch { toast('Network error.', 'error'); }

  deleteTarget = null;
}