/* Password reset is a link, not a code. Arriving from that link must land on a
   set-a-new-password screen with two fields, not a sign-in form. */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const dir = path.resolve('public');
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function boot(hash = '') {
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'app.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'https://whyviral.io/app.html' + hash,
  });
  const { window } = dom;
  const calls = { recover: null, update: null };
  const errs = []; window.addEventListener('error', e => errs.push(e.message));
  window.fetch = async (u, init = {}) => {
    const s = String(u);
    if (s.startsWith('/api/account')) return { ok: true, status: 200, json: async () => ({ billing: true, signedIn: true, plan: 'free', status: 'none', subscribed: false, remaining: 0, trialMode: 'card', trialDays: 7 }) };
    if (s.includes('/auth/v1/recover')) { calls.recover = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({}) }; }
    if (s.includes('/auth/v1/user')) { calls.update = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ id: 'u1' }) }; }
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

console.log('--- requesting a reset ---');
let { $, calls, errs, window } = boot(); await sleep(200);
$('#go-signin').click(); await sleep(60);
$('#si-email').value = 'bad'; $('#go-reset').click(); await sleep(60);
check('needs a valid email first', !$('#auth-error').hidden);
$('#si-email').value = 'ty@whyviral.io'; $('#go-reset').click(); await sleep(150);
check('reset requested', !!calls.recover);
check('sends the email', calls.recover.email === 'ty@whyviral.io');
check('returns to the reset screen', /#reset$/.test(calls.recover.redirect_to || ''), calls.recover.redirect_to);
check('confirmation shown', !$('#auth-sent').hidden);

console.log('\n--- arriving from the link ---');
({ $, calls, errs, window } = boot('#access_token=tok&refresh_token=r&expires_in=3600&type=recovery'));
await sleep(280);
check('lands on set-new-password', $('#screen-reset').classList.contains('active'));
check('two password fields present', !!$('#rp-pass') && !!$('#rp-pass2'));
check('token stripped from the url', !window.location.hash.includes('access_token'));

$('#rp-pass').value = 'short'; $('#rp-pass2').value = 'short';
$('#rp-submit').click(); await sleep(80);
check('short password rejected', /8 characters/i.test($('#rp-error').textContent));
check('nothing sent yet', !calls.update);

$('#rp-pass').value = 'longenoughpw'; $('#rp-pass2').value = 'differentpw';
$('#rp-submit').click(); await sleep(80);
check('mismatch rejected', /do not match/i.test($('#rp-error').textContent));
check('still nothing sent', !calls.update);

$('#rp-pass2').value = 'longenoughpw';
$('#rp-submit').click(); await sleep(250);
check('password updated', !!calls.update && calls.update.password === 'longenoughpw');
check('returns to the app', $('#screen-home').classList.contains('active') || $('#screen-welcome').classList.contains('active'));

console.log('\n--- no flash before routing ---');
({ $, window } = boot('#signup')); 
check('screens hidden while booting', window.document.body.classList.contains('booting'));
await sleep(280);
check('booting class removed after routing', !window.document.body.classList.contains('booting'));
check('landed on sign-up, not welcome', $('#screen-signup').classList.contains('active'));

check('no runtime errors', errs.length === 0, errs.join(' | '));
console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
