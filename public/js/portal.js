var _portalToken     = null;
var _portalSelection = null;

function portalSelect(status) {
  _portalSelection = status;

  var btnA = document.getElementById('portal-btn-attending');
  var btnD = document.getElementById('portal-btn-declined');

  // FIX: Use the correct CSS classes defined in style.css
  if (btnA) {
    btnA.classList.toggle('sel-attending', status === 'attending');
    btnA.classList.remove('sel-declined'); // Ensure other state is removed
  }
  if (btnD) {
    btnD.classList.toggle('sel-declined', status === 'declined');
    btnD.classList.remove('sel-attending'); // Ensure other state is removed
  }

  // Ensure the confirm button appears
  var submitBtn = document.getElementById('portal-submit-btn');
  if (submitBtn) submitBtn.style.display = '';

  var alertEl = document.getElementById('portal-alert');
  if (alertEl) {
    alertEl.className = 'alert alert-info show';
    alertEl.textContent = 'You selected: ' + (status === 'attending' ? 'Attending ✓' : 'Declined ✗') + '. Click CONFIRM RSVP to save.';
  }
}

async function portalSubmit() {
  if (!_portalToken || !_portalSelection) return;

  var submitBtn = document.getElementById('portal-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }

  var d = await api('POST', '/rsvp', { token: _portalToken, status: _portalSelection });

  if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<span>CONFIRM RSVP</span>'; }

  var successEl = document.getElementById('portal-success');
  var alertEl   = document.getElementById('portal-alert');

  if (!d.success) {
    if (alertEl) {
      alertEl.className = 'alert alert-error show';
      alertEl.textContent = d.message || 'Failed to update RSVP.';
    }
    return;
  }

  // Disable buttons and show confirmation
  var btnA = document.getElementById('portal-btn-attending');
  var btnD = document.getElementById('portal-btn-declined');
  if (btnA) {
    btnA.disabled = true;
    if (_portalSelection === 'attending') btnA.classList.add('sel-attending');
  }
  if (btnD) {
    btnD.disabled = true;
    if (_portalSelection === 'declined') btnD.classList.add('sel-declined');
  }
  if (submitBtn) submitBtn.style.display = 'none';
  if (alertEl)   alertEl.className = 'alert';

  var msg = d.waitlisted
    ? "The event is full — you've been added to the waitlist."
    : 'Your RSVP has been confirmed as: ' + _portalSelection.toUpperCase() + '.';

  if (successEl) {
    successEl.className = 'alert alert-success show';
    successEl.textContent = msg;
  }
}

// ── Portal boot ──────────────────────────────────
async function initPortal() {
  var params = new URLSearchParams(window.location.search);
  var token  = params.get('token');
  if (!token) return false;

  _portalToken = token;

  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  var portalScreen = document.getElementById('screen-portal');
  if (portalScreen) portalScreen.classList.add('active');
  document.getElementById('auth-topbar').style.display = 'none';
  document.getElementById('app-footer').style.display  = 'none';

  var loadingEl    = document.getElementById('portal-loading');
  var errorEl      = document.getElementById('portal-error');
  var invitationEl = document.getElementById('portal-invitation');

  if (loadingEl)    loadingEl.style.display    = '';
  if (errorEl)      errorEl.style.display      = 'none';
  if (invitationEl) invitationEl.style.display = 'none';

  var d = await api('GET', '/api/rsvp-info?token=' + encodeURIComponent(token));

  if (loadingEl) loadingEl.style.display = 'none';

  if (!d.success) {
    if (errorEl) {
      errorEl.style.display = '';
      var msgEl = document.getElementById('portal-error-msg');
      if (msgEl) msgEl.textContent = d.message || 'Invalid RSVP link.';
    }
    return true;
  }

  if (invitationEl) invitationEl.style.display = 'block';

  function setEl(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }


  setEl('portal-event-name',     d.event.name);
  setEl('portal-event-date',     d.event.date || '—');
  setEl('portal-event-location', d.event.location || '—');
  setEl('portal-guest-name',     d.guest_name);

  
  var descEl = document.getElementById('portal-event-desc');
  if (descEl) {
    if (d.event.description && d.event.description.trim() !== "") {
      descEl.textContent = d.event.description;
      descEl.style.display = 'block'; 
    } else {
      descEl.style.display = 'none';
    }
  }

  var capRow = document.getElementById('portal-capacity-row');
  var capVal = document.getElementById('portal-event-capacity');
  if (d.event.capacity > 0) {
    if (capRow) capRow.style.display = 'flex';
    if (capVal) capVal.textContent = d.event.capacity + ' seats';
  } else {
    if (capRow) capRow.style.display = 'none';
  }

  
  var alertEl = document.getElementById('portal-alert');
  if (d.status && d.status !== 'pending') {
    var msg = d.waitlisted == 1
      ? 'You are on the waitlist for this event.'
      : 'You have already responded: ' + d.status.toUpperCase() + '.';
    if (alertEl) {
      alertEl.className = 'alert alert-success show';
      alertEl.textContent = msg;
    }
    var btnA = document.getElementById('portal-btn-attending');
    var btnD = document.getElementById('portal-btn-declined');
    if (btnA) {
      btnA.disabled = true;
      if (d.status === 'attending') btnA.classList.add('sel-attending');
    }
    if (btnD) {
      btnD.disabled = true;
      if (d.status === 'declined') btnD.classList.add('sel-declined');
    }
    var submitBtn = document.getElementById('portal-submit-btn');
    if (submitBtn) submitBtn.style.display = 'none';
  }

  return true;
}