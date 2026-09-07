import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const dir = path.resolve('public');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

const FIXTURES = {
  '1': { title: "stop buying the apple pencil pro if you're just taking notes 😭 the usb-c one does everything #applepencil #studytok #ipadnotes", author_name: 'studywithmei' },
  '2': { title: "you're using your apple pencil wrong. nobody tells you about the double tap #applepencil #ipadtips #techtok", author_name: 'techbylena' },
  '3': { title: "3 apple pencil settings i wish i knew before spending $129 #applepencil #ipad #studytok", author_name: 'notesbyjay' },
};

const dom = new JSDOM(html, {
  runScripts: 'outside-only', url: 'https://whyviral.pages.dev/', pretendToBeVisual: true,
});
const { window } = dom;
const errors = [];
window.addEventListener('error', e => errors.push(e.message));

window.fetch = async (url, init) => {
  if (String(url).startsWith('/api/account')) return { ok: true, status: 200, json: async () => ({ billing: false, signedIn: false, plan: 'open', remaining: null }) };
  const m = String(url).match(/video%2F(\d)|video\/(\d)/);
  const key = m ? (m[1] || m[2]) : null;
  const data = FIXTURES[key];
  if (!data) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => data };
};
window.scrollTo = () => {};
window.navigator.clipboard = { writeText: async () => {} };
const store = {};
Object.defineProperty(window, 'localStorage', {
  value: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
});

const load = f => window.eval(
  fs.readFileSync(path.join(dir, f), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '')
);
// engine + scriptgen are ES modules; inline them then app.js
window.eval(`window.__mods = {};`);
const authSrc = fs.readFileSync(path.join(dir, 'auth.js'), 'utf8');
const cmtSrc = fs.readFileSync(path.join(dir, 'comments.js'), 'utf8').replace(/export /g, '');
const engineSrc = fs.readFileSync(path.join(dir, 'engine.js'), 'utf8').replace(/export /g, '');
const genSrc = fs.readFileSync(path.join(dir, 'scriptgen.js'), 'utf8').replace(/export /g, '');
const appSrc = fs.readFileSync(path.join(dir, 'app.js'), 'utf8')
  .replace(/^import .*$/gm, '');
window.WHYVIRAL_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };
window.eval(authSrc + '\n' + cmtSrc + '\n' + engineSrc + '\n' + genSrc + '\n' + appSrc);

const $ = s => window.document.querySelector(s);
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('--- UI flow test ---');
check('welcome screen active', $('#screen-welcome').classList.contains('active'));
check('three link rows rendered by default', window.document.querySelectorAll('.link-row').length === 3);

$('#go-new').click();
check('routes to input screen', $('#screen-input').classList.contains('active'));

// validation: empty topic
$('#start-analysis').click();
check('blocks empty topic', !$('#input-error').hidden && /product or topic/i.test($('#input-error').textContent));

$('#topic').value = 'Apple Pencil';
$('#start-analysis').click();
check('blocks too few links', /at least 3/i.test($('#input-error').textContent));

const inputs = [...window.document.querySelectorAll('.link-row input')];
inputs[0].value = 'https://www.tiktok.com/@studywithmei/video/1';
inputs[1].value = 'not-a-link-at-all';
inputs.forEach(i => i.dispatchEvent(new window.Event('input')));
inputs[2].value = 'https://www.tiktok.com/@notesbyjay/video/3';
$('#start-analysis').click();
check('rejects malformed link', /not a TikTok link/i.test($('#input-error').textContent));

inputs[1].value = 'https://www.tiktok.com/@techbylena/video/2';
inputs.forEach(i => i.dispatchEvent(new window.Event('input')));
check('count pill updates', $('#link-count').textContent === '3 of 5');

$('#start-analysis').click();
check('enters loading screen', $('#screen-loading').classList.contains('active'));
check('steps rendered', $('#steps').children.length === 5);

await sleep(4200);

check('lands on result screen', $('#screen-result').classList.contains('active'), $('#screen-result').className);
const findings = window.document.querySelectorAll('.finding');
check('findings rendered', findings.length >= 2, `got ${findings.length}`);
check('confidence badge set', $('#confidence').textContent.length > 10);
check('shared hashtags shown', $('#shared-panel').textContent.includes('applepencil'));
check('caveat present', $('#caveat').textContent.includes('Spoken audio'));
check('every finding shows a ratio', [...findings].every(f => /\d of \d/.test(f.textContent)));
check('every finding shows lift', [...findings].every(f => /× more common/.test(f.textContent)));

// stepper
check('stepper starts at 3', $('#script-n').textContent === '3');
$('#dec').click(); $('#dec').click();
check('stepper floors at 1', $('#script-n').textContent === '1');
check('minus disabled at floor', $('#dec').disabled);
for (let i = 0; i < 9; i++) $('#inc').click();
check('stepper caps at 6', $('#script-n').textContent === '6');
check('plus disabled at cap', $('#inc').disabled);
$('#dec').click(); $('#dec').click();

$('#build-scripts').click();
check('routes to scripts screen', $('#screen-scripts').classList.contains('active'));
const scripts = window.document.querySelectorAll('.script');
check('four scripts rendered', scripts.length === 4, `got ${scripts.length}`);
check('scripts have distinct angles', new Set([...window.document.querySelectorAll('.script-angle')].map(a => a.textContent)).size === 4);
check('beats rendered', window.document.querySelectorAll('.beat').length >= 16);
check('every script has 4+ beats', [...scripts].every(s => s.querySelectorAll('.beat').length >= 4));
check('hooks non-empty', [...window.document.querySelectorAll('.script-hook')].every(h => h.textContent.trim().length > 12));
check('no template placeholders leaked', !window.document.body.innerHTML.includes('${') && !window.document.body.innerHTML.includes('undefined'));
check('must-say lists present', window.document.querySelectorAll('.must').length === 4);
check('caption includes hashtags', [...window.document.querySelectorAll('.meta-v')].some(v => v.textContent.includes('#applepencil')));

// history
$('#nav-history').click();
check('history screen active', $('#screen-history').classList.contains('active'));
check('history has the run', window.document.querySelectorAll('.hist').length === 1);
check('history summary correct', $('.hist').textContent.includes('3 videos'));
$('.hist').click();
check('reopening history restores result', $('#screen-result').classList.contains('active'));
check('restored topic intact', $('#result-topic').textContent.includes('Apple Pencil'));

check('no uncaught runtime errors', errors.length === 0, errors.join(' | '));

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
