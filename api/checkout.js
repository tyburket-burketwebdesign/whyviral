/* POST /api/checkout
   Creates a Stripe Checkout Session and returns its URL.

   Hosted Checkout, deliberately: you never touch card data, PCI scope stays
   near zero, and Stripe handles trials, tax, 3-D Secure and failed-payment
   retries. Building a card form would cost a week and add liability. */

import { verifyToken, bearerFrom, resolveAccount, getEntitlement, dbPatch, trialAlreadyUsed } from './_auth.js';
import { trialSignals, isDisposable, normalizeEmail } from './_abuse.js';
import { stripe } from './_stripe.js';

const json = (b, s = 200) => new Response(JSON.stringify(b), {
  status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

async function onRequest({ request, env }) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) {
    return json({ error: 'not_configured', message: 'Billing is not switched on yet.' }, 503);
  }

  /* Subscriptions attach to an email, so sign-in comes first. */
  const token = bearerFrom(request);
  const claims = token ? await verifyToken(token, env.SUPABASE_JWT_SECRET) : null;
  if (!claims) return json({ error: 'signin_required', message: 'Sign in first so we can attach your subscription.' }, 401);

  const url = new URL(request.url);
  const deviceId = (url.searchParams.get('device') || request.headers.get('x-device-id') || '').slice(0, 64) || null;
  const account = await resolveAccount(env, { claims, deviceId, create: true });
  const ent = await getEntitlement(env, account.id);

  if (ent.status === 'active' || ent.status === 'trialing') {
    return json({ error: 'already_subscribed', message: 'You already have an active subscription.' }, 409);
  }

  const origin = env.SITE_URL || url.origin;
  const annual = url.searchParams.get('plan') === 'annual';
  const priceId = annual && env.STRIPE_PRICE_ID_ANNUAL ? env.STRIPE_PRICE_ID_ANNUAL : env.STRIPE_PRICE_ID;

  /* One trial per account, ever — otherwise cancel-and-resubscribe is an
     unlimited free tier. */
  let trialDays = ent.trial_used > 0 ? 0 : Number(env.TRIAL_DAYS || 7);

  /* And one trial per person. Email and device are checkable now; the card
     fingerprint only exists after payment, so the webhook handles that. */
  const email = account.email || claims.email;
  if (trialDays > 0) {
    if (isDisposable(email)) {
      trialDays = 0;
    } else {
      const used = await trialAlreadyUsed(env, account.id,
        trialSignals({ email, deviceId })).catch(() => false);
      if (used) trialDays = 0;
    }
  }

  try {
    const session = await stripe(env, '/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
      client_reference_id: account.id,
      ...(ent.stripe_customer_id ? { customer: ent.stripe_customer_id } : { customer_email: account.email || claims.email }),
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      subscription_data: {
        ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
        metadata: { account_id: account.id },
      },
      /* Card required up front, and a trial that ends rather than lapsing
         silently if the card is later removed. */
      payment_method_collection: 'always',
      metadata: { account_id: account.id },
    });

    if (session.customer && !ent.stripe_customer_id) {
      await dbPatch(env, `/entitlements?account_id=eq.${account.id}`, { stripe_customer_id: session.customer });
    }
    return json({ url: session.url, trialDays });
  } catch (e) {
    return json({ error: 'stripe_failed', message: e.message || 'Could not start checkout.' }, 502);
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
  if (request.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }
  return onRequest({ request, env: process.env });
}
