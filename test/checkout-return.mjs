/* Coming back from Stripe must land inside the app, signed in. Landing a
   paying customer on a marketing page with a "Sign in" button reads as being
   logged out and is the fastest way to a refund request. */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const dir = path.resolve('public');
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function boot(search, sequence) {
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'app.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'https://whyviral.io/app.html' + search,
  });
  const { window } = dom;
  const errs = []; window.addEventListener('error', e => errs.push(e.message));
  let calls = 0;
  window.fetch = async (u) => {
    if (String(u).startsWith('/api/account')) {
      const state = sequence[Math.min(calls++, sequence.length - 1)];
      return { ok: true, status: 200, json: async () => ({ billing: true, signedIn: true, email: 'ty@whyviral.io', name: 'Ty Burket', plan: 'free', trialMode: 'card', trialDays: 7, remaining: 0, renewsAt: null, cancelAtPeriodEnd: false, ...state }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  window.scrollTo = () => {};
  const store = {};
  Object.defineProperty(window, 'localStorage', { value: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } });
  window.WHYVIRAL_CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' };
  window.eval(['auth.js', 'comments.js', 'engine.js', 'scriptgen.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    + '\n' + fs.readFileSync(path.join(dir, 'app.js'), 'utf8').replace(/^import .*$/gm, ''));
  return { window, errs, $: s => window.document.querySelector(s), calls: () => calls };
}

console.log('--- successful checkout ---');
const trialing = { status: 'trialing', subscribed: true, renewsAt: new Date(Date.now() + 7 * 86400000).toISOString() };
let { $, window, errs } = boot('?checkout=success', [trialing]);
await sleep(400);
check('lands on the confirmation, not the marketing page', $('#screen-welcome-pro').classList.contains('active'));
check('never shows the signed-out welcome', !$('#screen-welcome').classList.contains('active'));
check('confirms the trial started', /Trial started/i.test($('#pro-kicker').textContent), $('#pro-kicker').textContent);
check('reassuring headline', /You're in/.test($('#pro-title').textContent));
check('query string cleared from the url', !window.location.search.includes('checkout'));
check('three next steps shown', window.document.querySelectorAll('.cl').length === 3);
check('animated tick present', !!$('.tick svg'));
check('no errors', errs.length === 0, errs.join(' | '));

$('#pro-start').click(); await sleep(120);
check('start button opens the dashboard', $('#screen-home').classList.contains('active'));
check('avatar still shown — never logged out', !$('#avatar-wrap').hidden);

console.log('\n--- webhook lands late ---');
/* First two polls say no subscription, then it activates. */
({ $, errs } = boot('?checkout=success', [{ status: 'none', subscribed: false }, { status: 'none', subscribed: false }, trialing]));
await sleep(200);
check('confirmation shown immediately, not after polling', $('#screen-welcome-pro').classList.contains('active'));
await sleep(3200);
check('recovers once the webhook lands', /Trial started/i.test($('#pro-kicker').textContent), $('#pro-kicker').textContent);

console.log('\n--- webhook never lands ---');
({ $ } = boot('?checkout=success', [{ status: 'none', subscribed: false }]));
await sleep(8200);
check('says payment received rather than claiming no plan', /Payment received/i.test($('#pro-kicker').textContent), $('#pro-kicker').textContent);
check('explains the delay', /takes a moment to activate/i.test($('#pro-sub').textContent));
check('offers a way out', /support@whyviral.io/.test($('#pro-note').textContent));
check('still not logged out', !$('#avatar-wrap').hidden);

console.log('\n--- cancelled checkout ---');
({ $ } = boot('?checkout=cancelled', [{ status: 'none', subscribed: false }]));
await sleep(400);
check('returns to the paywall', $('#screen-paywall').classList.contains('active'));
check('says nothing was charged', /nothing has been charged/i.test($('#paywall-error').textContent), $('#paywall-error').textContent);

console.log('\n--- ordinary visit is unaffected ---');
({ $ } = boot('', [trialing]));
await sleep(400);
check('no checkout param goes straight to the dashboard', $('#screen-home').classList.contains('active'));

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
