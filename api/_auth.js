/* Auth and data access for the Edge runtime.
   No SDK: Supabase is a REST API and JWTs are plain HS256, so fetch and
   Web Crypto cover it. Keeps the bundle small and the behaviour obvious. */

const b64urlToBytes = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};

const bytesToText = (b) => new TextDecoder().decode(b);

/* Constant-time-ish compare. Web Crypto's verify does the real work; this is
   only used for the pre-check on segment counts. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* Verify a Supabase access token. Returns the claims, or null.
   Never throws — a malformed token from the internet is expected input. */
export async function verifyToken(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headB64, bodyB64, sigB64] = parts;
  try {
    const header = JSON.parse(bytesToText(b64urlToBytes(headB64)));
    if (header.alg !== 'HS256') return null;   // don't accept alg:none or RS256 downgrade

    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'HMAC', key, b64urlToBytes(sigB64),
      new TextEncoder().encode(`${headB64}.${bodyB64}`),
    );
    if (!ok) return null;

    const claims = JSON.parse(bytesToText(b64urlToBytes(bodyB64)));
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp === 'number' && claims.exp < now) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > now) return null;
    if (!claims.sub) return null;
    return claims;
  } catch { return null; }
}

export function bearerFrom(request) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/* ------------------------------------------------------------- data access */

const rest = (env) => `${env.SUPABASE_URL}/rest/v1`;

async function db(env, path, init = {}) {
  const res = await fetch(`${rest(env)}${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`supabase ${res.status}`), { status: res.status, body: body.slice(0, 300) });
  }
  return res.status === 204 ? null : res.json();
}

export const dbSelect = (env, path) => db(env, path);
export const dbInsert = (env, table, row, prefer = 'return=representation') =>
  db(env, `/${table}`, { method: 'POST', body: JSON.stringify(row), headers: { prefer } });
export const dbPatch = (env, path, patch) =>
  db(env, path, { method: 'PATCH', body: JSON.stringify(patch), headers: { prefer: 'return=representation' } });

/* Find or create the account for this request.

   Signed in  -> keyed on the Supabase user id, and claims any anonymous
                 account that shares the device id so early history survives.
   Anonymous  -> keyed on a device id from the browser. Spoofable by design;
                 it only guards free-tier counting, and IP rate limiting sits
                 in front of it. */
export async function resolveAccount(env, { claims, deviceId }) {
  if (claims) {
    const uid = claims.sub;
    const email = claims.email || null;
    const found = await dbSelect(env, `/accounts?auth_user_id=eq.${uid}&select=*&limit=1`);
    if (found?.length) {
      if (deviceId && !found[0].device_id) {
        await dbPatch(env, `/accounts?id=eq.${found[0].id}`, { device_id: deviceId, last_seen_at: new Date().toISOString() });
      }
      return { ...found[0], anonymous: false };
    }

    /* Claim the anonymous account created before sign-in, so the trial count
       and saved analyses carry over instead of resetting. */
    if (deviceId) {
      const anon = await dbSelect(env, `/accounts?device_id=eq.${encodeURIComponent(deviceId)}&auth_user_id=is.null&select=*&limit=1`);
      if (anon?.length) {
        const upgraded = await dbPatch(env, `/accounts?id=eq.${anon[0].id}`, {
          auth_user_id: uid, email, last_seen_at: new Date().toISOString(),
        });
        return { ...(upgraded?.[0] || anon[0]), anonymous: false };
      }
    }

    const created = await dbInsert(env, 'accounts', { auth_user_id: uid, email, device_id: deviceId || null });
    return { ...created[0], anonymous: false };
  }

  if (!deviceId) return null;

  const found = await dbSelect(env, `/accounts?device_id=eq.${encodeURIComponent(deviceId)}&select=*&limit=1`);
  if (found?.length) return { ...found[0], anonymous: !found[0].auth_user_id };

  const created = await dbInsert(env, 'accounts', { device_id: deviceId });
  return { ...created[0], anonymous: true };
}

export async function getEntitlement(env, accountId) {
  const rows = await dbSelect(env, `/entitlements?account_id=eq.${accountId}&select=*&limit=1`);
  if (rows?.length) return rows[0];
  /* The insert trigger normally handles this; this is the safety net. */
  const created = await dbInsert(env, 'entitlements', { account_id: accountId });
  return created[0];
}

export const recordUsage = (env, accountId, kind, meta = null) =>
  dbInsert(env, 'usage_events', { account_id: accountId, kind, meta }, 'return=minimal');

/* Try to reserve a trial against every identity signal at once.

   The database does the enforcement: (kind, value) is a primary key, so a
   duplicate insert fails. Checking first and inserting after would race — two
   simultaneous checkouts would both pass. */
export async function claimTrial(env, accountId, signals) {
  if (!signals?.length) return { granted: true, conflicts: [] };

  const conflicts = [];
  for (const s of signals) {
    const existing = await dbSelect(env,
      `/trial_claims?kind=eq.${encodeURIComponent(s.kind)}&value=eq.${encodeURIComponent(s.value)}&select=account_id&limit=1`);
    if (existing?.length) {
      if (existing[0].account_id !== accountId) conflicts.push(s.kind);
      continue;               /* already ours — not a conflict */
    }
    try {
      await dbInsert(env, 'trial_claims', { kind: s.kind, value: s.value, account_id: accountId }, 'return=minimal');
    } catch (e) {
      /* 409 means another request won the race for this signal. */
      if (e.status === 409) conflicts.push(s.kind); else throw e;
    }
  }
  return { granted: conflicts.length === 0, conflicts };
}

/* Read-only check, for deciding trial length before a card exists. */
export async function trialAlreadyUsed(env, accountId, signals) {
  for (const s of signals) {
    const rows = await dbSelect(env,
      `/trial_claims?kind=eq.${encodeURIComponent(s.kind)}&value=eq.${encodeURIComponent(s.value)}&select=account_id&limit=1`);
    if (rows?.length && rows[0].account_id !== accountId) return true;
  }
  return false;
}

export const bumpTrial = (env, accountId, used) =>
  dbPatch(env, `/entitlements?account_id=eq.${accountId}`, { trial_used: used + 1, updated_at: new Date().toISOString() });
