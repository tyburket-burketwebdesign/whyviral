# Turning on accounts and billing

Nothing here is required. With `SUPABASE_URL` unset the app behaves exactly as
it does today — no sign-in, no limits, every route open. Add the variables and
the gate switches on.

## 1. Supabase (10 minutes)

1. supabase.com → New project. Free tier is fine to launch.
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
3. **Settings → API**, copy three values:
   - Project URL → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_KEY` (server-side only, never in `public/`)
   - JWT Secret → `SUPABASE_JWT_SECRET`
4. **Authentication → Providers → Email**: turn on, and turn OFF "Confirm email"
   (magic links confirm by themselves).
5. **Authentication → URL Configuration**: set Site URL to your live domain and
   add it to Redirect URLs.

Add those three to Vercel → Settings → Environment Variables, all three
environments, then redeploy.

Then put the two publishable values into `public/index.html`:

```js
window.WHYVIRAL_CONFIG = {
  supabaseUrl: "https://yourproject.supabase.co",
  supabaseAnonKey: "eyJ...anon key..."
};
```

The anon key is designed to be public. The service key and JWT secret are not —
they stay in Vercel's environment and never appear in `public/`.

## 2. How the trial works

Three analyses, not three days. A clock punishes someone who signs up on a busy
week; a usage limit triggers exactly when they have found the thing useful. At
roughly 3 cents per analysis the exposure is about 9 cents per tyre-kicker.

Change `trial_limit` in the `entitlements` table to adjust it.

The first analysis needs no email at all — identity comes from a device id in
the browser. When someone signs in later, `resolveAccount` claims that
anonymous row so their trial count and history carry over instead of resetting.

## 3. Where the gate lives

`api/_gate.js`, called at the top of `/api/enrich` and `/api/control`, before
any provider call. That ordering matters twice: an unauthorised request never
spends an API credit, and the paywall cannot be skipped by reading the
front-end JavaScript and calling the endpoints directly.

The gate returns a reason rather than a boolean, so the UI can explain itself.

Usage is only committed after the work succeeds. Charging a trial credit for a
failed analysis is the kind of thing people cancel over.

If Supabase is unreachable the gate **fails open**. A database blip locking out
paying customers is worse than a few free analyses.

## 4. Dev mode

`DEV_UNLIMITED=you@yourdomain.com` — comma-separated. Those accounts skip the
gate entirely and their usage is not counted.

## 5. Stripe (not built yet)

The gate reads `entitlements.status`, so Stripe only has to write to that table.
What remains:

- `api/checkout.js` — create a Checkout Session, return `url`
- `api/portal.js` — create a Billing Portal session
- `api/stripe-webhook.js` — on `checkout.session.completed`,
  `customer.subscription.updated` and `.deleted`, write `status`,
  `stripe_customer_id`, `stripe_subscription_id`, `current_period_end`

Use hosted Checkout and the hosted Billing Portal. You never touch card data,
PCI scope stays near zero, and Stripe handles trials, tax and failed-payment
retries. The Customer Portal alone is roughly two weeks of UI you do not build.

Rule to hold to: **Stripe is the source of truth, the table is a cache.** Never
compute subscription state locally. The one exception is already handled — a
`current_period_end` more than a day in the past is treated as stale rather than
as access, which catches a webhook that never landed.

Test with Stripe's **test clock** to fast-forward trials and failed payments
instead of waiting days.
