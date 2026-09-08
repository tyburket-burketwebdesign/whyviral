/* Billing reconciliation. A webhook that never lands must not be able to
   strand a paying customer, so the app can ask Stripe directly. */
import handler from '../api/sync.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = o => b64(new TextEncoder().encode(JSON.stringify(o)));
const SECRET = 'jwt';
async function token(claims) {
  const h = enc({ alg: 'HS256', typ: 'JWT' }), p = enc(claims);
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64(s)}`;
}

const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_KEY: 'k', SUPABASE_JWT_SECRET: SECRET, STRIPE_SECRET_KEY: 'sk_test' };
const realFetch = globalThis.fetch;
const orig = process.env;
let patched = null;

function mock({ entitlement = {}, customers = [], subs = [] } = {}) {
  patched = null;
  globalThis.fetch = async (u, init = {}) => {
    const s = String(u);
    if (s.includes('/accounts')) return { ok: true, status: 200, json: async () => [{ id: 'acc-1', auth_user_id: 'u1', email: 'ty@x.io', device_id: 'd1' }] };
    if (s.includes('/entitlements')) {
      if ((init.method || 'GET') === 'PATCH') { patched = JSON.parse(init.body); return { ok: true, status: 200, json: async () => [patched] }; }
      return { ok: true, status: 200, json: async () => [{ account_id: 'acc-1', plan: 'free', status: 'none', trial_used: 0, trial_limit: 3, stripe_customer_id: null, ...entitlement }] };
    }
    if (s.includes('api.stripe.com/v1/customers')) return { ok: true, status: 200, json: async () => ({ data: customers }) };
    if (s.includes('api.stripe.com/v1/subscriptions')) return { ok: true, status: 200, json: async () => ({ data: subs }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

async function call(env = ENV, withToken = true) {
  process.env = { ...env };
  const t = withToken ? await token({ sub: 'u1', email: 'ty@x.io', exp: Math.floor(Date.now() / 1000) + 3600 }) : null;
  const res = await handler(new Request('https://whyviral.io/api/sync?device=d1', {
    method: 'POST', headers: t ? { authorization: `Bearer ${t}` } : {},
  }));
  process.env = orig;
  return { status: res.status, body: await res.json() };
}

const future = Math.floor(Date.now() / 1000) + 7 * 86400;

console.log('--- webhook never landed ---');
mock({ customers: [{ id: 'cus_1' }], subs: [{ id: 'sub_1', status: 'trialing', customer: 'cus_1', current_period_end: future, cancel_at_period_end: false }] });
let r = await call();
check('finds the customer by email', r.body.synced === true, JSON.stringify(r.body));
check('reports the trial', r.body.status === 'trialing');
check('marks them subscribed', r.body.subscribed === true);
check('writes the entitlement', patched && patched.status === 'trialing');
check('records the customer id', patched.stripe_customer_id === 'cus_1');
check('records the subscription id', patched.stripe_subscription_id === 'sub_1');
check('burns the trial so it cannot repeat', patched.trial_used === 999);
check('stores the renewal date', !!patched.current_period_end);

console.log('\n--- already has a customer id ---');
mock({ entitlement: { stripe_customer_id: 'cus_known' }, subs: [{ id: 'sub_2', status: 'active', customer: 'cus_known', current_period_end: future }] });
r = await call();
check('active subscription synced', r.body.status === 'active' && r.body.subscribed === true);

console.log('\n--- unhappy paths ---');
mock({ customers: [], subs: [] });
r = await call();
check('no customer reported clearly', r.body.synced === false && r.body.reason === 'no_customer', JSON.stringify(r.body));
check('message is human', /No Stripe customer/i.test(r.body.message));

mock({ customers: [{ id: 'cus_1' }], subs: [] });
r = await call();
check('customer without subscription reported', r.body.reason === 'no_subscription');
check('customer id still recorded for next time', patched && patched.stripe_customer_id === 'cus_1');

mock({ customers: [{ id: 'cus_1' }], subs: [{ id: 's', status: 'canceled', customer: 'cus_1', current_period_end: Math.floor(Date.now() / 1000) - 100 }] });
r = await call();
check('cancelled subscription is not access', r.body.subscribed === false && r.body.status === 'canceled');

mock({ customers: [{ id: 'cus_1' }], subs: [
  { id: 'old', status: 'canceled', customer: 'cus_1', created: 1, current_period_end: future },
  { id: 'new', status: 'active', customer: 'cus_1', created: 2, current_period_end: future }] });
r = await call();
check('live subscription wins over a cancelled one', r.body.status === 'active' && patched.stripe_subscription_id === 'new');

mock({ customers: [{ id: 'cus_1' }], subs: [{ id: 's', status: 'past_due', customer: 'cus_1', current_period_end: future }] });
r = await call();
check('past_due synced and not treated as access', r.body.status === 'past_due' && r.body.subscribed === false);

console.log('\n--- guards ---');
mock();
r = await call(ENV, false);
check('unauthenticated rejected', r.status === 401);
r = await call({ ...ENV, STRIPE_SECRET_KEY: '' });
check('unconfigured reported', r.status === 503);

/* Only Stripe is down; the database still answers. */
mock({ customers: [{ id: 'cus_1' }] });
const dbOnly = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  if (String(u).includes('api.stripe.com')) throw new Error('stripe down');
  return dbOnly(u, init);
};
r = await call();
check('stripe outage returns 502, not a crash', r.status === 502 && r.body.reason === 'stripe_failed', JSON.stringify(r.body));

/* Now the database is down too. */
globalThis.fetch = async () => { throw new Error('everything down'); };
r = await call();
check('database outage handled cleanly', r.status === 502 && r.body.reason === 'db_failed', JSON.stringify(r.body));

globalThis.fetch = realFetch;
console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
