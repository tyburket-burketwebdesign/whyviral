/* Stripe for the Edge runtime.
   No SDK — Stripe is a form-encoded REST API and fetch covers it. */

const API = 'https://api.stripe.com/v1';

/* Stripe takes nested params as bracketed form keys:
   subscription_data[trial_period_days]=7 */
function encode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) encode(v, key, out);
    else if (Array.isArray(v)) v.forEach((item, i) => {
      if (typeof item === 'object') encode(item, `${key}[${i}]`, out);
      else out.append(`${key}[${i}]`, String(item));
    });
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe(env, path, params, method = 'POST') {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : encode(params || {}).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(body?.error?.message || `stripe ${res.status}`), {
      status: res.status, code: body?.error?.code,
    });
  }
  return body;
}

/* Verify a webhook signature.

   This is the security boundary for billing: without it, anyone who finds the
   webhook URL can POST a fake "subscription active" event and grant themselves
   a free account. Stripe signs `${timestamp}.${rawBody}` with HMAC-SHA256. */
export async function verifyWebhook(rawBody, sigHeader, secret, toleranceSec = 300) {
  if (!rawBody || !sigHeader || !secret) return null;

  const parts = Object.fromEntries(
    sigHeader.split(',').map(p => p.split('=').map(s => s.trim())).filter(p => p.length === 2),
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return null;

  /* Reject replays of an old, genuinely-signed event. */
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (!Number.isFinite(age) || age > toleranceSec) return null;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');

  /* Constant-time compare so a timing side channel can't leak the signature. */
  if (expected.length !== v1.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  if (diff !== 0) return null;

  try { return JSON.parse(rawBody); } catch { return null; }
}

/* Stripe's subscription status maps almost one-to-one onto ours. Anything
   unrecognised becomes 'canceled' — failing closed on billing is correct. */
export function mapStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'trialing': return 'trialing';
    case 'active': return 'active';
    case 'past_due':
    case 'unpaid': return 'past_due';
    case 'canceled':
    case 'incomplete_expired': return 'canceled';
    case 'incomplete': return 'none';
    default: return 'canceled';
  }
}
