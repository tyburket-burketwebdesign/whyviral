import { loadEngine } from './_load.mjs';
const { analyze, extractFeatures, measureBaseRates, BASE_RATES, generateScripts } = loadEngine();

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };

/* Shaped exactly like functions/api/enrich.js output. */
const win = (o) => ({
  url: `https://www.tiktok.com/@x/video/${o.id}`, caption: o.caption, hashtags: o.tags,
  transcript: o.spoken ?? '', duration: o.dur, soundOriginal: o.orig ?? true,
  creatorCaptioned: o.cc ?? true, followerCount: o.followers ?? 12000,
  stats: { plays: o.plays, likes: o.likes, comments: o.comments, shares: o.shares, saves: o.saves },
  rates: { like: o.likes / o.plays, comment: o.comments / o.plays, share: o.shares / o.plays, save: o.saves / o.plays },
});

const WINNERS = [
  win({ id: 1, caption: 'the apple pencil setting nobody turns on #applepencil #ipad #studytok', tags: ['applepencil', 'ipad', 'studytok'],
        spoken: "Stop scrolling if you own an Apple Pencil. Nobody turns this setting on and it changes everything about note taking.", dur: 22,
        plays: 2400000, likes: 310000, comments: 4200, shares: 88000, saves: 190000 }),
  win({ id: 2, caption: 'you are using your apple pencil wrong #applepencil #ipadtips', tags: ['applepencil', 'ipadtips'],
        spoken: "You're using your Apple Pencil wrong and I was too for a whole year. Here is the double tap trick.", dur: 19,
        plays: 1800000, likes: 260000, comments: 3100, shares: 71000, saves: 150000 }),
  win({ id: 3, caption: '3 apple pencil settings i wish i knew #applepencil #studytok', tags: ['applepencil', 'studytok'],
        spoken: "Three Apple Pencil settings I wish I knew before I spent a hundred and twenty nine dollars on this thing.", dur: 26,
        plays: 3100000, likes: 420000, comments: 5900, shares: 120000, saves: 240000 }),
];

/* Ordinary videos on the same tag: longer, no hook structure, weak engagement. */
const CONTROL = {
  source: '#applepencil',
  videos: Array.from({ length: 12 }, (_, i) => ({
    caption: `my ipad setup for school ${i} #applepencil #ipad #aesthetic #studygram`,
    hashtags: ['applepencil', 'ipad', 'aesthetic', 'studygram'],
    duration: 55 + i, soundOriginal: false, followerCount: 90000 + i * 1000,
    transcript: 'Hey guys welcome back to my channel today I wanted to show you my whole desk setup and everything I use for school this semester.',
    rates: { like: 0.04, comment: 0.001, share: 0.002, save: 0.006 },
  })),
  medianRates: { share: 0.002, save: 0.006, comment: 0.001, like: 0.04 },
  medianPlays: 14000,
};

console.log('--- enriched path ---');

const f = extractFeatures(WINNERS[0]);
check('spoken hook preferred over caption', f.hookSource === 'spoken', f.hookSource);
check('hook text comes from transcript', f.hookText.toLowerCase().startsWith('stop scrolling'), f.hookText);
check('wpm computed', f.wpm > 0 && f.wpm < 400, String(f.wpm));
check('duration carried through', f.duration === 22);
check('rates carried through', !!f.rates && f.rates.share > 0);
check('short_video trait fires', f.traits.short_video === true);
check('original_sound trait fires', f.traits.original_sound === true);
check('creator_captioned trait fires', f.traits.creator_captioned === true);
check('small_creator trait fires', f.traits.small_creator === true);
check('marked as enriched', f.enriched === true);

/* Traits that need enrichment must NOT fire on a caption-only video. */
const bare = extractFeatures({ url: 'u', caption: 'stop buying this #x' });
check('duration traits silent without data', !bare.traits.short_video && !bare.traits.very_short_video);
check('sound trait silent without data', bare.traits.original_sound === false);
check('creator trait silent without data', bare.traits.small_creator === false);
check('bare video not marked enriched', bare.enriched === false);
check('bare video falls back to caption hook', bare.hookSource === 'caption');

const measured = measureBaseRates(CONTROL.videos);
check('base rates measured for every key', Object.keys(measured.rates).length === Object.keys(BASE_RATES).length);
check('control n reported', measured.n === 12);
check('rates clamped below 1', Object.values(measured.rates).every(r => r > 0 && r <= 0.95));
check('control long_video rate is high', measured.rates.long_video > 0.8, String(measured.rates.long_video));
check('control hook_negation rate is low', measured.rates.hook_negation < 0.2, String(measured.rates.hook_negation));

const withControl = analyze(WINNERS, { topic: 'Apple Pencil', control: CONTROL });
const noControl = analyze(WINNERS, { topic: 'Apple Pencil' });

check('baseline marked measured', withControl.baseline.source === 'measured');
check('baseline reports n', withControl.baseline.n === 12);
check('baseline names its source', withControl.baseline.from === '#applepencil');
check('baseline marked estimated without control', noControl.baseline.source === 'estimated');
check('control changes the lift numbers', JSON.stringify(withControl.findings) !== JSON.stringify(noControl.findings));

console.log(`\n  measured baseline (n=12), top findings:`);
withControl.findings.slice(0, 6).forEach(x => console.log(`    [${x.hits}/${x.of}] ${x.lift}x  ${x.label}`));

check('findings produced with control', withControl.findings.length >= 3, String(withControl.findings.length));
check('short_video surfaces vs long control', withControl.findings.some(f => f.key === 'short_video'));
check('every lift is finite', withControl.findings.every(f => isFinite(f.lift) && f.lift < 100));
check('confidence upgraded by measurement', withControl.confidence === 'high', withControl.confidence);

console.log(`  engagement vs control:`);
withControl.metrics.forEach(m => console.log(`    ${m.label}: ${m.multiple}x control`));
check('engagement metrics computed', withControl.metrics.length === 4, String(withControl.metrics.length));
check('share rate multiple is large', withControl.metrics.find(m => m.key === 'share').multiple > 5);
check('metrics sorted by multiple', withControl.metrics.every((m, i, a) => i === 0 || a[i - 1].multiple >= m.multiple));
check('no metrics without control', noControl.metrics.length === 0);
check('every metric has a note', withControl.metrics.every(m => m.note && m.note.length > 20));

check('caveat mentions audio when enriched', /spoken audio/i.test(withControl.caveat));
check('caveat still flags on-screen text gap', /on-screen/i.test(withControl.caveat));
check('enriched count reported', withControl.stats.enrichedCount === 3);
check('speech count reported', withControl.stats.withSpeech === 3);

/* Too-small control must be ignored rather than trusted. */
const tiny = analyze(WINNERS, { topic: 'x', control: { videos: CONTROL.videos.slice(0, 3), medianRates: CONTROL.medianRates } });
check('undersized control rejected', tiny.baseline.source === 'estimated');

/* Silent video handling. */
const silent = extractFeatures({ url: 'u', caption: 'no talking just vibes #asmr', transcript: '', duration: 12 });
check('silent video detected', silent.traits.silent_video === true);
check('silent video still has caption hook', silent.hookText.length > 0);

/* Mixed set: some enriched, some not. Must not crash or double-count. */
const mixed = analyze([WINNERS[0], WINNERS[1], { url: 'u3', caption: 'stop doing this #applepencil' }], { topic: 'Apple Pencil', control: CONTROL });
check('mixed enrichment does not crash', mixed.findings.length >= 1);
check('mixed enrichment counted correctly', mixed.stats.enrichedCount === 2, String(mixed.stats.enrichedCount));
check('mixed caveat falls back to conservative', /Spoken audio and on-screen text are not read/.test(mixed.caveat));

/* Scripts must still generate from an enriched analysis. */
for (const n of [1, 3, 6]) {
  const s = generateScripts(withControl, n, 'Apple Pencil');
  check(`scripts generate from enriched (${n})`, s.length === n);
  check(`no template holes (${n})`, !JSON.stringify(s).includes('undefined') && !JSON.stringify(s).includes('${'));
}

/* Live data showed hashtag search returns no follower counts and no
   transcripts, so traits needing those must NOT be scored against a control
   that could never express them — that manufactures huge fake lifts. */
const THIN_CONTROL = {
  source: '#applepencil',
  videos: Array.from({ length: 12 }, (_, i) => ({
    caption: `my ipad setup ${i} #applepencil #aesthetic`,
    hashtags: ['applepencil', 'aesthetic'], duration: 55 + i,
    soundOriginal: false, followerCount: 0,   // exactly what the API returns
  })),
  medianRates: { share: 0.002, save: 0.006, comment: 0.001, like: 0.04 },
  medianPlays: 139784,
};
const thinC = analyze(WINNERS, { topic: 'Apple Pencil', control: THIN_CONTROL });
const smallCreator = thinC.findings.find(f => f.key === 'small_creator');
const captioned = thinC.findings.find(f => f.key === 'creator_captioned');
const talks = thinC.findings.find(f => f.key === 'talks_fast' || f.key === 'talks_slow');

check('follower-count trait not scored against a control lacking it', !smallCreator || smallCreator.measured === false, JSON.stringify(smallCreator && smallCreator.lift));
check('caption trait not scored against a control lacking it', !captioned || captioned.measured === false);
check('pace trait not scored against a control lacking it', !talks || talks.measured === false);
check('duration trait IS measured (control has durations)',
  (thinC.findings.find(f => f.key === 'short_video') || {}).measured !== false);
check('baseline reports partial coverage', thinC.baseline.partial > 0, String(thinC.baseline.partial));
check('caption-based traits still measured', thinC.findings.some(f => f.measured === true));
check('no finding claims an impossible lift', thinC.findings.every(f => f.lift <= 5));

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
