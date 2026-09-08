/* POST /api/profile
   Saves the sign-up profile. Server-side because every field here is either a
   legal record or an abuse signal, and neither can be trusted from the client. */

import { verifyToken, bearerFrom, resolveAccount, dbPatch } from './_auth.js';
import { normalizeEmail, isDisposable } from './_abuse.js';

const json = (b, s = 200) => new Response(JSON.stringify(b), {
  status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

/* Old enough to hold the card this account will require. Also keeps you clear
   of the child-privacy rules that apply to a younger audience. */
const MIN_AGE = 18;

function ageFrom(birthdate) {
  const d = new Date(birthdate + 'T00:00:00Z');
  if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

/* Keep digits, allow a leading +. Deliberately permissive: rejecting valid
   international numbers is worse than storing an odd one. */
function normalizePhone(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return false;   // false = invalid
  return s.startsWith('+') ? '+' + digits : digits;
}

async function onRequest({ request, env }) {
  if (!env.SUPABASE_URL) return json({ error: 'not_configured' }, 503);

  const token = bearerFrom(request);
  const claims = token ? await verifyToken(token, env.SUPABASE_JWT_SECRET, env.SUPABASE_URL) : null;
  if (!claims) return json({ error: 'signin_required' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const fullName = String(body.fullName || '').trim().slice(0, 120);
  if (fullName.length < 2) return json({ error: 'name_required', message: 'Tell us your name.' }, 400);

  const email = claims.email || '';
  if (email && isDisposable(email)) {
    return json({ error: 'disposable_email', message: 'Please use a permanent email address.' }, 400);
  }

  /* Birthdate is optional now that sign-up doesn't ask for it. When it IS
     supplied — a later profile screen, say — it's still checked, because an
     under-age account is a problem wherever it comes from. */
  if (body.birthdate) {
    const age = ageFrom(String(body.birthdate));
    if (age === null || age > 120) return json({ error: 'birthdate_invalid', message: 'That date does not look right.' }, 400);
    if (age < MIN_AGE) return json({ error: 'too_young', message: `You need to be ${MIN_AGE} or older to use WhyViral.` }, 403);
  }

  let phone = null;
  const phoneConsent = body.phoneConsent === true;
  if (body.phone) {
    phone = normalizePhone(body.phone);
    if (phone === false) return json({ error: 'phone_invalid', message: 'That phone number does not look right.' }, 400);
    /* A number with no consent is a number you may not text. Store it, but
       never let the consent flag be set without the number. */
  }
  if (phoneConsent && !phone) {
    return json({ error: 'phone_required', message: 'Add a phone number or untick the consent box.' }, 400);
  }

  const url = new URL(request.url);
  const deviceId = (url.searchParams.get('device') || request.headers.get('x-device-id') || '').slice(0, 64) || null;
  const account = await resolveAccount(env, { claims, deviceId, create: true });
  if (!account) return json({ error: 'no_account' }, 400);

  const patch = {
    full_name: fullName,
    email_normalized: normalizeEmail(email),
    marketing_opt_in: body.marketingOptIn === true,
    ...(body.birthdate ? { birthdate: String(body.birthdate) } : {}),
    last_seen_at: new Date().toISOString(),
  };
  if (phone) {
    patch.phone = phone;
    patch.phone_consent = phoneConsent;
    if (phoneConsent) {
      /* The record that matters if anyone ever asks: the exact wording shown,
         and when they agreed to it. */
      patch.consent_text = String(body.consentText || '').slice(0, 1000);
      patch.consent_at = new Date().toISOString();
    }
  }

  try {
    await dbPatch(env, `/accounts?id=eq.${account.id}`, patch);
    return json({ ok: true, name: fullName });
  } catch (e) {
    return json({ error: 'save_failed', message: String(e.message || e) }, 502);
  }
}

export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization, x-device-id',
    } });
  }
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  return onRequest({ request, env: process.env });
}
