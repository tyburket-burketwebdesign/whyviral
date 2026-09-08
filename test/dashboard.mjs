/* The signed-in home is a workspace: the primary action is on the page, the
   tools are one click, and recent work is visible. */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const dir = path.resolve('public');
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HISTORY = [{
  topic: 'Sol de Janeiro Cheirosa 62', createdAt: Date.now() - 3600000, videoCount: 4, confidence: 'high',
  findings: [
    { key: 'hook_negation', label: 'Opens by telling you to stop', why: 'Telling someone to stop implies they are already doing it wrong.', hits: 4, of: 4, lift: 3.2, strength: 'high', examples: [], measured: true },
    { key: 'has_second_person', label: 'Written to "you"', why: 'Direct address beats third-person description on watch time.', hits: 4, of: 4, lift: 2.1, strength: 'high', examples: [], measured: true },
    { key: 'has_price', label: 'Price named out loud', why: 'Stating price early removes the top reason people scroll past.', hits: 3, of: 4, lift: 1.9, strength: 'medium', examples: [], measured: false },
  ],
  metrics: [], sharedTags: [], sharedWords: [], videos: [], baseline: { source: 'measured', n: 10, from: '#soldejaneiro', partial: 0 },
}];

function boot(acct = {}, history = HISTORY) {
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'app.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://whyviral.io/app.html',
  });
  const { window } = dom;
  const errs = []; window.addEventListener('error', e => errs.push(e.message));
  window.fetch = async (u, init = {}) => String(u).startsWith('/api/account')
    ? { ok: true, status: 200, json: async () => ({ billing: true, signedIn: true, email: 'ty@whyviral.io', name: 'Ty Burket', plan: 'free', status: 'trialing', subscribed: true, remaining: null, trialMode: 'card', trialDays: 7, renewsAt: new Date(Date.now() + 5 * 86400000).toISOString(), cancelAtPeriodEnd: false, ...acct }) }
    : { ok: true, status: 200, json: async () => ({}) };
  window.scrollTo = () => {};
  const store = { 'whyviral.history.v1': JSON.stringify(history) };
  Object.defineProperty(window, 'localStorage', { value: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } });
  window.WHYVIRAL_CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' };
  window.eval(['auth.js', 'comments.js', 'engine.js', 'scriptgen.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    + '\n' + fs.readFileSync(path.join(dir, 'app.js'), 'utf8').replace(/^import .*$/gm, ''));
  return { window, errs, store, $: s => window.document.querySelector(s), all: s => [...window.document.querySelectorAll(s)] };
}

console.log('--- signed in lands on the dashboard ---');
let { $, all, window, errs } = boot(); await sleep(320);
check('dashboard is the landing screen', $('#screen-home').classList.contains('active'));
check('marketing hero not shown', !$('#screen-welcome').classList.contains('active'));
check('greeted by first name', /Ty/.test($('#dash-greet').textContent), $('#dash-greet').textContent);
check('greeting is time aware', /Good (morning|afternoon|evening)/.test($('#dash-greet').textContent));
check('stats rendered', all('.dash-stat').length === 3);
check('breakdown count correct', $('.dash-stat b').textContent === '1');

console.log('\n--- the main action is on the page ---');
check('topic field present', !!$('#quick-topic'));
check('three link rows ready', all('.qrow').length === 3);
check('link counter starts empty', /0 of 5/.test($('#launch-count').textContent));
$('#quick-add').click(); await sleep(30);
check('can add a fourth', all('.qrow').length === 4);

const inp = all('.qrow input');
inp[0].value = 'https://www.tiktok.com/@a/video/1'; inp[0].dispatchEvent(new window.Event('input'));
await sleep(30);
check('valid link marked', inp[0].classList.contains('ok'));
check('counter updates', /1 of 5/.test($('#launch-count').textContent));

$('#quick-go').click(); await sleep(60);
check('blocks with no topic', !$('#quick-error').hidden && /Name the product/.test($('#quick-error').textContent));
$('#quick-topic').value = 'Sol de Janeiro';
$('#quick-go').click(); await sleep(60);
check('blocks with too few links', /at least 3/.test($('#quick-error').textContent));

console.log('\n--- tools ---');
check('three tools shown', all('.tool').length === 3);
$('#tool-history').click(); await sleep(50);
check('library opens history', $('#screen-history').classList.contains('active'));

console.log('\n--- recent work ---');
({ $, all } = boot()); await sleep(320);
check('recents visible with history', !$('#recent-wrap').hidden);
check('one recent item', all('.recent-item').length === 1);
check('recent names the topic', /Sol de Janeiro/.test($('.recent-item').textContent));
check('recent shows the summary', /4 videos · 3 shared traits/.test($('.recent-item').textContent), $('.recent-item').textContent);
$('.recent-item').click(); await sleep(60);
check('recent opens that breakdown', $('#screen-result').classList.contains('active'));

({ $ } = boot({}, [])); await sleep(320);
check('recents hidden when empty', $('#recent-wrap').hidden);
check('empty state prompts a first run', /Paste three viral videos/.test($('#dash-sub').textContent), $('#dash-sub').textContent);

console.log('\n--- score a draft ---');
({ $, all, window } = boot()); await sleep(320);
$('#tool-score').click(); await sleep(60);
check('scoring screen opens', $('#screen-score').classList.contains('active'));
check('breakdown offered as a source', $('#score-source').options.length === 1);
check('source names the topic', /Sol de Janeiro/.test($('#score-source').options[0].textContent));

$('#score-go').click(); await sleep(50);
check('empty draft rejected', !$('#score-error').hidden);

/* A draft that hits two of the three traits. */
$('#score-text').value = "Stop scrolling if you keep reaching for the same body mist. You will want this one instead.";
$('#score-go').click(); await sleep(80);
check('score rendered', !!$('.score-ring'));
const pct = parseInt($('.score-ring').textContent, 10);
check('score is a sensible percentage', pct >= 0 && pct <= 100, String(pct));
check('every trait listed', all('.hit').length === 3);
check('hits marked', all('.hit.yes').length >= 1, `${all('.hit.yes').length} hits`);
check('misses marked', all('.hit.no').length >= 1);
check('misses come first', all('.hit')[0].classList.contains('no'));
check('misses explain why it matters', all('.hit.no .w').length >= 1);

/* A draft matching nothing should score low. */
$('#score-text').value = 'here is my little haul from the shops today, hope you like it';
$('#score-go').click(); await sleep(80);
check('unrelated draft scores lower', parseInt($('.score-ring').textContent, 10) < pct || pct === 0);

check('no runtime errors', errs.length === 0, errs.join(' | '));
console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
