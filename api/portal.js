/* POST /api/portal
   Returns a Stripe Billing Portal URL — cancel, update card, download invoices.
   Stripe hosts the whole thing, which is roughly two weeks of UI not built. */

import { verifyToken, bearerFrom, resolveAccount, getEntitlement } from './_auth.js';
import { stripe } from './_stripe.js';

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
  const account = await resolveAccount(env, { claims, deviceId, create: true });
  const ent = await getEntitlement(env, account.id);

  if (!ent.stripe_customer_id) {
    return json({ error: 'no_customer', message: 'No billing account yet — subscribe first.' }, 404);
  }

  try {
    const session = await stripe(env, '/billing_portal/sessions', {
      customer: ent.stripe_customer_id,
      return_url: env.SITE_URL || url.origin,
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: 'stripe_failed', message: e.message }, 502);
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
