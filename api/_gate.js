/* The gate. Every billable route calls this before doing any work.

   It lives in the API, not the UI. Anyone can read the front-end JavaScript,
   find the endpoints and call them directly, so a paywall enforced in the
   browser is decoration. This is the real one. */

import { verifyToken, bearerFrom, resolveAccount, getEntitlement, recordUsage, bumpTrial } from './_auth.js';

const ACTIVE = new Set(['active', 'trialing']);

/* Returns a reason, not a boolean. The UI can only say something useful about
   why someone is blocked if it is told why. */
export async function checkAccess(env, request) {
  /* Billing not configured yet: everything is open. Lets the app run exactly
     as it does today until the Stripe keys are added, so this layer can ship
     before the paywall does. */
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return { allowed: true, mode: 'open', account: null, entitlement: null };
  }

  const url = new URL(request.url);
  const deviceId = (url.searchParams.get('device') || request.headers.get('x-device-id') || '').slice(0, 64) || null;
  const token = bearerFrom(request);
  const claims = token ? await verifyToken(token, env.SUPABASE_JWT_SECRET) : null;

  /* A token that was sent but did not verify is a hard stop. Silently falling
     back to anonymous would let an expired or forged token buy free analyses. */
  if (token && !claims) {
    return { allowed: false, reason: 'bad_token', status: 401,
             message: 'Your session expired. Sign in again.' };
  }

  let account;
  try {
    account = await resolveAccount(env, { claims, deviceId });
  } catch (e) {
    /* Never let a database blip lock out a paying customer. Fail open on
       infrastructure, closed on entitlement. */
    return { allowed: true, mode: 'degraded', account: null, entitlement: null, error: String(e.message || e) };
  }

  if (!account) {
    return { allowed: false, reason: 'no_identity', status: 400,
             message: 'Could not identify this session. Reload the page and try again.' };
  }

  /* Dev bypass: comma-separated emails in one env var. */
  const devList = (env.DEV_UNLIMITED || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (account.email && devList.includes(account.email.toLowerCase())) {
    return { allowed: true, mode: 'dev', account, entitlement: null };
  }

  const ent = await getEntitlement(env, account.id);

  if (ACTIVE.has(ent.status)) {
    /* Trust Stripe's status, but a period end well in the past means the
       webhook never landed. Treat that as expired rather than free access. */
    if (ent.current_period_end && new Date(ent.current_period_end).getTime() < Date.now() - 86400000) {
      return { allowed: false, reason: 'subscription_stale', status: 402,
               message: 'We could not confirm your subscription. Open billing to check your card.',
               account, entitlement: ent };
    }
    return { allowed: true, mode: 'subscribed', account, entitlement: ent };
  }

  if (ent.trial_used < ent.trial_limit) {
    return {
      allowed: true, mode: 'trial', account, entitlement: ent,
      remaining: ent.trial_limit - ent.trial_used - 1,
    };
  }

  return {
    allowed: false, reason: 'trial_exhausted', status: 402,
    message: account.email
      ? `You have used all ${ent.trial_limit} free breakdowns. Subscribe to keep going.`
      : `You have used all ${ent.trial_limit} free breakdowns. Sign in to subscribe.`,
    account, entitlement: ent,
  };
}

/* Called only after the work succeeded. Charging a trial credit for a failed
   analysis is the kind of thing people cancel over. */
export async function commitUsage(env, access, kind = 'analysis', meta = null) {
  if (!access?.account || access.mode === 'open' || access.mode === 'degraded' || access.mode === 'dev') return;
  try {
    await recordUsage(env, access.account.id, kind, meta);
    if (access.mode === 'trial' && access.entitlement) {
      await bumpTrial(env, access.account.id, access.entitlement.trial_used);
    }
  } catch { /* usage logging must never fail the request */ }
}

export const denyResponse = (access) => new Response(JSON.stringify({
  error: access.reason,
  message: access.message,
  upgrade: access.reason === 'trial_exhausted' || access.reason === 'subscription_stale',
}), {
  status: access.status || 402,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
