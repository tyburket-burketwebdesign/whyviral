/* Auth and data access for the Edge runtime.
   No SDK: Supabase is a REST API and JWTs are plain HS256, so fetch and
   Web Crypto cover it. Keeps the bundle small and the behaviour obvious. */

const b64urlToBytes = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};

const bytesToText = (b) => new TextDecoder().decode(b);

/* JWKS cache. Supabase projects created recently sign tokens with an ECC key
   pair (ES256) rather than a shared secret, so the public key has to be fetched
   and cached rather than read from an env var. */
let _jwks = { keys: null, at: 0 };

async function getJwks(supabaseUrl) {
  if (_jwks.keys && Date.now() - _jwks.at < 600000) return _jwks.keys;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
    if (!res.ok) return _jwks.keys;
    const body = await res.json();
    if (Array.isArray(body?.keys)) { _jwks = { keys: body.keys, at: Date.now() }; }
    return _jwks.keys;
  } catch { return _jwks.keys; }
}

const ALGS = {
  ES256: { name: 'ECDSA', namedCurve: 'P-256', verify: { name: 'ECDSA', hash: 'SHA-256' } },
  RS256: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', verify: { name: 'RSASSA-PKCS1-v1_5' } },
};

/* Verify a Supabase access token. Returns the claims, or null.
   Handles both signing models: HS256 with the project's JWT secret, and
   ES256/RS256 against the published JWKS. Never throws — a malformed token
   from the internet is expected input. */
export async function verifyToken(token, secret, supabaseUrl) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headB64, bodyB64, sigB64] = parts;

  try {
    const header = JSON.parse(bytesToText(b64urlToBytes(headB64)));
    const signed = new TextEncoder().encode(`${headB64}.${bodyB64}`);
    const sig = b64urlToBytes(sigB64);
    let ok = false;

    if (header.alg === 'HS256') {
      if (!secret) return null;
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
      );
      ok = await crypto.subtle.verify('HMAC', key, sig, signed);
    } else if (ALGS[header.alg]) {
      if (!supabaseUrl) return null;
      const keys = await getJwks(supabaseUrl);
      if (!keys) return null;
      const jwk = keys.find(k => k.kid === header.kid) || keys[0];
      if (!jwk) return null;
      const spec = ALGS[header.alg];
      const key = await crypto.subtle.importKey('jwk', jwk,
        spec.name === 'ECDSA' ? { name: 'ECDSA', namedCurve: spec.namedCurve }
                              : { name: spec.name, hash: spec.hash },
        false, ['verify']);
      ok = await crypto.subtle.verify(spec.verify, key, sig, signed);
    } else {
      return null;   /* alg:none and anything unrecognised */
    }

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
export async function resolveAccount(env, { claims, deviceId, create = false }) {
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

  /* Only create on demand. /api/account runs on every page load, so creating
     here filled the table with empty rows — one per visitor, per browser. */
  if (!create) return null;

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
