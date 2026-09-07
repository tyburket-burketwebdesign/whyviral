/* Sign-in is the front door. If it breaks, checkout and everything behind it
   is unreachable, so the flow gets tested rather than eyeballed. */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const dir = path.resolve('public');
const dom = new JSDOM(fs.readFileSync(path.join(dir, 'app.html'), 'utf8'), {
  runScripts: 'outside-only', url: 'https://whyviral.io/', pretendToBeVisual: true,
});
const { window } = dom;
const errs = [];
window.addEventListener('error', e => errs.push(e.message));

let otpCalls = 0, verifyCalls = 0, lastVerify = null;
window.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('/api/account')) return { ok: true, status: 200, json: async () => ({ billing: true, signedIn: false, plan: 'free', status: 'none', subscribed: false, remaining: 0, trialMode: 'card', trialDays: 7 }) };
  if (u.includes('/auth/v1/otp')) { otpCalls++; return { ok: true, status: 200, json: async () => ({}) }; }
  if (u.includes('/auth/v1/verify')) {
    verifyCalls++;
    lastVerify = JSON.parse(init.body);
    if (lastVerify.token === '123456') {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok', refresh_token: 'ref', expires_in: 3600 }) };
    }
    return { ok: false, status: 403, json: async () => ({ msg: 'Token has expired or is invalid' }) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};
window.scrollTo = () => {};
window.navigator.clipboard = { writeText: async () => {} };
const store = {};
Object.defineProperty(window, 'localStorage', {
  value: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
});
window.WHYVIRAL_CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' };
window.eval(
  fs.readFileSync(path.join(dir, 'auth.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(dir, 'comments.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(dir, 'engine.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(dir, 'scriptgen.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(dir, 'app.js'), 'utf8').replace(/^import .*$/gm, ''),
);

const $ = s => window.document.querySelector(s);
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('--- sign-in with a code ---');
await sleep(200);
check('code step hidden initially', $('#auth-step2').hidden);

$('#auth-email').value = 'not-an-email';
$('#auth-send').click(); await sleep(60);
check('bad email rejected', !$('#auth-error').hidden);
check('no request sent for bad email', otpCalls === 0);

$('#auth-email').value = 'ty@whyviral.io';
$('#auth-send').click(); await sleep(120);
check('code requested', otpCalls === 1);
check('code step revealed', !$('#auth-step2').hidden);

$('#auth-code').value = 'abc12x';
$('#auth-code').dispatchEvent(new window.Event('input'));
check('non-digits stripped', $('#auth-code').value === '12', $('#auth-code').value);

$('#auth-code').value = '999999';
$('#auth-code').dispatchEvent(new window.Event('input'));
await sleep(150);
check('wrong code verified and rejected', verifyCalls === 1);
check('error shown for wrong code', !$('#auth-error').hidden);
check('not signed in after wrong code', !store['whyviral.session.v1']);

$('#auth-code').value = '123456';
$('#auth-code').dispatchEvent(new window.Event('input'));
await sleep(200);
check('correct code auto-submits', verifyCalls === 2);
check('email sent with the code', lastVerify.email === 'ty@whyviral.io');
check('type is email', lastVerify.type === 'email');
check('session stored', !!store['whyviral.session.v1']);
check('returns to welcome screen', $('#screen-welcome').classList.contains('active'));

const s = JSON.parse(store['whyviral.session.v1']);
check('access token saved', s.access_token === 'tok');
check('expiry computed', s.expires_at > Math.floor(Date.now() / 1000));

check('no runtime errors', errs.length === 0, errs.join(' | '));
console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
