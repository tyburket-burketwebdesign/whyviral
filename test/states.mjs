/* Every account state a real customer can be in, and what each must show.
   Written before the bugs are found rather than after each one is reported. */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const dir = path.resolve('public');
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();

function boot(acct) {
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'app.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://whyviral.io/app.html',
  });
  const { window } = dom;
  const errs = []; window.addEventListener('error', e => errs.push(e.message));
  window.fetch = async (u) => String(u).startsWith('/api/account')
    ? { ok: true, status: 200, json: async () => ({ billing: true, signedIn: true, email: 'ty@x.io', name: 'Ty Burket', plan: 'free', status: 'none', subscribed: false, remaining: 0, trialMode: 'card', trialDays: 7, renewsAt: null, cancelAtPeriodEnd: false, ...acct }) }
    : { ok: true, status: 200, json: async () => ({}) };
  window.scrollTo = () => {};
  const store = {};
  Object.defineProperty(window, 'localStorage', { value: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } });
  window.WHYVIRAL_CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' };
  window.eval(['auth.js', 'comments.js', 'engine.js', 'scriptgen.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    + '\n' + fs.readFileSync(path.join(dir, 'app.js'), 'utf8').replace(/^import .*$/gm, ''));
  return { window, errs, $: s => window.document.querySelector(s), txt: s => (window.document.querySelector(s)?.textContent || '') };
}

const STATES = {
  'signed out':        { signedIn: false, email: null, name: null },
  'no plan':           { status: 'none', subscribed: false },
  'trialing':          { status: 'trialing', subscribed: true, renewsAt: inDays(5) },
  'trial last day':    { status: 'trialing', subscribed: true, renewsAt: inDays(0.4) },
  'paying':            { status: 'active', subscribed: true, plan: 'pro', renewsAt: inDays(24) },
  'payment failed':    { status: 'past_due', subscribed: false, plan: 'pro', renewsAt: inDays(-2) },
  'cancelled, active': { status: 'active', subscribed: true, plan: 'pro', renewsAt: inDays(11), cancelAtPeriodEnd: true },
  'cancelled, ended':  { status: 'canceled', subscribed: false, plan: 'pro', renewsAt: inDays(-6) },
};

console.log('--- state matrix ---');
const rows = [];
for (const [name, acct] of Object.entries(STATES)) {
  const { $, txt, errs } = boot(acct);
  await sleep(320);
  const chip = $('#trial-chip').hidden ? '—' : txt('#trial-chip');
  const full = $('#status-bar').hidden ? '' : txt('#status-bar').replace(/\s+/g, ' ');
  const bar = full ? full.slice(0, 58) : '—';
  rows.push(`  ${name.padEnd(19)} chip:${chip.padEnd(11)} ${bar}`);
  check(`${name}: no runtime errors`, errs.length === 0, errs.join('|'));

  const hasTrialCta = /start (your )?(7-day )?free trial/i.test(txt('#status-bar'));
  const mentionsTrial = /trial/i.test(txt('#status-bar') + txt('#trial-chip') + txt('#hero-note'));

  if (acct.subscribed && acct.status === 'active') {
    check(`${name}: no trial call to action`, !hasTrialCta, txt('#status-bar').slice(0, 60));
    check(`${name}: no trial language anywhere`, !mentionsTrial, txt('#status-bar').slice(0, 60));
    check(`${name}: chip signals paid access`, /pro|ends soon/i.test(chip), chip);
  }
  if (name === 'trialing') {
    check(`${name}: counts the days`, /5 days? left/i.test(full), full);
    check(`${name}: no upsell button during trial`, !hasTrialCta, full);
  }
  if (name === 'no plan') {
    check(`${name}: offers the trial`, hasTrialCta, full);
  }
  if (name === 'payment failed') {
    check(`${name}: says the payment failed`, /payment|card|failed/i.test(full), full);
    check(`${name}: offers to fix billing`, /update|billing|card/i.test(full), full);
    check(`${name}: does not offer a fresh trial`, !hasTrialCta, bar);
  }
  if (name === 'cancelled, active') {
    check(`${name}: says access continues`, /cancel/i.test(full), full);
    check(`${name}: names the end date`, /\w{3} \d/.test(full), full);
    check(`${name}: offers to resume`, /resume|reactivate|renew/i.test(full), full);
  }
  if (name === 'cancelled, ended') {
    check(`${name}: invites resubscribe`, /subscribe|resume/i.test(full), full);
    check(`${name}: does not promise a new free trial`, !/free trial/i.test(full), full);
  }
  if (name === 'signed out') {
    check(`${name}: no status bar`, $('#status-bar').hidden);
    check(`${name}: no chip`, $('#trial-chip').hidden);
  }
}
console.log(rows.join('\n'));
console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
