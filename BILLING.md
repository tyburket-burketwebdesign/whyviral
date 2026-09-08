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

---

# Stripe

## 1. Create the products

Stripe Dashboard → **Product catalog → Add product**

- **WhyViral Pro** — recurring, **$29.00 / month**
- Add a second price on the same product — recurring, **$290.00 / year**

Copy both price ids (`price_...`). They are not the product id.

## 2. Environment variables

Vercel → Settings → Environment Variables, all three environments:

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` while testing, `sk_live_...` at launch |
| `STRIPE_PRICE_ID` | monthly price id |
| `STRIPE_PRICE_ID_ANNUAL` | annual price id |
| `STRIPE_WEBHOOK_SECRET` | from step 3 |
| `TRIAL_MODE` | `card` |
| `TRIAL_DAYS` | `7` |
| `SITE_URL` | `https://whyviral.io` |

## 3. The webhook

Stripe → **Developers → Webhooks → Add endpoint**

- URL: `https://whyviral.io/api/stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.paid`, `invoice.payment_failed`

Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`, then redeploy.

The signature is verified before anything is trusted. Without that, this URL is
public and anyone could POST a fake "subscription active" event to grant
themselves an account.

## 4. Enable the Billing Portal

Stripe → **Settings → Billing → Customer portal** → activate. Allow customers to
cancel and update payment methods. `/api/portal` returns a link to it, so cancel
and card-update flows are handled by Stripe rather than built here.

## 5. Test before going live

Use test keys and card `4242 4242 4242 4242`, any future expiry, any CVC.

1. Sign in, click **Start free trial** → Stripe Checkout appears
2. Complete it → you land back on the site
3. `/api/account` should report `"status":"trialing"` and `"subscribed":true`
4. Run an analysis — it should work
5. Cancel via **Manage billing** → status becomes `canceled` at period end

Use Stripe's **test clock** to fast-forward trial expiry and failed payments
rather than waiting seven days.

## 6. Switching the trial model

`TRIAL_MODE=card` — account and card up front, Stripe runs the trial.
`TRIAL_MODE=free` — three analyses, no card, first one without signup.

One variable, no code change. Card-required converts better per signup but
typically cuts total signups by 60–80%. If signups look thin in week one, flip
to `free` and compare — the gate and the UI both follow the variable.

## 7. Two things already handled

**One trial per account, ever.** `trial_used` is set to 999 once a subscription
exists, so cancel-and-resubscribe cannot farm new trials.

**Stale subscriptions.** If `current_period_end` is more than a day in the past,
access is refused rather than granted — that catches a webhook that never
landed, which would otherwise be silent free access.

---

# Stopping repeat trials

The attack is not sophisticated: a second email for a second seven days. Three
signals catch nearly all of it.

| Signal | Beats | Strength |
|---|---|---|
| Normalised email | gmail dots, `+aliases`, casing | catches the laziest attempt |
| Device id | same browser, new email | medium — cleared cookies defeat it |
| **Card fingerprint** | new email, new browser | **strong — needs a different card** |

Plus a disposable-domain blocklist, so `mailinator.com` and friends never get a
trial at all.

## How it behaves

Email and device are checked at checkout, before the session is created. If
either was already used, `trial_period_days` is simply omitted — the person goes
straight to a paying subscription.

The card fingerprint only exists after payment details are entered, so the
webhook handles it. If the card already claimed a trial, the subscription's
trial is ended immediately rather than cancelled. **A repeat trialler becomes a
paying customer instead of a support ticket.**

Enforcement is the `trial_claims` primary key, not an application check.
Checking first and inserting after would race: two simultaneous checkouts would
both pass. Here the second insert simply fails.

## Deliberate choices

**Nobody is blocked from signing up**, only from a second free trial. Blocking
accounts outright creates support email and punishes real people.

**A shared device blocks a second trial.** Two people in one household on one
laptop, each with their own card, get one trial between them. That is a real
false positive. It is acceptable because the alternative — dropping the device
signal — leaves the second-easiest bypass wide open. If you get complaints,
remove `device` from `trialSignals()`; card fingerprint still holds the line.

**Failures fail open.** If the claims table is unreachable the trial is granted.
Losing a few trials to an outage beats blocking paying customers.

## What this does not stop

Someone with several real cards and several real email addresses. Stopping that
needs identity verification, which costs more in lost signups than the trials
are worth. Stripe Radar can add velocity rules later if it ever matters.

## Reset a trial by hand

```sql
delete from trial_claims where account_id = 'the-account-uuid';
update entitlements set trial_used = 0 where account_id = 'the-account-uuid';
```

Useful for a genuine false positive, or for grandfathering an early user.

---

# Sign-in: codes, not links

Magic links fail in practice. Outlook and Gmail prefetch links to scan them for
malware, which consumes a one-time link before the person ever clicks it. The
result is `otp_expired` on a link the user never opened.

Sign-in is therefore a **6-digit code**. A scanner cannot consume a code. The
emailed link still works when it survives, and a dead one now lands on the
sign-in screen with an explanation instead of a blank page.

## Supabase setup

**Authentication → Emails → Magic Link** — use `emails/code.html`, or at minimum:

```
<p>Your WhyViral sign-in code:</p>
<h2>{{ .Token }}</h2>
<p>The code expires in one hour.</p>
```

**No link.** The code and the magic link are the same one-time token, and email
scanners prefetch links — which consumes the token and kills the code in the
same email. That is why a freshly received code can come back "expired".

The app also verifies against all three Supabase token types (`email`,
`signup`, `magiclink`), because a first-time account issues `signup` and
verifying with the wrong type returns the same misleading "expired or invalid"
message.

**Authentication → URL Configuration**
- Site URL: `https://whyviral.io`
- Redirect URLs: `https://whyviral.io/**`

**Authentication → Providers → Email**
- Confirm email: **off** (a code confirms by itself)
- OTP expiry: 3600 seconds

## Note on the built-in email service

Supabase's default SMTP is rate limited to a handful of messages per hour and
is not meant for production. Before launch, connect your own sender under
**Project Settings → Authentication → SMTP Settings** — Resend, Postmark and
SendGrid all have free tiers. Skipping this means sign-in emails silently stop
arriving on your first busy day.

---

# Sign-up

Name, email, password, confirm password. That is all.

Birthdate, phone and SMS consent were removed: every field between a visitor and
the product costs signups, and none of those three did any work. `/api/profile`
still accepts and validates a birthdate if you add a profile screen later, and
the 18+ check still runs there.

## Password reset

A reset is a **link**, not a code. The link signs the person in with a temporary
recovery session and returns them to `/app.html#reset`, where they choose a new
password twice. Sending a code for a reset was wrong — there is nothing for a
code to do.

Supabase → Authentication → Emails → **Reset Password** must use
`emails/recovery.html`, which contains `{{ .ConfirmationURL }}` and no token.

Sign-in emails are different: those are codes, because a scanner prefetching a
sign-in link consumes it. A reset link is fine to prefetch — worst case the
person clicks a dead link and asks for another.

## Supabase settings this needs

**Authentication → Providers → Email**
- Enable Email provider
- **Confirm email: off.** With it on, sign-up returns no session and the person
  is stranded before they have seen anything. The code holds their name locally
  and writes it after they sign in, but it costs conversions.

## If sign-up fails

The form now shows what Supabase actually said instead of a generic failure.
The usual causes:
- "Email provider is disabled" — turn it on
- "Password should be at least 6 characters" — Supabase has its own minimum
- Nothing at all — check the browser console; a CORS or URL error means the
  Supabase URL in `public/app.html` is wrong

## Supabase redirect URLs — required

**Authentication → URL Configuration**

- Site URL: `https://whyviral.io`
- Redirect URLs, add all of these:
  - `https://whyviral.io/**`
  - `https://whyviral.io/app.html**`
  - `https://whyviral.vercel.app/**`

Supabase only honours a `redirect_to` that matches an entry in that list.
Anything else silently falls back to the Site URL — which is why a reset link
landed on the marketing homepage with an error fragment and nothing happened.

The site now forwards any auth fragment from `/` to `/app.html` before it
paints, so resets work even if this list is wrong. Set it anyway: the redirect
is one less hop and one less thing to explain.

## If a reset link says expired

- It was already used — each link works once
- It sat longer than the OTP expiry (Authentication → Providers → Email)
- Something opened it first. Rarer for resets than for sign-in links, but it
  happens on corporate mail

Whatever the cause, the person now lands on the sign-in card with a message
telling them to request a fresh one, instead of a homepage with a broken URL.
