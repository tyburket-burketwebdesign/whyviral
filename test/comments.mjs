import { loadEngine } from './_load.mjs';
const { analyze, generateScripts, mineComments } = loadEngine();

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const C = (...t) => t.map((text, i) => ({ text, likes: 100 - i * 7 }));

const vid = (id, caption, comments) => ({
  url: `https://www.tiktok.com/@x/video/${id}`, caption, hashtags: ['applepencil'],
  transcript: 'Stop scrolling if you own an Apple Pencil. Nobody turns this setting on.',
  duration: 21, soundOriginal: true, creatorCaptioned: true, followerCount: 14000,
  stats: { plays: 2000000, likes: 250000, comments: 4000, shares: 80000, saves: 170000 },
  rates: { like: .125, comment: .002, share: .04, save: .085 },
  comments,
});

const VIDS = [
  vid(1, 'the setting nobody turns on #applepencil', C(
    'where can i get this?', 'how much was it??', 'does it work with the ipad mini?',
    'just ordered one', 'obsessed with this', 'is this an ad')),
  vid(2, 'you are using it wrong #applepencil', C(
    'link please', 'too expensive for me honestly', 'does it work with android?',
    'how did you do that at 0:12?', 'need this')),
  vid(3, '3 settings i wish i knew #applepencil', C(
    'drop the link', 'how much?', 'does this really work or is it placebo',
    'what model is that', 'adding to cart now')),
];

console.log('--- comment mining ---');
const m = mineComments(VIDS.map(v => ({ comments: v.comments })), 2);
check('returns a result', !!m);
check('counts all comments', m.analysed === 16, String(m.analysed));
check('counts videos', m.videos === 3);
check('finds themes', m.themes.length >= 3, String(m.themes.length));
m.themes.forEach(t => console.log(`  ${t.videos}/${t.of}  ${String(t.share).padStart(2)}%  ${t.label}`));

check('detects buying intent', m.themes.some(t => t.key === 'buying'));
check('detects price objection', m.themes.some(t => t.key === 'price'));
check('detects compatibility questions', m.themes.some(t => t.key === 'compat'));
check('themes sorted by score', m.themes.every((t, i, a) => i === 0 || a[i - 1].score >= t.score));
check('every theme has rationale', m.themes.every(t => t.why && t.why.length > 30));
check('every theme carries a quote', m.themes.every(t => t.quotes.length > 0));
check('quotes are real comment text', m.themes[0].quotes.every(q => typeof q === 'string' && q.length > 1));
check('picks a single objection', !!m.objection && m.objection.key !== 'buying', m.objection?.key);
check('surfaces top questions', m.topQuestions.length > 0 && m.topQuestions.every(q => q.includes('?')));

/* A theme in only one video is noise, not a pattern. */
const oneVideo = mineComments([{ comments: C('where can i buy this', 'link?') }, { comments: C('nice') }, { comments: C('cool') }], 2);
check('single-video theme rejected', !oneVideo || !oneVideo.themes.some(t => t.key === 'buying'));
check('fewer than 2 commented videos returns null', mineComments([{ comments: C('link?') }], 2) === null);
check('no comments at all returns null', mineComments([{ comments: [] }, { comments: [] }], 2) === null);

console.log('\n--- integration ---');
const withC = analyze(VIDS, { topic: 'Apple Pencil' });
const noC = analyze(VIDS.map(v => ({ ...v, comments: [] })), { topic: 'Apple Pencil' });
check('audience attached to analysis', !!withC.audience);
check('absent when no comments', noC.audience === null);
check('analysis still works without comments', noC.findings.length > 0);

const s = generateScripts(withC, 3, 'Apple Pencil');
const sNo = generateScripts(noC, 3, 'Apple Pencil');
const objLabels = s.flatMap(x => x.timeline.map(b => b.label));
check('objection beat added to scripts', objLabels.some(l => /Kill the|Say who|Close the how/.test(l)), objLabels.join('|'));
check('no objection beat without comments', !sNo.flatMap(x => x.timeline.map(b => b.label)).some(l => /Kill the|Say who|Close the how/.test(l)));
check('objection line in must-say', s.every(x => x.mustSay.length >= 3));
check('timelines stay ordered', s.every(x => x.timeline.every((b, i, arr) => i === 0 || parseInt(b.t.slice(2, 4)) >= parseInt(arr[i - 1].t.slice(2, 4)))));
check('no template holes', !JSON.stringify(s).includes('undefined') && !JSON.stringify(s).includes('${'));

console.log('\n  sample objection beat:');
const beat = s[0].timeline.find(b => /Kill the|Say who|Close the how/.test(b.label));
if (beat) console.log(`    [${beat.t}] ${beat.label}\n    ${beat.line}`);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
