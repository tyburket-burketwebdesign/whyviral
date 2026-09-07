/* Billing is where a mistake costs money in both directions: a bad webhook
   check hands out free accounts, a bad status map locks out payers. */
import { verifyWebhook, mapStatus } from '../api/_stripe.js';
import { checkAccess } from '../api/_gate.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };

const SECRET = 'whsec_test_secret_value';
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
async function signBody(body, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  return `t=${t},v1=${hex(mac)}`;
}

console.log('--- webhook signature ---');
const body = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active' } } });

check('valid signature accepted', (await verifyWebhook(body, await signBody(body), SECRET))?.type === 'customer.subscription.updated');
check('wrong secret rejected', await verifyWebhook(body, await signBody(body, 'whsec_other'), SECRET) === null);
check('tampered body rejected', await verifyWebhook(body.replace('active', 'trialing'), await signBody(body), SECRET) === null);
check('missing signature rejected', await verifyWebhook(body, null, SECRET) === null);
check('malformed header rejected', await verifyWebhook(body, 'garbage', SECRET) === null);
check('header without v1 rejected', await verifyWebhook(body, 't=123', SECRET) === null);
check('no secret configured rejected', await verifyWebhook(body, await signBody(body), '') === null);

const old = Math.floor(Date.now() / 1000) - 3600;
check('replay of an old event rejected', await verifyWebhook(body, await signBody(body, SECRET, old), SECRET) === null);
const future = Math.floor(Date.now() / 1000) + 3600;
check('far-future timestamp rejected', await verifyWebhook(body, await signBody(body, SECRET, future), SECRET) === null);
const recent = Math.floor(Date.now() / 1000) - 60;
check('recent event within tolerance accepted', await verifyWebhook(body, await signBody(body, SECRET, recent), SECRET) !== null);
check('unparseable json rejected', await verifyWebhook('not json', await signBody('not json'), SECRET) === null);

console.log('\n--- status mapping ---');
check('trialing maps through', mapStatus('trialing') === 'trialing');
check('active maps through', mapStatus('active') === 'active');
check('past_due maps', mapStatus('past_due') === 'past_due');
check('unpaid becomes past_due', mapStatus('unpaid') === 'past_due');
check('canceled maps', mapStatus('canceled') === 'canceled');
check('incomplete_expired becomes canceled', mapStatus('incomplete_expired') === 'canceled');
check('incomplete is not access', mapStatus('incomplete') === 'none');
check('unknown status fails closed', mapStatus('something_new') === 'canceled');

console.log('\n--- card-required mode ---');
const JWT = 'jwt-secret';
const b64url = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = o => b64url(new TextEncoder().encode(JSON.stringify(o)));
async function token(claims) {
  const h = enc({ alg: 'HS256', typ: 'JWT' }), p = enc(claims);
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(JWT), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(s))}`;
}
const good = await token({ sub: 'u1', email: 'ty@x.com', exp: Math.floor(Date.now() / 1000) + 3600 });

function env({ status = 'none', mode = 'card', email = 'ty@x.com' } = {}) {
  const accounts = [{ id: 'acc-1', auth_user_id: 'u1', email, device_id: 'dev-1' }];
  const ents = [{ account_id: 'acc-1', plan: 'free', status, trial_used: 0, trial_limit: 3, current_period_end: null }];
  globalThis.fetch = async (u, init = {}) => {
    const s = String(u);
    if (s.includes('/accounts')) return { ok: true, status: 200, json: async () => accounts };
    if (s.includes('/entitlements')) return { ok: true, status: 200, json: async () => ents };
    return { ok: true, status: 200, json: async () => [] };
  };
  return { SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'y', SUPABASE_JWT_SECRET: JWT, TRIAL_MODE: mode, TRIAL_DAYS: '7' };
}
const req = (tok) => new Request('https://whyviral.io/api/enrich?url=x&device=dev-1',
  tok ? { headers: { authorization: `Bearer ${tok}` } } : {});
const realFetch = globalThis.fetch;

let a = await checkAccess(env({ status: 'none' }), req(good));
check('card mode blocks unsubscribed', !a.allowed && a.reason === 'subscription_required', a.reason);
check('block message names the trial length', a.message.includes('7-day'));

a = await checkAccess(env({ status: 'none', email: null }), req());
check('card mode blocks anonymous with signup prompt', !a.allowed && a.reason === 'signup_required', a.reason);

a = await checkAccess(env({ status: 'trialing' }), req(good));
check('stripe trial grants access', a.allowed && a.mode === 'subscribed');
a = await checkAccess(env({ status: 'active' }), req(good));
check('active subscription grants access', a.allowed);
a = await checkAccess(env({ status: 'past_due' }), req(good));
check('past_due blocked in card mode', !a.allowed);
a = await checkAccess(env({ status: 'canceled' }), req(good));
check('canceled blocked in card mode', !a.allowed);

/* Free mode must be unaffected by any of this. */
a = await checkAccess(env({ status: 'none', mode: 'free' }), req(good));
check('free mode still gives trial runs', a.allowed && a.mode === 'trial', a.mode);
a = await checkAccess(env({ status: 'none', mode: 'FREE' }), req(good));
check('mode is case-insensitive', a.allowed && a.mode === 'trial');
a = await checkAccess({ ...env({ status: 'none' }), TRIAL_MODE: undefined }, req(good));
check('defaults to free when unset', a.allowed && a.mode === 'trial');

globalThis.fetch = realFetch;
console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
