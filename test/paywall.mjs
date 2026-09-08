/* The paywall is the only screen that takes money. A ReferenceError here is a
   customer who cannot pay, so the buttons get clicked rather than eyeballed. */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const dir = path.resolve('public');
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function boot(acct = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'app.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://whyviral.io/app.html#pricing',
  });
  const { window } = dom;
  const errs = [];
  window.addEventListener('error', e => errs.push(e.message));
  const calls = { checkout: null, portal: 0 };
  window.fetch = async (u, init = {}) => {
    const s = String(u);
    if (s.startsWith('/api/account')) return { ok: true, status: 200, json: async () => ({ billing: true, signedIn: true, email: 'ty@whyviral.io', name: 'Ty Burket', plan: 'free', status: 'none', subscribed: false, remaining: 0, trialMode: 'card', trialDays: 7, renewsAt: null, cancelAtPeriodEnd: false, ...acct }) };
    if (s.startsWith('/api/checkout')) { calls.checkout = s; return { ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe.com/x' }) }; }
    if (s.startsWith('/api/portal')) { calls.portal++; return { ok: true, status: 200, json: async () => ({ url: 'https://billing.stripe.com/x' }) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  window.scrollTo = () => {};
  const store = { 'whyviral.session.v1': JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 }) };
  Object.defineProperty(window, 'localStorage', { value: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } });
  window.WHYVIRAL_CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' };
  window.eval(['auth.js', 'comments.js', 'engine.js', 'scriptgen.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    + '\n' + fs.readFileSync(path.join(dir, 'app.js'), 'utf8').replace(/^import .*$/gm, ''));
  return { window, errs, calls, $: s => window.document.querySelector(s), all: s => [...window.document.querySelectorAll(s)] };
}

console.log('--- paywall loads clean ---');
let { $, all, errs, calls, window } = boot(); await sleep(320);
check('paywall shown from #pricing', $('#screen-paywall').classList.contains('active'));
check('no errors on load', errs.length === 0, errs.join(' | '));
check('two plan options', all('.plan-opt').length === 2);
check('monthly selected by default', all('.plan-opt')[0].classList.contains('active'));

console.log('\n--- plan toggle ---');
all('.plan-opt')[1].click(); await sleep(40);
check('annual becomes active', all('.plan-opt')[1].classList.contains('active'));
check('monthly deselected', !all('.plan-opt')[0].classList.contains('active'));
check('no error from the toggle', errs.length === 0, errs.join(' | '));

console.log('\n--- subscribe ---');
window.location.href = '';   /* observe the redirect */
$('#paywall-go').click(); await sleep(200);
check('checkout called', !!calls.checkout, 'no request made');
check('annual plan carried through', /plan=annual/.test(calls.checkout || ''), calls.checkout);
check('no ReferenceError', errs.length === 0, errs.join(' | '));

({ $, all, errs, calls } = boot()); await sleep(320);
$('#paywall-go').click(); await sleep(200);
check('monthly is the default sent', /plan=monthly/.test(calls.checkout || ''), calls.checkout);

console.log('\n--- billing portal for subscribers ---');
({ $, errs, calls } = boot({ subscribed: true, status: 'active' })); await sleep(320);
check('manage button shown to subscribers', !$('#paywall-manage').hidden);
$('#paywall-manage').click(); await sleep(200);
check('portal called', calls.portal === 1);
check('no errors', errs.length === 0, errs.join(' | '));

({ $ } = boot({ subscribed: false })); await sleep(320);
check('manage hidden for non-subscribers', $('#paywall-manage').hidden);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
