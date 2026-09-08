/* GET /api/account
   What the front end needs to render the right state: signed in or not, trial
   remaining, subscription status. Never returns anything secret. */

import { verifyToken, bearerFrom, resolveAccount, getEntitlement } from './_auth.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

async function onRequestGet({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    /* Billing not configured — the app is open. */
    return json({ billing: false, signedIn: false, plan: 'open', remaining: null });
  }

  const url = new URL(request.url);
  const deviceId = (url.searchParams.get('device') || request.headers.get('x-device-id') || '').slice(0, 64) || null;
  const token = bearerFrom(request);
  const claims = token ? await verifyToken(token, env.SUPABASE_JWT_SECRET) : null;
  if (token && !claims) return json({ billing: true, signedIn: false, error: 'bad_token' }, 401);

  try {
    const account = await resolveAccount(env, { claims, deviceId });
    if (!account) return json({ billing: true, signedIn: false, plan: 'free', remaining: null });

    const ent = await getEntitlement(env, account.id);
    const active = ent.status === 'active' || ent.status === 'trialing';

    return json({
      billing: true,
      signedIn: !!claims,
      email: account.email || null,
      name: account.full_name || null,
      plan: ent.plan,
      status: ent.status,
      subscribed: active,
      trialMode: (env.TRIAL_MODE || 'free').toLowerCase(),
      trialDays: Number(env.TRIAL_DAYS || 7),
      remaining: active ? null
        : ((env.TRIAL_MODE || 'free').toLowerCase() === 'card' ? 0
           : Math.max(0, ent.trial_limit - ent.trial_used)),
      trialLimit: ent.trial_limit,
      renewsAt: ent.current_period_end || null,
      cancelAtPeriodEnd: !!ent.cancel_at_period_end,
    });
  } catch (e) {
    return json({ billing: true, signedIn: !!claims, plan: 'free', remaining: null, degraded: true }, 200);
  }
}

export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization, x-device-id',
      },
    });
  }
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { 'content-type': 'application/json', allow: 'GET, OPTIONS' },
    });
  }
  return onRequestGet({ request, env: process.env });
}
