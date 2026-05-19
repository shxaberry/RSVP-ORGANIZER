// ═══════════════════════════════════════════════
//  boot.js — App startup
//  NOTE: toast styles are in style.css.
//        All utility functions are in helpers.js.
// ═══════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async function() {

  // 1. Check if this is a guest portal URL
  var params = new URLSearchParams(window.location.search);
  if (params.get('token') || window.location.pathname.startsWith('/rsvp')) {
    var handled = await initPortal();
    if (handled) return;
  }

  // 2. Try to restore session
  var d = await api('GET', '/api/auth/me');
  if (d.success && d.user) {
    enterDashboard(d.user);
    return;
  }

  // 3. Show login screen
  goTo('screen-login');
  document.getElementById('auth-topbar').style.display = '';
  document.getElementById('app-footer').style.display  = '';
});