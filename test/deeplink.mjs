/* The marketing site links straight into app screens. If those links land on
   the welcome screen instead, every CTA on the site quietly fails. */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const dir = path.resolve('public');
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };

async function boot(hash, acct = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'app.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'https://whyviral.io/app.html' + hash,
  });
  const { window } = dom;
  const errs = []; window.addEventListener('error', e => errs.push(e.message));
  window.fetch = async (u) => String(u).startsWith('/api/account')
    ? { ok: true, status: 200, json: async () => ({ billing: true, signedIn: false, plan: 'free', status: 'none', subscribed: false, remaining: 0, trialMode: 'card', trialDays: 7, ...acct }) }
    : { ok: true, status: 200, json: async () => ({}) };
  window.scrollTo = () => {};
  const store = {};
  Object.defineProperty(window, 'localStorage', { value: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } });
  window.WHYVIRAL_CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' };
  window.eval(['auth.js', 'comments.js', 'engine.js', 'scriptgen.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    + '\n' + fs.readFileSync(path.join(dir, 'app.js'), 'utf8').replace(/^import .*$/gm, ''));
  await new Promise(r => setTimeout(r, 260));
  return { window, errs, $: s => window.document.querySelector(s) };
}

console.log('--- deep links from the site ---');
let { $, window, errs } = await boot('#signin');
check('#signin opens the sign-in screen', $('#screen-auth').classList.contains('active'));
check('hash cleared from the url', !window.location.hash.includes('signin'));
check('no runtime errors', errs.length === 0, errs.join('|'));

({ $, window } = await boot('#signup'));
check('#signup opens the sign-up form', $('#screen-signup').classList.contains('active'));
check('sign-up asks for a name', !!$('#su-name'));
check('sign-up asks to confirm the password', !!$('#su-pass2'));
check('sign-up no longer asks for a birthdate', !$('#su-dob'));
check('sign-up no longer asks for a phone', !$('#su-phone'));

({ $ } = await boot('#pricing'));
check('#pricing opens the paywall', $('#screen-paywall').classList.contains('active'));

({ $ } = await boot(''));
check('no hash still lands on welcome', $('#screen-welcome').classList.contains('active'));

console.log('\n--- welcome copy follows the trial model ---');
({ $ } = await boot('', { trialMode: 'card', trialDays: 7 }));
check('card mode advertises the trial', /7 days free/i.test($('#hero-note').textContent), $('#hero-note').textContent);
check('card mode does not claim "no card"', !/no card/i.test($('#hero-note').textContent));

({ $ } = await boot('', { trialMode: 'free', remaining: 3 }));
check('free mode says no account needed', /no account needed/i.test($('#hero-note').textContent), $('#hero-note').textContent);

({ $ } = await boot('', { subscribed: true, status: 'active' }));
check('subscriber sees unrestricted copy', /paste your links/i.test($('#hero-note').textContent), $('#hero-note').textContent);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
