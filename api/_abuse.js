/* Trial abuse prevention.

   The threat is not sophisticated: someone signs up with a second email and
   gets another seven days. Three signals catch nearly all of it, in ascending
   order of strength.

   1. Normalised email — defeats gmail dots and +aliases, which is the laziest
      and by far the most common attempt.
   2. Device id — same browser, different email.
   3. Card fingerprint — Stripe's stable hash of a card across accounts and
      customers. This is the strong one: a repeat trial needs a genuinely
      different payment card.

   Design choice: a duplicate identity is never blocked from signing up. It is
   only denied the *trial*, so they can still subscribe and pay. Blocking
   accounts outright creates support email and punishes shared households and
   offices, which produce real false positives on device and IP. */

/* Disposable and throwaway providers. Not exhaustive — it does not need to be.
   The goal is friction against casual repeat trials, not a perfect filter. */
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com',
  'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'yopmail.fr',
  'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc',
  'fakeinbox.com', 'mailnesia.com', 'mytemp.email', 'moakt.com', 'tempr.email',
  'spamgourmet.com', 'mail.tm', 'emailondeck.com', 'burnermail.io', 'anonaddy.me',
  'mozmail.com', 'simplelogin.io', 'duck.com', 'inboxkitten.com', 'tmpmail.org',
]);

/* Collapse the variations that resolve to the same real inbox. */
export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const clean = email.trim().toLowerCase();
  const at = clean.lastIndexOf('@');
  if (at < 1) return null;

  let local = clean.slice(0, at);
  const domain = clean.slice(at + 1);

  /* +tag is a sub-address on every major provider. */
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);

  /* Gmail ignores dots. Other providers do not, so only strip them there. */
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    return `${local}@gmail.com`;
  }
  return `${local}@${domain}`;
}

export function isDisposable(email) {
  if (!email) return false;
  const domain = email.trim().toLowerCase().split('@').pop();
  if (!domain) return false;
  if (DISPOSABLE.has(domain)) return true;
  /* Catch subdomains of known throwaway hosts, e.g. foo.mailinator.com */
  return [...DISPOSABLE].some(d => domain.endsWith('.' + d));
}

/* A trial is claimed against several identity signals at once. If any of them
   was already used by a different account, no trial. */
export function trialSignals({ email, deviceId, cardFingerprint }) {
  const out = [];
  const e = normalizeEmail(email);
  if (e) out.push({ kind: 'email', value: e });
  if (deviceId) out.push({ kind: 'device', value: deviceId });
  if (cardFingerprint) out.push({ kind: 'card', value: cardFingerprint });
  return out;
}
