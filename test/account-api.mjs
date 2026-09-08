/* Every /api/account response must carry the same fields. A stripped-down
   payload on one branch left the front end unable to tell which trial model
   was running, so it rendered nothing at all. */
import handler from '../api/account.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const REQUIRED = ['billing', 'signedIn', 'email', 'name', 'plan', 'status', 'subscribed',
                  'trialMode', 'trialDays', 'remaining', 'renewsAt', 'cancelAtPeriodEnd'];

const realFetch = globalThis.fetch;
const orig = process.env;
async function call(env, url = 'https://whyviral.io/api/account?device=test') {
  process.env = { ...env };
  const res = await handler(new Request(url));
  process.env = orig;
  return { status: res.status, body: await res.json() };
}
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_KEY: 'k', SUPABASE_JWT_SECRET: 's', TRIAL_MODE: 'card', TRIAL_DAYS: '7' };

console.log('--- shape is identical on every branch ---');

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [] });   /* no account row */
let r = await call(ENV);
check('no-account branch returns 200', r.status === 200);
REQUIRED.forEach(k => check(`no-account carries ${k}`, k in r.body, JSON.stringify(r.body)));
check('no-account reports card mode', r.body.trialMode === 'card', r.body.trialMode);
check('no-account reports trial days', r.body.trialDays === 7);
check('card mode means zero free runs', r.body.remaining === 0);

r = await call({ ...ENV, TRIAL_MODE: 'free' });
check('free mode reported', r.body.trialMode === 'free');

r = await call({});
check('unconfigured returns billing false', r.body.billing === false);
REQUIRED.forEach(k => check(`unconfigured carries ${k}`, k in r.body));

globalThis.fetch = async () => { throw new Error('db down'); };
r = await call(ENV);
check('database outage still returns 200', r.status === 200);
REQUIRED.forEach(k => check(`degraded carries ${k}`, k in r.body));
check('degraded flagged', r.body.degraded === true);
check('degraded still reports the trial model', r.body.trialMode === 'card');

globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () =>
  String(u).includes('/accounts') ? [{ id: 'a1', auth_user_id: null, email: null, device_id: 'test', full_name: 'Ty Burket' }]
                                  : [{ account_id: 'a1', plan: 'pro', status: 'trialing', trial_used: 0, trial_limit: 3, current_period_end: new Date(Date.now() + 5 * 86400000).toISOString(), cancel_at_period_end: false }] });
r = await call(ENV);
check('existing account returns its status', r.body.status === 'trialing', JSON.stringify(r.body).slice(0, 120));
check('subscribed true while trialing', r.body.subscribed === true);
check('name returned for the avatar', r.body.name === 'Ty Burket');
check('renewal date returned', !!r.body.renewsAt);
REQUIRED.forEach(k => check(`full branch carries ${k}`, k in r.body));

globalThis.fetch = realFetch;
console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
