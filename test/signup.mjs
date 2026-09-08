/* Sign-up is now the front door and collects data with legal weight, so the
   validation and the consent record both get tested rather than eyeballed. */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const dir = path.resolve('public');
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function boot() {
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'app.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://whyviral.io/app.html',
  });
  const { window } = dom;
  const calls = { signup: 0, profile: null, token: 0 };
  const errs = [];
  window.addEventListener('error', e => errs.push(e.message));
  window.fetch = async (u, init = {}) => {
    const s = String(u);
    if (s.startsWith('/api/account')) {
      /* Mirror the real API: signed in only when a token is attached. */
      const signedIn = !!(init.headers && init.headers.authorization);
      return { ok: true, status: 200, json: async () => ({ billing: true, signedIn, email: signedIn ? 'charley@whyviral.io' : null, name: signedIn ? 'Charley Smith' : null, plan: 'free', status: 'none', subscribed: false, remaining: 0, trialMode: 'card', trialDays: 7 }) };
    }
    if (s.includes('/auth/v1/signup')) {
      calls.signup++;
      const b = JSON.parse(init.body);
      if (b.email === 'taken@x.com') return { ok: false, status: 400, json: async () => ({ msg: 'User already registered' }) };
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok', refresh_token: 'r', expires_in: 3600 }) };
    }
    if (s.includes('/auth/v1/token')) { calls.token++; const b = JSON.parse(init.body);
      return b.password === 'correct-horse' ? { ok: true, status: 200, json: async () => ({ access_token: 't', refresh_token: 'r', expires_in: 3600 }) }
                                            : { ok: false, status: 400, json: async () => ({ error_description: 'Invalid login credentials' }) }; }
    if (s.startsWith('/api/profile')) { calls.profile = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  window.scrollTo = () => {};
  const store = {};
  Object.defineProperty(window, 'localStorage', { value: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } });
  window.WHYVIRAL_CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' };
  window.eval(['auth.js', 'comments.js', 'engine.js', 'scriptgen.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    + '\n' + fs.readFileSync(path.join(dir, 'app.js'), 'utf8').replace(/^import .*$/gm, ''));
  return { window, calls, errs, store, $: s => window.document.querySelector(s) };
}

const dobFor = years => {
  const d = new Date(); d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
};

function fill($, o = {}) {
  $('#su-name').value = o.name ?? 'Charley Smith';
  $('#su-email').value = o.email ?? 'charley@whyviral.io';
  $('#su-pass').value = o.pass ?? 'longenoughpw';
  $('#su-pass2').value = o.pass2 ?? o.pass ?? 'longenoughpw';
}

console.log('--- validation ---');
let { $, calls, errs } = boot();
await sleep(150);

fill($, { name: 'C' }); $('#su-submit').click(); await sleep(60);
check('short name rejected', !$('#su-error').hidden && /your name/i.test($('#su-error').textContent));
check('no account created', calls.signup === 0);

fill($, { email: 'nope' }); $('#su-submit').click(); await sleep(60);
check('bad email rejected', /email/i.test($('#su-error').textContent));

fill($, { pass: 'short' }); $('#su-submit').click(); await sleep(60);
check('short password rejected', /8 characters/i.test($('#su-error').textContent));

fill($, { pass: 'longenoughpw', pass2: 'differentpw' }); $('#su-submit').click(); await sleep(60);
check('mismatched passwords rejected', /do not match/i.test($('#su-error').textContent), $('#su-error').textContent);
check('no account created on mismatch', calls.signup === 0);

console.log('\n--- successful sign-up ---');
({ $, calls, errs } = boot()); await sleep(150);
fill($);
$('#su-submit').click(); await sleep(300);
check('account created', calls.signup === 1);
check('profile saved', !!calls.profile);
check('name sent', calls.profile.fullName === 'Charley Smith');
check('no birthdate collected', !calls.profile.birthdate);
check('no phone collected', !calls.profile.phone);
check('lands on the paywall', $('#screen-paywall').classList.contains('active'));

console.log('\n--- existing account ---');
({ $, calls } = boot()); await sleep(150);
fill($, { email: 'taken@x.com' });
$('#su-submit').click(); await sleep(250);
check('duplicate email explained', /already has an account/i.test($('#su-error').textContent), $('#su-error').textContent);

console.log('\n--- sign in ---');
({ $, calls, errs } = boot()); await sleep(150);
$('#go-signin').click(); await sleep(80);
check('switches to sign-in screen', $('#screen-auth').classList.contains('active'));
$('#si-email').value = 'charley@whyviral.io'; $('#si-pass').value = 'wrong';
$('#si-submit').click(); await sleep(200);
check('wrong password rejected', /wrong email or password/i.test($('#auth-error').textContent));
$('#si-pass').value = 'correct-horse';
$('#si-submit').click(); await sleep(250);
check('correct password lands on the dashboard', $('#screen-home').classList.contains('active'));

$('#go-signup')?.click(); await sleep(60);
check('can switch back to sign-up', $('#screen-signup').classList.contains('active'));
check('no runtime errors', errs.length === 0, errs.join(' | '));

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
