/* Auth and entitlement state for the browser.

   Classic script, same as the rest of the app. Talks to Supabase over plain
   REST — no SDK — so nothing has to be bundled and file:// keeps working. */

const WV_AUTH = (function () {
  const SESSION_KEY = 'whyviral.session.v1';
  const DEVICE_KEY = 'whyviral.device.v1';

  /* Stable per-browser id. Guards free-tier counting only, and the server
     treats it as a hint rather than a credential. */
  function deviceId() {
    try {
      let d = localStorage.getItem(DEVICE_KEY);
      if (!d) {
        d = 'd_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
        localStorage.setItem(DEVICE_KEY, d);
      }
      return d;
    } catch { return 'd_ephemeral'; }
  }

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }
  function writeSession(s) {
    try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch {}
  }

  const expired = s => !s?.expires_at || s.expires_at * 1000 < Date.now() + 30000;

  /* Config comes from the page so the keys aren't buried in JS. Both are
     publishable values — the anon key is designed to be public. */
  const cfg = () => (window.WHYVIRAL_CONFIG || {});
  const configured = () => !!(cfg().supabaseUrl && cfg().supabaseAnonKey);

  async function sb(path, init = {}) {
    const { supabaseUrl, supabaseAnonKey } = cfg();
    const res = await fetch(`${supabaseUrl}${path}`, {
      ...init,
      headers: { apikey: supabaseAnonKey, 'content-type': 'application/json', ...(init.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error_description || body.msg || body.error || `auth ${res.status}`);
    return body;
  }

  /* Refresh rather than sign out — a magic link every hour is a terrible
     experience and the main reason people abandon passwordless apps. */
  async function refresh(session) {
    if (!session?.refresh_token) return null;
    try {
      const r = await sb('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      const next = { ...r, expires_at: Math.floor(Date.now() / 1000) + (r.expires_in || 3600) };
      writeSession(next);
      return next;
    } catch { writeSession(null); return null; }
  }

  async function currentSession() {
    let s = readSession();
    if (!s) return null;
    if (expired(s)) s = await refresh(s);
    return s;
  }

  async function sendMagicLink(email) {
    if (!configured()) throw new Error('Sign-in is not configured yet.');
    await sb('/auth/v1/otp', {
      method: 'POST',
      body: JSON.stringify({ email, create_user: true, options: { email_redirect_to: location.origin } }),
    });
    return true;
  }

  /* Supabase returns the session in the URL fragment. Read it, store it, and
     strip it from the address bar so tokens don't sit in history. */
  function captureRedirect() {
    if (!location.hash || location.hash.length < 10) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    const access_token = p.get('access_token');
    if (!access_token) return false;
    writeSession({
      access_token,
      refresh_token: p.get('refresh_token'),
      expires_at: Math.floor(Date.now() / 1000) + Number(p.get('expires_in') || 3600),
    });
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }

  function signOut() {
    writeSession(null);
  }

  /* Every API call goes through this, so identity is attached in one place. */
  async function apiFetch(path, init = {}) {
    const s = await currentSession();
    const headers = { ...(init.headers || {}), 'x-device-id': deviceId() };
    if (s?.access_token) headers.authorization = `Bearer ${s.access_token}`;
    return fetch(path, { ...init, headers });
  }

  let cached = null;
  async function status(force = false) {
    if (cached && !force) return cached;
    try {
      const r = await apiFetch('/api/account');
      cached = await r.json();
    } catch {
      cached = { billing: false, signedIn: false, plan: 'open', remaining: null };
    }
    return cached;
  }

  return {
    deviceId, currentSession, sendMagicLink, captureRedirect, signOut,
    apiFetch, status, configured,
    invalidate: () => { cached = null; },
    isSignedIn: async () => !!(await currentSession()),
  };
})();
