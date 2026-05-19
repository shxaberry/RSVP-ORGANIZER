// ═══════════════════════════════════════════════
//  auth.js — Auth module (session check helper)
//  The actual form handlers live in helpers.js.
//  This module is kept for API-call reuse.
// ═══════════════════════════════════════════════

const Auth = (() => {

  async function checkSession() {
    const data = await api('GET', '/api/auth/me');
    if (data.success && data.user) {
      State && State.setUser && State.setUser(data.user);
      return data.user;
    }
    return null;
  }

  async function logout() {
    await api('POST', '/api/auth/logout');
  }

  return { checkSession, logout };
})();