/* The gate is the paywall. Anyone can read the front-end JS and call the
   endpoints directly, so every bypass has to be closed here. */
import { verifyToken, bearerFrom } from '../api/_auth.js';
import { checkAccess, commitUsage, denyResponse } from '../api/_gate.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };

const SECRET = 'super-secret-jwt-signing-key-for-tests';
const b64url = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = o => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function sign(claims, secret = SECRET, alg = 'HS256') {
  const head = enc({ alg, typ: 'JWT' });
  const body = enc(claims);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const now = () => Math.floor(Date.now() / 1000);

console.log('--- token verification ---');
const good = await sign({ sub: 'user-1', email: 'ty@x.com', exp: now() + 3600 });
check('valid token verifies', (await verifyToken(good, SECRET))?.sub === 'user-1');
check('wrong secret rejected', await verifyToken(good, 'other-secret') === null);
check('expired token rejected', await verifyToken(await sign({ sub: 'u', exp: now() - 10 }), SECRET) === null);
check('future nbf rejected', await verifyToken(await sign({ sub: 'u', exp: now() + 60, nbf: now() + 50 }), SECRET) === null);
check('token without sub rejected', await verifyToken(await sign({ email: 'a@b.c', exp: now() + 60 }), SECRET) === null);
check('alg:none rejected', await verifyToken(await sign({ sub: 'u', exp: now() + 60 }, SECRET, 'none'), SECRET) === null);
check('RS256 downgrade rejected', await verifyToken(await sign({ sub: 'u', exp: now() + 60 }, SECRET, 'RS256'), SECRET) === null);
check('garbage rejected', await verifyToken('not.a.token', SECRET) === null);
check('two-segment token rejected', await verifyToken('aa.bb', SECRET) === null);
check('empty token rejected', await verifyToken('', SECRET) === null);
check('missing secret rejected', await verifyToken(good, '') === null);
const tampered = good.split('.'); tampered[1] = enc({ sub: 'admin', exp: now() + 3600 });
check('tampered payload rejected', await verifyToken(tampered.join('.'), SECRET) === null);

const req = (opts = {}) => new Request('https://whyviral.vercel.app/api/enrich?url=x' + (opts.device ? `&device=${opts.device}` : ''), {
  headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
});
check('bearer parsed', bearerFrom(req({ token: 'abc' })) === 'abc');
check('no header gives null', bearerFrom(req()) === null);

console.log('\n--- gate behaviour ---');
/* In-memory Supabase stand-in. */
function mockEnv({ trialUsed = 0, status = 'none', periodEnd = null, dev = '' } = {}) {
  const accounts = [{ id: 'acc-1', auth_user_id: 'user-1', email: 'ty@x.com', device_id: 'dev-1' }];
  const ents = [{ account_id: 'acc-1', plan: 'free', status, trial_used: trialUsed, trial_limit: 3, current_period_end: periodEnd }];
  const usage = [];
  const env = {
    SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'svc', SUPABASE_JWT_SECRET: SECRET,
    DEV_UNLIMITED: dev, _usage: usage, _ents: ents,
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    if (u.includes('/accounts')) {
      if (method === 'GET') return { ok: true, status: 200, json: async () => (u.includes('user-1') || u.includes('dev-1') ? accounts : []) };
      return { ok: true, status: 200, json: async () => accounts };
    }
    if (u.includes('/entitlements')) {
      if (method === 'PATCH') { ents[0].trial_used += 1; return { ok: true, status: 200, json: async () => ents }; }
      return { ok: true, status: 200, json: async () => ents };
    }
    if (u.includes('/usage_events')) { usage.push(1); return { ok: true, status: 204, json: async () => null }; }
    return { ok: true, status: 200, json: async () => [] };
  };
  return env;
}
const realFetch = globalThis.fetch;

/* No billing configured at all — the app stays open. */
const openAccess = await checkAccess({}, req({ device: 'dev-1' }));
check('open mode when billing unconfigured', openAccess.allowed && openAccess.mode === 'open');

/* Trial. */
let env = mockEnv({ trialUsed: 0 });
let a = await checkAccess(env, req({ token: good, device: 'dev-1' }));
check('fresh trial allowed', a.allowed && a.mode === 'trial', a.mode);
check('remaining reported', a.remaining === 2, String(a.remaining));

env = mockEnv({ trialUsed: 3 });
a = await checkAccess(env, req({ token: good, device: 'dev-1' }));
check('exhausted trial blocked', !a.allowed && a.reason === 'trial_exhausted');
check('block carries a 402', a.status === 402);
check('block explains itself', a.message.includes('Subscribe'));
const denied = denyResponse(a);
check('deny response is 402', denied.status === 402);
check('deny response flags upgrade', JSON.parse(await denied.text()).upgrade === true);

/* Subscription. */
env = mockEnv({ trialUsed: 99, status: 'active', periodEnd: new Date(Date.now() + 86400000).toISOString() });
a = await checkAccess(env, req({ token: good, device: 'dev-1' }));
check('active subscriber allowed past trial limit', a.allowed && a.mode === 'subscribed');

env = mockEnv({ trialUsed: 99, status: 'active', periodEnd: new Date(Date.now() - 5 * 86400000).toISOString() });
a = await checkAccess(env, req({ token: good, device: 'dev-1' }));
check('long-expired period treated as stale', !a.allowed && a.reason === 'subscription_stale', a.reason);

env = mockEnv({ trialUsed: 99, status: 'trialing', periodEnd: new Date(Date.now() + 86400000).toISOString() });
check('stripe trialing status allowed', (await checkAccess(env, req({ token: good, device: 'dev-1' }))).allowed);

env = mockEnv({ trialUsed: 99, status: 'canceled' });
check('canceled subscription blocked', !(await checkAccess(env, req({ token: good, device: 'dev-1' }))).allowed);
env = mockEnv({ trialUsed: 99, status: 'past_due' });
check('past_due blocked', !(await checkAccess(env, req({ token: good, device: 'dev-1' }))).allowed);

/* Bypass attempts. */
env = mockEnv({ trialUsed: 3 });
const forged = await sign({ sub: 'user-1', email: 'ty@x.com', exp: now() + 3600 }, 'attacker-secret');
a = await checkAccess(env, req({ token: forged, device: 'dev-1' }));
check('forged token rejected, not downgraded to anonymous', !a.allowed && a.reason === 'bad_token', a.reason);
check('forged token gets 401', a.status === 401);

a = await checkAccess(env, req({ token: await sign({ sub: 'user-1', exp: now() - 100 }), device: 'dev-1' }));
check('expired token rejected outright', !a.allowed && a.reason === 'bad_token');

env = mockEnv({ trialUsed: 3 });
a = await checkAccess(env, new Request('https://x.dev/api/enrich?url=y'));
check('no identity at all is blocked', !a.allowed && a.reason === 'no_identity', a.reason);

/* Dev bypass. */
env = mockEnv({ trialUsed: 99, dev: 'ty@x.com,other@x.com' });
a = await checkAccess(env, req({ token: good, device: 'dev-1' }));
check('dev email bypasses the gate', a.allowed && a.mode === 'dev');
env = mockEnv({ trialUsed: 99, dev: 'someone@else.com' });
check('non-dev email still blocked', !(await checkAccess(env, req({ token: good, device: 'dev-1' }))).allowed);

/* Infrastructure failure must not lock out customers. */
globalThis.fetch = async () => { throw new Error('db down'); };
a = await checkAccess({ SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'y', SUPABASE_JWT_SECRET: SECRET }, req({ device: 'dev-1' }));
check('database outage fails open', a.allowed && a.mode === 'degraded');

console.log('\n--- usage accounting ---');
env = mockEnv({ trialUsed: 0 });
a = await checkAccess(env, req({ token: good, device: 'dev-1' }));
await commitUsage(env, a, 'enrich');
check('usage recorded on success', env._usage.length === 1);
check('trial incremented', env._ents[0].trial_used === 1, String(env._ents[0].trial_used));

env = mockEnv({ trialUsed: 0, status: 'active', periodEnd: new Date(Date.now() + 8.64e7).toISOString() });
a = await checkAccess(env, req({ token: good, device: 'dev-1' }));
await commitUsage(env, a, 'enrich');
check('subscriber usage logged', env._usage.length === 1);
check('subscriber trial not incremented', env._ents[0].trial_used === 0);

env = mockEnv({ trialUsed: 0, dev: 'ty@x.com' });
a = await checkAccess(env, req({ token: good, device: 'dev-1' }));
await commitUsage(env, a, 'enrich');
check('dev usage not counted', env._usage.length === 0);

await commitUsage({}, { mode: 'open', account: null }, 'enrich');
check('open mode records nothing', true);

globalThis.fetch = realFetch;
console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
