/* The signed-in experience: avatar, menu, trial countdown, theme, settings.
   These are the parts that make an app feel like an account rather than a form. */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const dir = path.resolve('public');
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function boot(acct = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'app.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://whyviral.io/app.html',
  });
  const { window } = dom;
  const errs = []; window.addEventListener('error', e => errs.push(e.message));
  window.fetch = async (u) => String(u).startsWith('/api/account')
    ? { ok: true, status: 200, json: async () => ({ billing: true, signedIn: true, email: 'ty@whyviral.io', name: 'Ty Burket', plan: 'free', status: 'trialing', subscribed: true, remaining: null, trialMode: 'card', trialDays: 7, renewsAt: new Date(Date.now() + 5 * 86400000).toISOString(), cancelAtPeriodEnd: false, ...acct }) }
    : { ok: true, status: 200, json: async () => ({}) };
  window.scrollTo = () => {};
  const store = {};
  Object.defineProperty(window, 'localStorage', { value: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } });
  window.WHYVIRAL_CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' };
  window.eval(['auth.js', 'comments.js', 'engine.js', 'scriptgen.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    + '\n' + fs.readFileSync(path.join(dir, 'app.js'), 'utf8').replace(/^import .*$/gm, ''));
  return { window, errs, store, $: s => window.document.querySelector(s) };
}

console.log('--- signed in ---');
let { $, window, errs, store } = boot(); await sleep(300);
check('avatar shown', !$('#avatar-wrap').hidden);
check('sign-in button hidden', $('#nav-signin').hidden);
check('initials from the name', $('#avatar-initials').textContent === 'TB', $('#avatar-initials').textContent);
check('name in the menu', $('#menu-name').textContent === 'Ty Burket');
check('email in the menu', $('#menu-email').textContent === 'ty@whyviral.io');
check('plan shows trial with days', /Trial · 5d/.test($('#menu-plan').textContent), $('#menu-plan').textContent);

console.log('\n--- menu behaviour ---');
check('menu closed initially', $('#acct-menu').hidden);
$('#avatar-btn').click(); await sleep(40);
check('opens on click', !$('#acct-menu').hidden);
check('aria-expanded set', $('#avatar-btn').getAttribute('aria-expanded') === 'true');
window.document.body.click(); await sleep(40);
check('closes on outside click', $('#acct-menu').hidden);
$('#avatar-btn').click(); await sleep(30);
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })); await sleep(30);
check('closes on Escape', $('#acct-menu').hidden);

console.log('\n--- trial countdown ---');
check('chip shows days left', $('#trial-chip').textContent === '5d left', $('#trial-chip').textContent);
check('chip not in warning state yet', !$('#trial-chip').className.includes('warn'));
check('status bar visible', !$('#status-bar').hidden);
check('status names the days', /5 days left in your trial/.test($('#status-bar').textContent), $('#status-bar').textContent.slice(0, 60));
check('status names the price after', /\$29 a month from/.test($('#status-bar').textContent));

({ $ } = boot({ renewsAt: new Date(Date.now() + 86400000).toISOString() })); await sleep(300);
check('one day left reads singular', /1 day left/.test($('#status-bar').textContent), $('#status-bar').textContent.slice(0, 40));
check('chip warns near the end', $('#trial-chip').className.includes('warn'));

({ $ } = boot({ renewsAt: new Date(Date.now() + 3600000).toISOString() })); await sleep(300);
check('last day reads "ends today"', /ends today/i.test($('#status-bar').textContent));

({ $ } = boot({ status: 'active', subscribed: true })); await sleep(300);
check('subscriber sees Pro', $('#trial-chip').textContent === 'Pro');
check('subscriber status shows renewal', /Renews/.test($('#status-bar').textContent));

({ $ } = boot({ status: 'none', subscribed: false })); await sleep(300);
check('unsubscribed prompted to start', /trial has not started/i.test($('#status-bar').textContent));
check('status bar offers the trial', /Start free trial/.test($('#status-bar').textContent));

({ $ } = boot({ cancelAtPeriodEnd: true })); await sleep(300);
check('cancelled trial says so', /Cancelled/.test($('#status-bar').textContent), $('#status-bar').textContent.slice(0, 80));

console.log('\n--- theme ---');
({ $, window, store } = boot()); await sleep(300);
check('starts light', window.document.documentElement.getAttribute('data-theme') === 'light');
$('#menu-theme').click(); await sleep(40);
check('toggles to dark', window.document.documentElement.getAttribute('data-theme') === 'dark');
check('persisted', store['whyviral.theme.v1'] === 'dark');
check('switch reflects state', $('#menu-theme').getAttribute('aria-checked') === 'true');
check('settings switch stays in sync', $('#set-theme').getAttribute('aria-checked') === 'true');
$('#set-theme').click(); await sleep(40);
check('toggles back from settings', window.document.documentElement.getAttribute('data-theme') === 'light');

console.log('\n--- settings ---');
({ $, window, store } = boot()); await sleep(300);
$('#avatar-btn').click(); $('#menu-settings').click(); await sleep(60);
check('opens settings', $('#screen-settings').classList.contains('active'));
check('menu closed after navigating', $('#acct-menu').hidden);
check('name shown', $('#set-name').textContent === 'Ty Burket');
check('plan shown', $('#set-plan').textContent === 'Free trial');
check('renewal date shown', $('#set-renews').textContent !== '—');
const before = $('#set-scripts').textContent;
$('#set-scripts-inc').click(); await sleep(30);
check('script default increments', $('#set-scripts').textContent !== before);
check('script default persisted', !!store['whyviral.scripts.v1']);

console.log('\n--- signed out ---');
({ $ } = boot({ signedIn: false, email: null, name: null, subscribed: false, status: 'none' })); await sleep(300);
check('avatar hidden', $('#avatar-wrap').hidden);
check('sign-in shown', !$('#nav-signin').hidden);
check('status bar hidden', $('#status-bar').hidden);

check('no runtime errors', errs.length === 0, errs.join(' | '));
console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
