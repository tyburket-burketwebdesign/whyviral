/* A paying customer must never see "your trial has not started", not even for
   a moment. Reconciliation happens before the first paint, so the wrong state
   is never rendered rather than rendered and corrected. */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const dir = path.resolve('public');
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Record every status-bar text the DOM ever holds, so a flash cannot hide. */
function boot({ before, after, syncs = true }) {
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'app.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://whyviral.io/app.html',
  });
  const { window } = dom;
  const seen = [];
  const errs = []; window.addEventListener('error', e => errs.push(e.message));
  let synced = false;
  window.fetch = async (u, init = {}) => {
    const s = String(u);
    if (s.startsWith('/api/sync')) { synced = true; return { ok: true, status: 200, json: async () => ({ synced: syncs }) }; }
    if (s.startsWith('/api/account')) {
      const state = synced ? after : before;
      return { ok: true, status: 200, json: async () => ({ billing: true, signedIn: true, email: 'ty@x.io', name: 'Ty Burket', plan: 'free', trialMode: 'card', trialDays: 7, remaining: 0, renewsAt: null, cancelAtPeriodEnd: false, ...state }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  window.scrollTo = () => {};
  const store = {};
  Object.defineProperty(window, 'localStorage', { value: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } });
  window.WHYVIRAL_CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' };

  /* Sample the DOM continuously while it boots. */
  const timer = setInterval(() => {
    const bar = window.document.querySelector('#status-bar');
    if (bar && !bar.hidden && bar.textContent.trim()) seen.push(bar.textContent.replace(/\s+/g, ' '));
  }, 8);

  window.eval(['auth.js', 'comments.js', 'engine.js', 'scriptgen.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    + '\n' + fs.readFileSync(path.join(dir, 'app.js'), 'utf8').replace(/^import .*$/gm, ''));
  return { window, seen, errs, stop: () => clearInterval(timer), $: s => window.document.querySelector(s), didSync: () => synced };
}

const inDays = d => new Date(Date.now() + d * 86400000).toISOString();

console.log('--- webhook never landed, sync fixes it ---');
let t = boot({ before: { status: 'none', subscribed: false },
               after: { status: 'trialing', subscribed: true, renewsAt: inDays(7) } });
await sleep(700); t.stop();
check('sync was called', t.didSync());
check('never showed a trial prompt', !t.seen.some(x => /trial has not started/i.test(x)), t.seen.join(' || ').slice(0, 120));
check('never offered a free trial button', !t.seen.some(x => /start free trial/i.test(x)));
check('ends on the trial countdown', /days? left in your trial/i.test(t.$('#status-bar').textContent), t.$('#status-bar').textContent.slice(0, 60));
check('no errors', t.errs.length === 0, t.errs.join('|'));

console.log('\n--- genuinely no subscription ---');
t = boot({ before: { status: 'none', subscribed: false }, after: { status: 'none', subscribed: false }, syncs: false });
await sleep(700); t.stop();
check('still offers the trial when there is nothing to find', /trial has not started/i.test(t.$('#status-bar').textContent), t.$('#status-bar').textContent.slice(0, 60));
check('the prompt appears once, not after a flash of something else',
  new Set(t.seen).size <= 1, [...new Set(t.seen)].join(' || ').slice(0, 140));

console.log('\n--- already correct in the database ---');
t = boot({ before: { status: 'active', subscribed: true, plan: 'pro', renewsAt: inDays(20) },
           after: { status: 'active', subscribed: true, plan: 'pro', renewsAt: inDays(20) } });
await sleep(700); t.stop();
check('no pointless sync call', !t.didSync());
check('shows Pro immediately', /Pro/.test(t.$('#status-bar').textContent));
check('only ever showed one state', new Set(t.seen).size <= 1, [...new Set(t.seen)].join(' || ').slice(0, 120));

console.log('\n--- failed payment is not re-synced away ---');
t = boot({ before: { status: 'past_due', subscribed: false, plan: 'pro', renewsAt: inDays(-2) },
           after: { status: 'past_due', subscribed: false, plan: 'pro' } });
await sleep(700); t.stop();
check('past_due skips the sync', !t.didSync());
check('shows the card failure', /payment failed/i.test(t.$('#status-bar').textContent), t.$('#status-bar').textContent.slice(0, 50));

console.log('\n--- the marketing hero is visitor-only ---');
{
  const t2 = boot({ before: { status: 'active', subscribed: true, plan: 'pro', renewsAt: inDays(20) },
                    after: { status: 'active', subscribed: true, plan: 'pro', renewsAt: inDays(20) } });
  await sleep(500); t2.stop();
  const w = t2.window;
  const $ = t2.$;
  check('starts on the dashboard', $('#screen-home').classList.contains('active'));

  /* Every documented route back to the hero. */
  w.eval("show('welcome')");
  check('show("welcome") redirects to the dashboard', $('#screen-home').classList.contains('active') && !$('#screen-welcome').classList.contains('active'));

  const back = w.document.querySelector('[data-back="welcome"]');
  if (back) { back.click(); await sleep(40); }
  check('back buttons land on the dashboard', !$('#screen-welcome').classList.contains('active'));

  const brand = $('#brand-home');
  if (brand && brand.tagName === 'BUTTON') { brand.click(); await sleep(40); }
  check('logo does not expose the hero', !$('#screen-welcome').classList.contains('active'));

}

/* A visitor must still get the marketing hero — the guard is for signed-in
   people only, not a blanket removal. */
{
  const v = boot({ before: { signedIn: false, email: null, name: null },
                   after: { signedIn: false, email: null, name: null }, syncs: false });
  await sleep(500); v.stop();
  check('visitors still see the hero', v.$('#screen-welcome').classList.contains('active'));
  check('visitors do not see the dashboard', !v.$('#screen-home').classList.contains('active'));
}

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
