// ═══════════════════════════════════════════════
//  portal.js — Guest RSVP portal
// ═══════════════════════════════════════════════

function portalSelect(status) {
  portalSelectedStatus = status;
  document.getElementById('portal-btn-attending').className =
    'portal-status-btn' + (status === 'attending' ? ' sel-attending' : '');
  document.getElementById('portal-btn-declined').className =
    'portal-status-btn' + (status === 'declined'  ? ' sel-declined'  : '');
  document.getElementById('portal-submit-btn').style.display = '';
}

async function portalSubmit() {
  if (!portalSelectedStatus || !portalToken) return;
  const btn = document.getElementById('portal-submit-btn');
  btn.classList.add('loading');

  try {
    const res = await fetch('/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: portalToken, status: portalSelectedStatus })
    });
    const d = await res.json();

    if (d.success) {
      document.getElementById('portal-submit-btn').style.display    = 'none';
      document.getElementById('portal-btn-attending').style.display = 'none';
      document.getElementById('portal-btn-declined').style.display  = 'none';

      const msg = d.waitlisted
        ? 'The event is full — you have been added to the waitlist.'
        : `Your RSVP is confirmed as: ${portalSelectedStatus.toUpperCase()}`;

      document.getElementById('portal-success').textContent = msg;
      document.getElementById('portal-success').className   = d.waitlisted
        ? 'alert alert-info show'
        : 'alert alert-success show';
      document.getElementById('portal-alert').classList.remove('show');
    } else {
      document.getElementById('portal-alert').textContent = d.message || 'Error updating RSVP.';
      document.getElementById('portal-alert').className   = 'alert alert-error show';
    }
  } catch {
    document.getElementById('portal-alert').textContent = 'Network error.';
    document.getElementById('portal-alert').className   = 'alert alert-error show';
  }

  btn.classList.remove('loading');
}