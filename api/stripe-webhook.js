/* POST /api/stripe-webhook
   Stripe tells us what happened; we cache it in `entitlements`.

   Two rules this file exists to enforce:

   1. Verify the signature before trusting anything. This URL is public, so
      without verification anyone could POST a fake "subscription active" event
      and grant themselves an account.

   2. Stripe is the source of truth. This handler only ever writes what Stripe
      reports. It never decides subscription state on its own. */

import { verifyWebhook, mapStatus, stripe } from './_stripe.js';
import { dbSelect, dbPatch, claimTrial } from './_auth.js';
import { trialSignals } from './_abuse.js';

const ok = (body = { received: true }) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' },
});

/* Find the account this event belongs to: by explicit id where Stripe carries
   one, otherwise by the customer id recorded at checkout. */
async function findAccountId(env, { accountId, customerId }) {
  if (accountId) return accountId;
  if (!customerId) return null;
  const rows = await dbSelect(env, `/entitlements?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=account_id&limit=1`);
  return rows?.length ? rows[0].account_id : null;
}

/* Pull the card fingerprint off whatever payment method the subscription
   ended up with. Stripe exposes it on the payment method, not the sub. */
async function cardFingerprint(env, sub) {
  const pmId = sub.default_payment_method
    || (typeof sub.customer === 'string' ? null : sub.customer?.invoice_settings?.default_payment_method);
  if (pmId) {
    const pm = await stripe(env, `/payment_methods/${typeof pmId === 'string' ? pmId : pmId.id}`, null, 'GET');
    return pm?.card?.fingerprint || null;
  }
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return null;
  const list = await stripe(env, `/payment_methods?customer=${customerId}&type=card&limit=1`, null, 'GET');
  return list?.data?.[0]?.card?.fingerprint || null;
}

async function writeSubscription(env, accountId, sub) {
  await dbPatch(env, `/entitlements?account_id=eq.${accountId}`, {
    plan: 'pro',
    status: mapStatus(sub.status),
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    stripe_subscription_id: sub.id,
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    /* Mark the trial as spent so cancel-and-resubscribe can't farm new ones. */
    trial_used: 999,
    updated_at: new Date().toISOString(),
  });
}

async function onRequest({ request, env }) {
  if (!env.STRIPE_WEBHOOK_SECRET) return ok({ received: true, ignored: 'not_configured' });

  /* Raw body, not parsed JSON — the signature covers the exact bytes. */
  const raw = await request.text();
  const event = await verifyWebhook(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);

  if (!event) {
    return new Response(JSON.stringify({ error: 'invalid signature' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const obj = event.data?.object || {};

    switch (event.type) {
      case 'checkout.session.completed': {
        const accountId = await findAccountId(env, {
          accountId: obj.client_reference_id || obj.metadata?.account_id,
          customerId: obj.customer,
        });
        if (!accountId || !obj.subscription) break;
        /* The session carries only the subscription id, so fetch the real
           object rather than guessing at its status. */
        let sub = await stripe(env, `/subscriptions/${obj.subscription}`, null, 'GET');

        /* The card fingerprint is Stripe's stable hash of a card across every
           customer, so it is the one signal a repeat trialler cannot fake with
           a new email. It only exists now, after payment details were entered.

           If this card already claimed a trial, end the trial immediately
           rather than cancelling: they keep the subscription and are charged
           now. Repeat trials become paying customers instead of support
           tickets. */
        if (sub.status === 'trialing') {
          const fingerprint = await cardFingerprint(env, sub).catch(() => null);
          const acct = await dbSelect(env, `/accounts?id=eq.${accountId}&select=email,device_id&limit=1`).catch(() => null);
          const signals = trialSignals({
            email: acct?.[0]?.email, deviceId: acct?.[0]?.device_id, cardFingerprint: fingerprint,
          });
          const claim = await claimTrial(env, accountId, signals).catch(() => ({ granted: true }));
          if (!claim.granted) {
            sub = await stripe(env, `/subscriptions/${sub.id}`, { trial_end: 'now', proration_behavior: 'none' });
          }
        }

        await writeSubscription(env, accountId, sub);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const accountId = await findAccountId(env, {
          accountId: obj.metadata?.account_id,
          customerId: obj.customer,
        });
        if (!accountId) break;
        await writeSubscription(env, accountId, obj);
        break;
      }

      case 'invoice.payment_failed': {
        const accountId = await findAccountId(env, { customerId: obj.customer });
        if (!accountId) break;
        await dbPatch(env, `/entitlements?account_id=eq.${accountId}`, {
          status: 'past_due', updated_at: new Date().toISOString(),
        });
        break;
      }

      case 'invoice.paid': {
        const accountId = await findAccountId(env, { customerId: obj.customer });
        if (!accountId || !obj.subscription) break;
        const sub = await stripe(env, `/subscriptions/${obj.subscription}`, null, 'GET');
        await writeSubscription(env, accountId, sub);
        break;
      }

      default:
        break;   /* Unhandled event types are fine — acknowledge and move on. */
    }
  } catch (e) {
    /* 500 makes Stripe retry, which is what we want for a transient database
       failure. Returning 200 here would silently lose the event. */
    return new Response(JSON.stringify({ error: String(e.message || e) }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }

  return ok();
}

export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { 'content-type': 'application/json', allow: 'POST' },
    });
  }
  return onRequest({ request, env: process.env });
}
