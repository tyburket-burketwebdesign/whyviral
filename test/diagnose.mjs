/* The diagnostic must name the broken link precisely — its whole value is
   replacing guesswork with an answer. */
import handler from '../api/diagnose.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = o => b64(new TextEncoder().encode(JSON.stringify(o)));
const SECRET = 'jwt';
async function tok() {
  const h = enc({ alg: 'HS256', typ: 'JWT' }), p = enc({ sub: 'u1', email: 'ty@x.io', exp: Math.floor(Date.now() / 1000) + 3600 });
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${h}.${p}.${b64(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${h}.${p}`)))}`;
}
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_KEY: 'k', SUPABASE_JWT_SECRET: SECRET,
              STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_PRICE_ID: 'price_1', STRIPE_WEBHOOK_SECRET: 'whsec', TRIAL_MODE: 'card' };
const realFetch = globalThis.fetch, orig = process.env;

function mock({ accounts, entitlement, customers = [], subs = [] } = {}) {
  globalThis.fetch = async (u) => {
    const s = String(u);
    if (s.includes('/accounts')) return { ok: true, status: 200, json: async () => accounts ?? [{ id: 'acc-1', auth_user_id: 'u1', email: 'ty@x.io', full_name: 'Ty Burket', device_id: 'd1' }] };
    if (s.includes('/entitlements')) return { ok: true, status: 200, json: async () => [{ account_id: 'acc-1', plan: 'free', status: 'none', trial_used: 0, trial_limit: 3, stripe_customer_id: null, stripe_subscription_id: null, ...entitlement }] };
    if (s.includes('api.stripe.com/v1/customers')) return { ok: true, status: 200, json: async () => ({ data: customers }) };
    if (s.includes('api.stripe.com/v1/subscriptions')) return { ok: true, status: 200, json: async () => ({ data: subs }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}
async function run(env = ENV, withTok = true) {
  process.env = { ...env };
  const t = withTok ? await tok() : null;
  const res = await handler(new Request('https://whyviral.io/api/diagnose?device=d1', { headers: t ? { authorization: `Bearer ${t}` } : {} }));
  process.env = orig;
  return res.json();
}
const named = (r, n) => (r.checks || []).find(c => c.name === n);

console.log('--- the case Ty is hitting ---');
mock({ customers: [{ id: 'cus_1' }], subs: [{ id: 'sub_1', status: 'trialing' }] });
let r = await run();
check('identifies the webhook as the break', /webhook never wrote it/i.test(r.verdict), r.verdict);
check('tells them to refresh subscription', /Refresh subscription/i.test(r.fix));
check('reports stripe has the subscription', named(r, 'stripe has a subscription').pass === true);
check('reports the database does not', named(r, 'subscription recorded').pass === false);

console.log('\n--- everything healthy ---');
mock({ entitlement: { status: 'trialing', plan: 'pro', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' },
       customers: [{ id: 'cus_1' }], subs: [{ id: 'sub_1', status: 'trialing' }] });
r = await run();
check('reports ok', r.ok === true, r.verdict);
check('verdict says subscribed', /subscribed/i.test(r.verdict));

console.log('\n--- wrong stripe mode ---');
mock({ customers: [], subs: [] });
r = await run();
check('names the mode mismatch', /other Stripe mode|never completed/i.test(r.fix), r.fix);
check('flags no customer', named(r, 'stripe customer for this email').pass === false);

console.log('\n--- duplicate accounts for one email ---');
mock({ accounts: [{ id: 'acc-1', auth_user_id: 'u1', email: 'ty@x.io', full_name: 'Ty', device_id: 'd1' }, { id: 'acc-2', auth_user_id: null, email: 'ty@x.io' }],
       customers: [{ id: 'cus_1' }], subs: [] });
r = await run();
check('detects duplicate account rows', named(r, 'one account per email').pass === false, JSON.stringify(named(r, 'one account per email')));

console.log('\n--- configuration gaps ---');
mock();
r = await run({ ...ENV, STRIPE_SECRET_KEY: '' });
check('missing stripe key reported', named(r, 'STRIPE_SECRET_KEY set').pass === false);
check('verdict names it', /Stripe is not configured/i.test(r.verdict));

r = await run({ ...ENV, STRIPE_SECRET_KEY: 'sk_live_x' }, true);
check('reports which stripe mode', named(r, 'STRIPE_SECRET_KEY set').detail === 'live mode');

r = await run(ENV, false);
check('unauthenticated handled', /Not signed in/i.test(r.verdict));
check('never leaks a secret', !JSON.stringify(r).includes('sk_test_1') && !JSON.stringify(r).includes(SECRET));

console.log('\n--- profile gap ---');
mock({ accounts: [{ id: 'acc-1', auth_user_id: 'u1', email: 'ty@x.io', device_id: 'd1' }], customers: [{ id: 'c' }], subs: [] });
r = await run();
check('missing name flagged', named(r, 'profile name saved').pass === false);

globalThis.fetch = realFetch;
console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
