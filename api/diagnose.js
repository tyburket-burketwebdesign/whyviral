/* GET /api/diagnose
   Walks the whole billing chain and reports which link is broken.

   Deliberately returns no secrets — only whether each value is present, and
   what Stripe and the database actually hold for this account. Requires a
   signed-in token, so it exposes nothing a customer could not already see
   about themselves. */

import { verifyToken, bearerFrom, resolveAccount, getEntitlement, dbSelect } from './_auth.js';
import { stripe } from './_stripe.js';

const json = (b, s = 200) => new Response(JSON.stringify(b, null, 2), {
  status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

async function onRequestGet({ request, env }) {
  const report = { ok: false, checks: [], verdict: '', fix: '' };
  const add = (name, pass, detail) => report.checks.push({ name, pass, detail });

  /* 1. configuration */
  add('SUPABASE_URL set', !!env.SUPABASE_URL, env.SUPABASE_URL ? 'present' : 'missing');
  add('SUPABASE_SERVICE_KEY set', !!env.SUPABASE_SERVICE_KEY, env.SUPABASE_SERVICE_KEY ? 'present' : 'missing');
  add('STRIPE_SECRET_KEY set', !!env.STRIPE_SECRET_KEY,
      env.STRIPE_SECRET_KEY ? (env.STRIPE_SECRET_KEY.startsWith('sk_live') ? 'live mode' : 'test mode') : 'missing');
  add('STRIPE_PRICE_ID set', !!env.STRIPE_PRICE_ID, env.STRIPE_PRICE_ID ? 'present' : 'missing');
  add('STRIPE_WEBHOOK_SECRET set', !!env.STRIPE_WEBHOOK_SECRET, env.STRIPE_WEBHOOK_SECRET ? 'present' : 'missing');
  add('TRIAL_MODE', true, (env.TRIAL_MODE || 'free').toLowerCase());

  /* 2. identity */
  const token = bearerFrom(request);
  const claims = token ? await verifyToken(token, env.SUPABASE_JWT_SECRET, env.SUPABASE_URL) : null;
  add('request carried a token', !!token, token ? 'yes' : 'no — sign in and try again');
  add('token verified', !!claims, claims ? `user ${claims.sub}` : 'rejected — JWT settings mismatch');
  if (!claims) {
    report.verdict = 'Not signed in, or the token could not be verified.';
    report.fix = 'Sign in again. If it keeps failing, the project JWT settings do not match what the API expects.';
    return json(report, 200);
  }
  report.email = claims.email || null;

  /* 3. the account row */
  let account = null, ent = null;
  try {
    const url = new URL(request.url);
    const deviceId = (url.searchParams.get('device') || request.headers.get('x-device-id') || '').slice(0, 64) || null;
    account = await resolveAccount(env, { claims, deviceId, create: true });
    add('account row found', !!account, account ? `id ${account.id}` : 'none');
    if (account) {
      add('profile name saved', !!account.full_name, account.full_name || 'missing — sign-up did not save it');
      report.accountId = account.id;
      report.accountEmail = account.email;
    }

    /* Duplicate accounts for one email are a real cause of "I paid but it
       says I have not": the payment attaches to one row, the session to another. */
    if (claims.email) {
      const same = await dbSelect(env, `/accounts?email=eq.${encodeURIComponent(claims.email)}&select=id,auth_user_id,created_at`);
      add('one account per email', (same || []).length <= 1,
          `${(same || []).length} row(s) for ${claims.email}`);
      report.accountsForEmail = (same || []).map(a => a.id);
    }

    ent = account ? await getEntitlement(env, account.id) : null;
    add('entitlement row exists', !!ent, ent ? `status ${ent.status}, plan ${ent.plan}` : 'none');
    if (ent) {
      add('stripe customer linked', !!ent.stripe_customer_id, ent.stripe_customer_id || 'not linked');
      add('subscription recorded', !!ent.stripe_subscription_id, ent.stripe_subscription_id || 'none');
      report.entitlement = {
        status: ent.status, plan: ent.plan, trial_used: ent.trial_used,
        current_period_end: ent.current_period_end,
      };
    }
  } catch (e) {
    add('database reachable', false, String(e.message || e));
    report.verdict = 'The database could not be read.';
    report.fix = 'Check SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel, then redeploy.';
    return json(report, 200);
  }

  /* 4. what Stripe actually has */
  if (!env.STRIPE_SECRET_KEY) {
    report.verdict = 'Stripe is not configured.';
    report.fix = 'Add STRIPE_SECRET_KEY in Vercel and redeploy.';
    return json(report, 200);
  }

  try {
    let customerId = ent?.stripe_customer_id;
    let byEmail = [];
    if (claims.email) {
      const found = await stripe(env, `/customers?email=${encodeURIComponent(claims.email)}&limit=5`, null, 'GET');
      byEmail = (found?.data || []).map(c => c.id);
      add('stripe customer for this email', byEmail.length > 0,
          byEmail.length ? byEmail.join(', ') : 'none in this Stripe mode');
      if (!customerId) customerId = byEmail[0];
    }
    report.stripeCustomers = byEmail;

    if (!customerId) {
      report.verdict = 'Stripe has no customer for this email in the current mode.';
      report.fix = 'Either checkout was never completed, or it was completed in the other Stripe mode (test vs live). Check STRIPE_SECRET_KEY matches where you paid.';
      return json(report, 200);
    }

    const subs = await stripe(env, `/subscriptions?customer=${customerId}&status=all&limit=10`, null, 'GET');
    const list = (subs?.data || []).map(s => ({ id: s.id, status: s.status, cancel_at_period_end: !!s.cancel_at_period_end }));
    add('stripe has a subscription', list.length > 0, list.length ? list.map(s => `${s.id} (${s.status})`).join(', ') : 'none');
    report.stripeSubscriptions = list;

    const live = list.find(s => ['trialing', 'active'].includes(s.status));
    const dbActive = ent && ['trialing', 'active'].includes(ent.status);

    if (live && !dbActive) {
      report.verdict = 'Stripe says you are subscribed but the database does not. The webhook never wrote it.';
      report.fix = 'Open Settings and tap "Refresh subscription" — that pulls it straight from Stripe. To fix it permanently, check the webhook endpoint URL and that its signing secret matches STRIPE_WEBHOOK_SECRET, in the same Stripe mode.';
    } else if (!live && dbActive) {
      report.verdict = 'The database thinks you are subscribed but Stripe does not.';
      report.fix = 'Tap "Refresh subscription" in Settings to correct it.';
    } else if (live && dbActive) {
      report.ok = true;
      report.verdict = 'Everything matches. You are subscribed.';
      report.fix = 'If the app still shows a trial prompt, hard refresh the page.';
    } else {
      report.verdict = 'No active subscription in Stripe or the database.';
      report.fix = list.length
        ? 'There is a subscription but it is not active — it may be cancelled or the payment failed.'
        : 'Checkout has not been completed successfully in this Stripe mode.';
    }
  } catch (e) {
    add('stripe reachable', false, String(e.message || e));
    report.verdict = 'Stripe could not be reached.';
    report.fix = 'Check STRIPE_SECRET_KEY is valid and for the right mode.';
  }

  return json(report, 200);
}

export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  return onRequestGet({ request, env: process.env });
}
