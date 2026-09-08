/* The server is the only validation that counts — the browser checks can be
   bypassed by anyone with dev tools open. */
import handler from '../api/profile.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };

const SECRET = 'jwt-secret';
const b64 = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = o => b64(new TextEncoder().encode(JSON.stringify(o)));
async function token(claims) {
  const h = enc({ alg: 'HS256', typ: 'JWT' }), p = enc(claims);
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64(new Uint8Array(s))}`;
}
const dobFor = y => { const d = new Date(); d.setFullYear(d.getFullYear() - y); return d.toISOString().slice(0, 10); };

let patched = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init = {}) => {
  const s = String(u);
  if (s.includes('/accounts')) {
    if ((init.method || 'GET') === 'PATCH') { patched = JSON.parse(init.body); return { ok: true, status: 200, json: async () => [patched] }; }
    return { ok: true, status: 200, json: async () => [{ id: 'acc-1', auth_user_id: 'u1', email: 'c@x.com', device_id: 'd1' }] };
  }
  return { ok: true, status: 200, json: async () => [] };
};
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_KEY: 'svc', SUPABASE_JWT_SECRET: SECRET };
const orig = process.env;
const req = async (body, claims = { sub: 'u1', email: 'c@x.com', exp: Math.floor(Date.now() / 1000) + 3600 }) => {
  process.env = { ...ENV };
  const t = claims ? await token(claims) : null;
  const r = new Request('https://whyviral.io/api/profile?device=d1', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(body),
  });
  const res = await handler(r);
  process.env = orig;
  return { status: res.status, body: await res.json() };
};

console.log('--- server-side profile validation ---');
let r = await req({ fullName: 'Charley', birthdate: dobFor(28) }, null);
check('no token rejected', r.status === 401);

r = await req({ fullName: 'C', birthdate: dobFor(28) });
check('short name rejected', r.status === 400 && r.body.error === 'name_required');

r = await req({ fullName: 'Charley Smith' });
check('missing birthdate rejected', r.status === 400 && r.body.error === 'birthdate_required');

r = await req({ fullName: 'Charley Smith', birthdate: 'not-a-date' });
check('junk birthdate rejected', r.status === 400 && r.body.error === 'birthdate_invalid');

r = await req({ fullName: 'Charley Smith', birthdate: dobFor(15) });
check('minor rejected server-side', r.status === 403 && r.body.error === 'too_young', JSON.stringify(r.body));
check('minor gets a clear reason', /18 or older/.test(r.body.message));

r = await req({ fullName: 'Charley Smith', birthdate: dobFor(17) });
check('17 rejected server-side', r.status === 403);
r = await req({ fullName: 'Charley Smith', birthdate: dobFor(18) });
check('exactly 18 accepted', r.status === 200, JSON.stringify(r.body));

r = await req({ fullName: 'Charley Smith', birthdate: dobFor(200) });
check('impossible age rejected', r.status === 400);

r = await req({ fullName: 'Charley Smith', birthdate: dobFor(30), phone: '12' });
check('too-short phone rejected', r.status === 400 && r.body.error === 'phone_invalid');

r = await req({ fullName: 'Charley Smith', birthdate: dobFor(30), phoneConsent: true });
check('consent without a number rejected', r.status === 400 && r.body.error === 'phone_required');

console.log('\n--- what gets stored ---');
r = await req({ fullName: 'Charley Smith', birthdate: dobFor(30), phone: '+1 (555) 123-4567', phoneConsent: true, consentText: 'Text me updates. Reply STOP to opt out.', marketingOptIn: true });
check('accepted', r.status === 200);
check('phone normalised', patched.phone === '+15551234567', patched.phone);
check('consent recorded', patched.phone_consent === true);
check('consent wording stored', /Reply STOP/.test(patched.consent_text));
check('consent timestamped', !!patched.consent_at);
check('email normalised for abuse checks', patched.email_normalized === 'c@x.com');
check('marketing flag stored', patched.marketing_opt_in === true);

patched = null;
r = await req({ fullName: 'Charley Smith', birthdate: dobFor(30), phone: '5551234567', phoneConsent: false });
check('phone kept without consent', patched.phone === '5551234567');
check('consent false', patched.phone_consent === false);
check('no consent timestamp when not given', !patched.consent_at);

/* A minor must not be able to bypass by lying to the browser only. */
patched = null;
await req({ fullName: 'Kid Smith', birthdate: dobFor(12) });
check('nothing written for an underage attempt', patched === null);

globalThis.fetch = realFetch;
console.log('\n--- accounts are not created by page loads ---');
const { resolveAccount } = await import('../api/_auth.js');
let inserts = 0;
globalThis.fetch = async (u, init = {}) => {
  const s = String(u);
  if (s.includes('/accounts')) {
    if ((init.method || 'GET') === 'POST') { inserts++; return { ok: true, status: 200, json: async () => [{ id: 'new', device_id: 'd9' }] }; }
    return { ok: true, status: 200, json: async () => [] };   /* nothing exists yet */
  }
  return { ok: true, status: 200, json: async () => [] };
};
const E = { SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'y' };

let acc = await resolveAccount(E, { claims: null, deviceId: 'd9' });
check('anonymous lookup creates nothing by default', acc === null && inserts === 0, `inserts ${inserts}`);

acc = await resolveAccount(E, { claims: null, deviceId: 'd9', create: true });
check('creates only when asked', !!acc && inserts === 1, `inserts ${inserts}`);

inserts = 0;
await resolveAccount(E, { claims: null, deviceId: null });
check('no device id creates nothing', inserts === 0);

console.log('\n--- card mode blocks anonymous without touching the database ---');
const { checkAccess } = await import('../api/_gate.js');
inserts = 0;
let reads = 0;
globalThis.fetch = async (u, init = {}) => {
  reads++;
  return { ok: true, status: 200, json: async () => [] };
};
const res = await checkAccess({ ...E, SUPABASE_JWT_SECRET: 'jwt', TRIAL_MODE: 'card' },
  new Request('https://whyviral.io/api/enrich?url=x&device=d9'));
check('anonymous blocked in card mode', !res.allowed && res.reason === 'signup_required');
check('database never queried for that', reads === 0, `reads ${reads}`);

globalThis.fetch = realFetch;

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
