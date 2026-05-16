// ═══════════════════════════════════════════════
//  boot.js — App initialisation
// ═══════════════════════════════════════════════

(async function boot() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('token');

  // ── Guest portal flow ────────────────────────
  if (token) {
    portalToken = token;
    document.getElementById('auth-topbar').style.display = 'none';
    goTo('screen-portal');

    try {
      const res  = await fetch(`/api/rsvp-info?token=${encodeURIComponent(token)}`);
      const data = await res.json();

      if (data.success) {
        const ev = data.event;

        document.getElementById('portal-event-name').textContent = ev.name;
        document.getElementById('portal-event-date').textContent = new Date(ev.date + 'T00:00:00')
          .toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        document.getElementById('portal-event-location').textContent = ev.location || 'TBA';

        if (!ev.location) document.getElementById('portal-location-box').style.opacity = '0.4';

        if (ev.description) {
          const desc = document.getElementById('portal-event-desc');
          desc.textContent  = ev.description;
          desc.style.display = 'block';
        }

        if (ev.capacity > 0) {
          document.getElementById('portal-event-capacity').textContent = ev.capacity + ' seats';
          document.getElementById('portal-capacity-row').style.display  = 'flex';
        }

        document.getElementById('portal-guest-name').textContent       = data.guest_name;
        document.getElementById('portal-loading').style.display        = 'none';
        document.getElementById('portal-invitation').style.display     = 'block';

        if (data.status !== 'pending') {
          const alertEl = document.getElementById('portal-alert');
          alertEl.textContent = data.waitlisted
            ? 'You are currently on the waitlist.'
            : `Your current RSVP: ${data.status.toUpperCase()}. You can update it below.`;
          alertEl.className = data.waitlisted ? 'alert alert-info show' : 'alert alert-success show';
        }
      } else {
        document.getElementById('portal-loading').style.display  = 'none';
        document.getElementById('portal-error-msg').textContent  = data.message || 'Invalid RSVP link.';
        document.getElementById('portal-error').style.display    = 'block';
      }
    } catch {
      document.getElementById('portal-loading').style.display  = 'none';
      document.getElementById('portal-error-msg').textContent  = 'Network error. Please try again.';
      document.getElementById('portal-error').style.display    = 'block';
    }

    return;
  }

  // ── Authenticated dashboard flow ─────────────
  try {
    const res  = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await res.json();
    if (data.success) enterDashboard(data.user);
  } catch {}
})();

// ── Keyboard shortcuts ───────────────────────────
document.getElementById('li-email').addEventListener('keydown',  e => { if (e.key === 'Enter') document.getElementById('li-pass').focus(); });
document.getElementById('li-pass').addEventListener('keydown',   e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('su-pass2').addEventListener('keydown',  e => { if (e.key === 'Enter') doRegister(); });