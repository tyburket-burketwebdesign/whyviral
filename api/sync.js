/* POST /api/sync
   Pull the truth from Stripe instead of waiting for a webhook to push it.

   Webhooks fail in production for ordinary reasons: a wrong signing secret, an
   endpoint added in the wrong Stripe mode, an event type left unticked, a
   deploy that happened between the payment and the callback. Any of those
   leaves a paying customer looking unsubscribed with no way to fix it
   themselves. This endpoint asks Stripe what the subscription actually is and
   writes it, so the webhook becomes an optimisation rather than a dependency. */

import { verifyToken, bearerFrom, resolveAccount, getEntitlement, dbPatch } from './_auth.js';
import { stripe, mapStatus } from './_stripe.js';

const json = (b, s = 200) => new Response(JSON.stringify(b), {
  status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

async function onRequest({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'not_configured' }, 503);

  const token = bearerFrom(request);
  const claims = token ? await verifyToken(token, env.SUPABASE_JWT_SECRET, env.SUPABASE_URL) : null;
  if (!claims) return json({ error: 'signin_required' }, 401);

  const url = new URL(request.url);
  const deviceId = (url.searchParams.get('device') || request.headers.get('x-device-id') || '').slice(0, 64) || null;
  /* The account lookup can fail too — a database blip must return a readable
     error, not an unhandled 500. */
  let account, ent;
  try {
    account = await resolveAccount(env, { claims, deviceId, create: true });
    if (!account) return json({ error: 'no_account' }, 400);
    ent = await getEntitlement(env, account.id);
  } catch (e) {
    return json({ synced: false, reason: 'db_failed', message: String(e.message || e) }, 502);
  }
  const email = account.email || claims.email;

  try {
    let customerId = ent.stripe_customer_id;

    /* No customer recorded — find them by email. This is the case when the
       webhook never landed, since that is what normally records the id. */
    if (!customerId && email) {
      const found = await stripe(env, `/customers?email=${encodeURIComponent(email)}&limit=10`, null, 'GET');
      const match = (found?.data || [])[0];
      if (match) customerId = match.id;
    }
    if (!customerId) {
      return json({ synced: false, reason: 'no_customer',
                    message: 'No Stripe customer found for this email yet.' });
    }

    const subs = await stripe(env, `/subscriptions?customer=${customerId}&status=all&limit=10`, null, 'GET');
    const list = subs?.data || [];
    /* Prefer a live subscription over a cancelled one if both exist. */
    const rank = s => (['trialing', 'active'].includes(s.status) ? 0 : s.status === 'past_due' ? 1 : 2);
    list.sort((a, b) => rank(a) - rank(b) || (b.created || 0) - (a.created || 0));
    const sub = list[0];

    if (!sub) {
      await dbPatch(env, `/entitlements?account_id=eq.${account.id}`, {
        stripe_customer_id: customerId, updated_at: new Date().toISOString(),
      });
      return json({ synced: false, reason: 'no_subscription', customer: true,
                    message: 'Stripe has a customer but no subscription for this account.' });
    }

    const status = mapStatus(sub.status);
    await dbPatch(env, `/entitlements?account_id=eq.${account.id}`, {
      plan: 'pro',
      status,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      trial_used: 999,
      updated_at: new Date().toISOString(),
    });

    return json({
      synced: true,
      status,
      subscribed: status === 'active' || status === 'trialing',
      renewsAt: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    });
  } catch (e) {
    return json({ synced: false, reason: 'stripe_failed', message: e.message || String(e) }, 502);
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
