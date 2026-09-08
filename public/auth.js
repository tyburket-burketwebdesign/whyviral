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

  const saveSession = r => {
    writeSession({ ...r, expires_at: Math.floor(Date.now() / 1000) + (r.expires_in || 3600) });
    return r;
  };

  /* Create an account with an email and a password.

     Supabase hashes and stores the password; it never reaches our database or
     our code. If the project has email confirmation switched on, the response
     carries no session and the caller has to tell the person to confirm. */
  async function signUp(email, password) {
    if (!configured()) throw new Error('Sign-up is not configured yet.');
    const r = await sb('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (r.access_token) { saveSession(r); return { signedIn: true }; }
    return { signedIn: false, needsConfirmation: true };
  }

  async function signIn(email, password) {
    if (!configured()) throw new Error('Sign-in is not configured yet.');
    const r = await sb('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (!r.access_token) throw new Error('Wrong email or password.');
    saveSession(r);
    return true;
  }

  /* A reset is a link, not a code. The link signs them in with a temporary
     recovery session and returns to #reset, where they choose a new password
     twice. Sending a code here was wrong — there is nothing for a code to do. */
  async function sendReset(email) {
    if (!configured()) throw new Error('Not configured.');
    await sb('/auth/v1/recover', {
      method: 'POST',
      body: JSON.stringify({ email, redirect_to: location.origin + '/app.html#reset' }),
    });
    return true;
  }

  async function updatePassword(password) {
    const s = await currentSession();
    if (!s?.access_token) throw new Error('Your reset link expired. Request a new one.');
    const r = await sb('/auth/v1/user', {
      method: 'PUT',
      headers: { authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({ password }),
    });
    if (!r || r.error) throw new Error('Could not update your password.');
    return true;
  }

  /* Save the sign-up profile. Runs after the account exists, so the request
     carries a real token and the server can trust who it belongs to. */
  const PENDING_KEY = 'whyviral.pending_profile.v1';

  /* Hold a profile that could not be saved yet because sign-up returned no
     session. Small and local; cleared as soon as it is written. */
  function stashProfile(p) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch {}
  }

  async function flushProfile() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch {}
    if (!p) return false;
    try { await saveProfile(p); localStorage.removeItem(PENDING_KEY); return true; }
    catch { return false; }
  }

  async function saveProfile(profile) {
    const r = await apiFetch('/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(profile),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || 'Could not save your details.');
    return j;
  }

  /* Returns 'signed-in', an error string, or false. Supabase puts both the
     session and any failure in the URL fragment. */
  function captureRedirect() {
    if (!location.hash || location.hash.length < 10) return false;
    const p = new URLSearchParams(location.hash.slice(1));

    const errCode = p.get('error_code');
    if (errCode) {
      history.replaceState(null, '', location.pathname + location.search);
      return errCode === 'otp_expired'
        ? 'That link had already been used or expired. Email scanners often open links before you do — use the 6-digit code instead.'
        : (p.get('error_description') || 'Sign-in failed.').replace(/\+/g, ' ');
    }

    const access_token = p.get('access_token');
    if (!access_token) return false;
    const isRecovery = p.get('type') === 'recovery';
    writeSession({
      access_token,
      refresh_token: p.get('refresh_token'),
      expires_at: Math.floor(Date.now() / 1000) + Number(p.get('expires_in') || 3600),
    });
    history.replaceState(null, '', location.pathname + location.search);
    return isRecovery ? 'recovery' : 'signed-in';
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
    deviceId, currentSession, signUp, signIn, sendReset, updatePassword, saveProfile, stashProfile, flushProfile, captureRedirect, signOut,
    apiFetch, status, configured,
    invalidate: () => { cached = null; },
    isSignedIn: async () => !!(await currentSession()),
  };
})();
