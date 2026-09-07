import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const dir = path.resolve('public');
const dom = new JSDOM(fs.readFileSync(path.join(dir, 'app.html'), 'utf8'), {
  runScripts: 'outside-only', url: 'https://whyviral.pages.dev/', pretendToBeVisual: true,
});
const { window } = dom;
const errors = [];
window.addEventListener('error', e => errors.push(e.message));

const V = {
  '1': { caption: 'the apple pencil setting nobody turns on #applepencil #ipad', tags: ['applepencil', 'ipad'],
         spoken: 'Stop scrolling if you own an Apple Pencil. Nobody turns this setting on.', dur: 21, plays: 2400000, sh: 88000, sv: 190000 },
  '2': { caption: 'you are using your apple pencil wrong #applepencil #ipadtips', tags: ['applepencil', 'ipadtips'],
         spoken: "You're using your Apple Pencil wrong and I was too.", dur: 18, plays: 1800000, sh: 71000, sv: 150000 },
  '3': { caption: '3 apple pencil settings i wish i knew #applepencil #studytok', tags: ['applepencil', 'studytok'],
         spoken: 'Three Apple Pencil settings I wish I knew before spending a hundred dollars.', dur: 25, plays: 3100000, sh: 120000, sv: 240000 },
};
let controlCalls = 0, enrichCalls = 0;

window.fetch = async (url, init) => {
  if (String(url).startsWith('/api/account')) return { ok: true, status: 200, json: async () => ({ billing: false, signedIn: false, plan: 'open', remaining: null }) };
  const u = String(url);
  if (u.startsWith('/api/control')) {
    controlCalls++;
    return { ok: true, status: 200, json: async () => ({
      enabled: true, sufficient: true, source: '#applepencil', sampled: 24,
      videos: Array.from({ length: 12 }, (_, i) => ({
        caption: `my ipad setup for school ${i} #applepencil #aesthetic #studygram`,
        hashtags: ['applepencil', 'aesthetic', 'studygram'], duration: 58 + i,
        soundOriginal: false, followerCount: 120000,
        transcript: 'Hey guys welcome back to my channel today I am showing you my whole desk setup for this semester.',
        rates: { like: 0.04, comment: 0.001, share: 0.002, save: 0.006 },
      })),
      medianRates: { share: 0.002, save: 0.006, comment: 0.001, like: 0.04 }, medianPlays: 14000,
    }) };
  }
  const key = (u.match(/video(?:%2F|\/)(\d)/) || [])[1];
  const d = V[key];
  if (!d) return { ok: false, status: 404, json: async () => ({}) };
  if (u.startsWith('/api/enrich')) {
    enrichCalls++;
    return { ok: true, status: 200, json: async () => ({
      enabled: true, id: key, url: u, caption: d.caption, hashtags: d.tags,
      transcript: d.spoken, duration: d.dur, soundOriginal: true, creatorCaptioned: true,
      followerCount: 14000, author: 'creator' + key, thumbnail: null,
      stats: { plays: d.plays, likes: d.plays * 0.13, comments: d.plays * 0.002, shares: d.sh, saves: d.sv },
      rates: { like: 0.13, comment: 0.002, share: d.sh / d.plays, save: d.sv / d.plays },
    }) };
  }
  return { ok: false, status: 503, json: async () => ({}) };
};
window.scrollTo = () => {};
window.navigator.clipboard = { writeText: async () => {} };
const store = {};
Object.defineProperty(window, 'localStorage', {
  value: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
});

window.WHYVIRAL_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };
window.eval(
  fs.readFileSync(path.join(dir, 'auth.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(dir, 'engine.js'), 'utf8').replace(/export /g, '') + '\n' +
  fs.readFileSync(path.join(dir, 'comments.js'), 'utf8').replace(/export /g, '') + '\n' +
  fs.readFileSync(path.join(dir, 'scriptgen.js'), 'utf8').replace(/export /g, '') + '\n' +
  fs.readFileSync(path.join(dir, 'app.js'), 'utf8').replace(/^import .*$/gm, '')
);

const $ = s => window.document.querySelector(s);
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('--- enriched UI flow ---');
$('#go-new').click();
$('#topic').value = 'Apple Pencil';
const inputs = [...window.document.querySelectorAll('.link-row input')];
inputs.forEach((inp, i) => { inp.value = `https://www.tiktok.com/@c/video/${i + 1}`; inp.dispatchEvent(new window.Event('input')); });
$('#start-analysis').click();
await sleep(4200);

check('reaches result screen', $('#screen-result').classList.contains('active'));
check('enrich called once per link', enrichCalls === 3, String(enrichCalls));
check('control called exactly once', controlCalls === 1, String(controlCalls));

const bl = $('#baseline');
check('baseline strip visible', !bl.hidden);
check('baseline marked measured', bl.className.includes('measured'), bl.className);
check('baseline names sample size', /12 ordinary videos/.test(bl.textContent), bl.textContent);
check('baseline names the tag', /#applepencil/.test(bl.textContent));

const mp = $('#metrics-panel');
check('metrics panel visible', !mp.hidden);
check('four metrics rendered', window.document.querySelectorAll('.metric').length === 4);
check('share rate shown first', $('.metric-label').textContent === 'Share rate', $('.metric-label').textContent);
check('multiples rendered', [...window.document.querySelectorAll('.metric-mult')].every(m => /^\d+(\.\d)?×$/.test(m.textContent)));
check('bars never exceed 100%', [...window.document.querySelectorAll('.metric-fill')].every(f => parseFloat(f.style.width) <= 100));

const findings = window.document.querySelectorAll('.finding');
check('findings rendered', findings.length >= 3, String(findings.length));
check('lift wording reflects measurement', /ordinary videos/.test(findings[0].textContent), findings[0].textContent.slice(0, 120));
check('capped lifts render as 5×+', ![...findings].some(f => /\b\d{2,}×/.test(f.textContent)));
check('caveat mentions spoken audio', /spoken audio/i.test($('#caveat').textContent));
check('caveat does not nag about missing key', !/add a scraper key/i.test($('#caveat').textContent));

$('#build-scripts').click();
check('scripts still build', window.document.querySelectorAll('.script').length === 3);
check('no template holes', !window.document.body.innerHTML.includes('${'));
check('no runtime errors', errors.length === 0, errors.join(' | '));

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
