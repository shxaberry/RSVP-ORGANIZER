// ═══════════════════════════════════════════════
//  events.js — Events CRUD + rendering
//  FIX: appendAudit() called on create/delete.
// ═══════════════════════════════════════════════

async function addEvent() {
  var name     = document.getElementById('ev-name').value.trim();
  var date     = document.getElementById('ev-date').value;
  var location = document.getElementById('ev-location').value.trim();
  var capacity = parseInt(document.getElementById('ev-capacity').value) || 0;
  var desc     = document.getElementById('ev-desc').value.trim();

  if (!name) { toast('Event name is required.', 'error'); return; }
  if (!date) { toast('Event date is required.', 'error'); return; }

  var d = await api('POST', '/api/events', {
    name:        name,
    date:        date,
    location:    location,
    description: desc,
    capacity:    capacity
  });

  if (!d.success) {
    toast(d.message || 'Failed to create event.', 'error');
    return;
  }

  appendAudit('CREATE_EVENT', 'Event "' + name + '" created (date: ' + date + ', capacity: ' + (capacity || 'unlimited') + ')');

  closeModal('modal-add-event');
  toast('Event "' + name + '" created!');

  await loadAll();
  if (currentSection === 'events') renderEvents();
  else renderOverview();
}

async function deleteEvent(id, name) {
  confirmDeleteItem(id, 'event', '"' + name + '"');
}

async function emailAllPending() {
  if (!allEvents.length) { toast('No events found.', 'error'); return; }
  var count = 0;
  for (var i = 0; i < allEvents.length; i++) {
    var ev = allEvents[i];
    var pending = allRSVPs.filter(function(r) { return r.event_id == ev.id && r.status === 'pending'; });
    if (pending.length) {
      var d = await api('POST', '/api/events/' + ev.id + '/email-all');
      if (d.success) count++;
    }
  }
  toast(count > 0 ? 'Emails queued for pending guests.' : 'No pending guests found.');
}

// ── Render ───────────────────────────────────────
function renderEvents() {
  renderEventGrid(allEvents);
  var tag = document.getElementById('events-count-tag');
  if (tag) tag.textContent = allEvents.length + ' EVENT' + (allEvents.length !== 1 ? 'S' : '');
}

function renderEventGrid(events) {
  var grid = document.getElementById('events-grid');
  if (!grid) return;
  if (!events.length) {
    grid.innerHTML = '<div class="empty-state"><p>No events yet. Click NEW EVENT to create one.</p></div>';
    return;
  }
  grid.innerHTML = events.map(function(ev) {
    var rsvpsForEvent = allRSVPs.filter(function(r) { return r.event_id == ev.id; });
    var attending  = rsvpsForEvent.filter(function(r) { return r.status === 'attending' && !r.waitlisted; }).length;
    var pending    = rsvpsForEvent.filter(function(r) { return r.status === 'pending'; }).length;
    var waitlisted = rsvpsForEvent.filter(function(r) { return r.waitlisted == 1; }).length;
    var cap        = ev.capacity > 0 ? ev.capacity : '\u221E';
    return [
      '<div class="event-card">',
        '<div class="event-card-header">',
          '<div class="event-card-name">' + esc(ev.name) + '</div>',
        '</div>',
        '<div class="event-card-meta">',
          '<span>',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
            ' ' + esc(ev.date || '—'),
          '</span>',
          ev.location ? '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ' + esc(ev.location) + '</span>' : '',
        '</div>',
        ev.description ? '<div class="event-card-desc">' + esc(ev.description) + '</div>' : '',
        '<div class="event-card-stats">',
          '<div class="event-stat attending"><span>' + attending  + '</span><small>Attending</small></div>',
          '<div class="event-stat pending"><span>'   + pending    + '</span><small>Pending</small></div>',
          '<div class="event-stat waitlisted"><span>'+ waitlisted + '</span><small>Waitlist</small></div>',
          '<div class="event-stat capacity"><span>'  + cap        + '</span><small>Capacity</small></div>',
        '</div>',
      '</div>'
    ].join('');
  }).join('');
}

function renderOverview() {
  refreshStats();

  var evList = document.getElementById('overview-events-list');
  if (evList) {
    var sorted = allEvents.slice().sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var top5   = sorted.slice(0, 5);
    if (!top5.length) {
      evList.innerHTML = '<div class="empty-state"><p>No events yet.</p></div>';
    } else {
      evList.innerHTML = top5.map(function(ev) {
        var cnt = allRSVPs.filter(function(r) { return r.event_id == ev.id; }).length;
        return '<div class="overview-event-row">' +
          '<div class="overview-event-name">' + esc(ev.name) + '</div>' +
          '<div class="overview-event-meta">' + esc(ev.date || '—') + ' &bull; ' + cnt + ' RSVPs</div>' +
          '</div>';
      }).join('');
    }
  }

  var tbody = document.getElementById('overview-rsvp-tbody');
  if (tbody) {
    var recent = allRSVPs.slice().reverse().slice(0, 8);
    if (!recent.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">No RSVPs yet.</td></tr>';
    } else {
      tbody.innerHTML = recent.map(function(r) {
        return '<tr>' +
          '<td>' + esc(r.guest_name || '—') + '</td>' +
          '<td>' + esc(r.event_name  || '—') + '</td>' +
          '<td>' + statusBadge(r.status, r.waitlisted) + '</td>' +
          '</tr>';
      }).join('');
    }
  }
}