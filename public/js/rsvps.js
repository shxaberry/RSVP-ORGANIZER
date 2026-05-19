// ═══════════════════════════════════════════════
//  rsvps.js — RSVPs + Guests CRUD + rendering
//  FIX: appendAudit() on create/update/delete.
// ═══════════════════════════════════════════════

async function addRSVP() {
  hideAlert('rsvp-modal-alert');

  var guestName = document.getElementById('rsvp-guest-name').value.trim();
  var email     = document.getElementById('rsvp-guest-email').value.trim();
  var eventId   = parseInt(document.getElementById('rsvp-event-select').value) || 0;
  var status    = document.getElementById('rsvp-status-select').value;

  if (!guestName) { showAlert('rsvp-modal-alert', 'Guest name is required.'); return; }
  if (!email)     { showAlert('rsvp-modal-alert', 'Guest email is required.'); return; }
  if (!eventId)   { showAlert('rsvp-modal-alert', 'Please select an event.'); return; }

  var d = await api('POST', '/api/rsvps', {
    guest_name: guestName,
    email:      email,
    event_id:   eventId,
    status:     status
  });

  if (!d.success) {
    showAlert('rsvp-modal-alert', d.message || 'Failed to save RSVP.');
    return;
  }

  // Find event name for audit
  var evObj = allEvents.find(function(e) { return e.id == eventId; });
  var evName = evObj ? evObj.name : 'event #' + eventId;
  appendAudit('CREATE_RSVP', guestName + ' (' + email + ') added as ' + status + ' for "' + evName + '"' + (d.waitlisted ? ' [WAITLISTED]' : ''));

  closeModal('modal-add-rsvp');

  var msg = d.waitlisted == 1
    ? 'RSVP added \u2014 guest is waitlisted (event full).'
    : 'RSVP added for ' + guestName + '.';
  toast(msg);

  await loadAll();
  if      (currentSection === 'rsvps')   renderRSVPs();
  else if (currentSection === 'guests')  renderGuests();
  else                                   renderOverview();
}

async function updateRSVPStatus(id, newStatus) {
  var d = await api('PATCH', '/api/rsvps/' + id, { status: newStatus });
  if (!d.success) {
    toast(d.message || 'Failed to update RSVP.', 'error');
    return;
  }
  appendAudit('UPDATE_RSVP', 'RSVP #' + id + ' status changed to ' + newStatus);
  toast('RSVP updated to ' + newStatus + '.');
  await loadAll();
  renderRSVPs();
}

async function deleteRSVP(id, guestName) {
  confirmDeleteItem(id, 'rsvp', '"' + guestName + '"');
}

// ── Filter ───────────────────────────────────────
function filterRSVPs(status) {
  var filtered = status === 'all'
    ? allRSVPs
    : allRSVPs.filter(function(r) {
        if (status === 'waitlisted') return r.waitlisted == 1;
        return r.status === status && !r.waitlisted;
      });
  renderRSVPTable(filtered);
}

// ── Render RSVPs ─────────────────────────────────
function renderRSVPs() {
  var filter = document.getElementById('rsvp-filter');
  filterRSVPs(filter ? filter.value : 'all');
}

function renderRSVPTable(rsvps) {
  var tbody = document.getElementById('rsvps-tbody');
  if (!tbody) return;

  var countLabel = document.getElementById('rsvp-count-label');
  if (countLabel) countLabel.textContent = rsvps.length + ' RECORD' + (rsvps.length !== 1 ? 'S' : '');

  if (!rsvps.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No RSVPs found.</td></tr>';
    return;
  }

  tbody.innerHTML = rsvps.map(function(r, i) {
    var link = portalLink(r.token);
    return [
      '<tr>',
        '<td class="mono">' + (i + 1) + '</td>',
        '<td>' + esc(r.guest_name || '—') + '</td>',
        '<td class="muted">' + esc(r.email || '—') + '</td>',
        '<td>' + esc(r.event_name || '—') + '</td>',
        '<td>' + statusBadge(r.status, r.waitlisted) + '</td>',
       // Replace the PORTAL LINK <td> block in renderRSVPTable with this:
        '<td>',
          r.token
              ? '<button class="act-btn copy-link-btn" data-link="' + esc(portalLink(r.token)) + '" title="Copy portal link">' +
                  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
                  ' COPY</button>'
              : '<span class="muted" style="font-size:0.7rem">NO TOKEN</span>',
        '</td>',
        '<td class="muted mono">' + (r.created_at ? new Date(r.created_at * 1000).toLocaleDateString() : '—') + '</td>',
        '<td class="actions-cell">',
          '<select class="status-select" onchange="updateRSVPStatus(' + r.id + ',this.value)" title="Change status">',
            ['attending','declined','pending'].map(function(s) {
              return '<option value="' + s + '"' + (r.status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
            }).join(''),
          '</select>',
          '<button class="act-btn act-btn-danger" onclick="deleteRSVP(' + r.id + ',' + JSON.stringify(r.guest_name) + ')" title="Delete RSVP">',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>',
          '</button>',
        '</td>',
      '</tr>'
    ].join('');
  }).join('');
}

// ── Render Guests ────────────────────────────────
function renderGuests(searchVal) {
  var tbody = document.getElementById('guests-tbody');
  if (!tbody) return;

  var guestMap = {};
  allRSVPs.forEach(function(r) {
    var key = (r.email || '').toLowerCase();
    if (!guestMap[key]) {
      guestMap[key] = { name: r.guest_name, email: r.email, count: 0 };
    }
    guestMap[key].count++;
  });

  var guests = Object.values(guestMap);

  if (searchVal) {
    var sv = searchVal.toLowerCase();
    guests = guests.filter(function(g) {
      return (g.name || '').toLowerCase().includes(sv) || (g.email || '').toLowerCase().includes(sv);
    });
  }

  var tag = document.getElementById('guests-count-tag');
  if (tag) tag.textContent = guests.length + ' GUEST' + (guests.length !== 1 ? 'S' : '');

  if (!guests.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No guests found.</td></tr>';
    return;
  }

  tbody.innerHTML = guests.map(function(g, i) {
    return '<tr>' +
      '<td class="mono">' + (i + 1) + '</td>' +
      '<td>' + esc(g.name) + '</td>' +
      '<td class="muted">' + esc(g.email) + '</td>' +
      '<td class="mono">' + g.count + '</td>' +
      '</tr>';
  }).join('');
}