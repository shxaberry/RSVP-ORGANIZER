// ═══════════════════════════════════════════════
//  auth.js — Login, signup, logout
// ═══════════════════════════════════════════════

function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function toggleEye(id, btn) {
  const inp = document.getElementById(id);
  inp.type = inp.type === 'text' ? 'password' : 'text';
  btn.style.color = inp.type === 'text' ? 'var(--yellow)' : '';
}

function setFieldError(inputId, errId, msg) {
  const inp = document.getElementById(inputId);
  const err = document.getElementById(errId);
  if (msg) {
    inp?.classList.add('is-error');
    if (err) { err.textContent = msg; err.classList.add('show'); }
  } else {
    inp?.classList.remove('is-error');
    err?.classList.remove('show');
  }
}

function showAlert(id, msg, type = 'error') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `alert show alert-${type}`;
}

function hideAlert(id) {
  document.getElementById(id)?.classList.remove('show');
}

// ── Login attempt dots ──────────────────────────
let loginAttempts = 0;

function updateDots(n) {
  document.getElementById('li-attempts').classList.add('show');
  ['li-d1', 'li-d2', 'li-d3'].forEach((id, i) =>
    document.getElementById(id).classList.toggle('used', i >= (3 - n))
  );
}

function resetDots() {
  loginAttempts = 0;
  document.getElementById('li-attempts').classList.remove('show');
}

// ── Login ───────────────────────────────────────
async function doLogin() {
  const email = document.getElementById('li-email').value.trim();
  const pass  = document.getElementById('li-pass').value;
  hideAlert('li-alert');

  let ok = true;
  if (!email) { setFieldError('li-email', 'li-email-err', 'Email is required.');    ok = false; }
  if (!pass)  { setFieldError('li-pass',  'li-pass-err',  'Password is required.'); ok = false; }
  if (!ok) return;

  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password: pass })
    });
    const data = await res.json();

    if (data.success) {
      resetDots();
      enterDashboard(data.user);
    } else {
      loginAttempts++;
      updateDots(loginAttempts);
      const left = 3 - loginAttempts;
      showAlert('li-alert', `${data.message}${left > 0 ? ` (${left} attempt${left === 1 ? '' : 's'} left)` : ''}`);
    }
  } catch {
    showAlert('li-alert', 'Network error. Is the server running?');
  }
}

// ── Register ────────────────────────────────────
async function doRegister() {
  const fname = document.getElementById('su-fname').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const pass  = document.getElementById('su-pass').value;
  const pass2 = document.getElementById('su-pass2').value;

  [['su-fname','su-fname-err'],['su-email','su-email-err'],['su-pass','su-pass-err'],['su-pass2','su-pass2-err']]
    .forEach(([i, e]) => setFieldError(i, e, ''));
  hideAlert('su-alert');

  let ok = true;
  if (!fname) { setFieldError('su-fname', 'su-fname-err', 'Full name is required.'); ok = false; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFieldError('su-email', 'su-email-err', 'Enter a valid email.'); ok = false; }
  if (pass.length < 6) { setFieldError('su-pass', 'su-pass-err', 'Min 6 characters.'); ok = false; }
  if (pass !== pass2)  { setFieldError('su-pass2', 'su-pass2-err', 'Passwords do not match.'); ok = false; }
  if (!ok) return;

  try {
    const res  = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ full_name: fname, email, password: pass, confirm_password: pass2 })
    });
    const data = await res.json();

    if (data.success) {
      goTo('screen-login');
      showAlert('li-success', 'Account created! Please log in.', 'success');
    } else if (data.errors) {
      const map = {
        email:            ['su-email',  'su-email-err'],
        full_name:        ['su-fname',  'su-fname-err'],
        password:         ['su-pass',   'su-pass-err'],
        confirm_password: ['su-pass2',  'su-pass2-err']
      };
      data.errors.forEach(e => {
        if (map[e.field]) setFieldError(...map[e.field], e.message);
        else showAlert('su-alert', e.message);
      });
    } else {
      showAlert('su-alert', data.message || 'Registration failed.');
    }
  } catch {
    showAlert('su-alert', 'Network error.');
  }
}

// ── Logout ──────────────────────────────────────
async function doLogout() {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
  currentUser = null;
  allEvents   = [];
  allRSVPs    = [];
  document.getElementById('app-layout').classList.remove('active');
  document.getElementById('auth-topbar').style.display = '';
  document.getElementById('app-footer').style.display  = '';
  goTo('screen-login');
}