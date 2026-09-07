import { loadEngine } from './_load.mjs';
const { analyze, extractFeatures, generateScripts } = loadEngine();

const SETS = {
  'Apple Pencil': [
    { url: 'https://www.tiktok.com/@a/video/1', author: 'studywithmei', caption: "stop buying the apple pencil pro if you're just taking notes 😭 the usb-c one does everything you actually need #applepencil #studytok #ipadnotes #studentlife" },
    { url: 'https://www.tiktok.com/@b/video/2', author: 'techbylena', caption: "you're using your apple pencil wrong. nobody tells you about the double tap #applepencil #ipadtips #techtok #productivity" },
    { url: 'https://www.tiktok.com/@c/video/3', author: 'notesbyjay', caption: "3 apple pencil settings i wish i knew before spending $129 #applepencil #ipad #studytok #notetaking" },
  ],
  'Whoop band': [
    { url: 'https://www.tiktok.com/@d/video/4', author: 'runwithsam', caption: "I wore the whoop for 90 days. honest review, nobody paid me for this #whoop #fitnesstok #recovery #marathontraining" },
    { url: 'https://www.tiktok.com/@e/video/5', author: 'lifthouse', caption: "whoop vs oura ring after 6 months with both. it wasn't close #whoop #ourarung #wearabletech #fitness" },
    { url: 'https://www.tiktok.com/@f/video/6', author: 'coachdev', caption: "if you're training hard and still tired, your recovery data is telling you something #whoop #recovery #fitnesstok #overtraining" },
    { url: 'https://www.tiktok.com/@g/video/7', author: 'mattruns', caption: "is whoop worth $30 a month? here's the actual math #whoop #fitnesstech #honestreview" },
  ],
  'Stanley cup': [
    { url: 'https://www.tiktok.com/@h/video/8', author: 'homewithkat', caption: "run don't walk 🏃‍♀️ the new stanley color just dropped and it's already selling out #stanleycup #tiktokshop #tiktokmademebuyit" },
    { url: 'https://www.tiktok.com/@i/video/9', author: 'sipsbyari', caption: "restock alert 🚨 grab it before it's gone again #stanley #stanleytumbler #tiktokshop #deal" },
    { url: 'https://www.tiktok.com/@j/video/10', author: 'mugcollector', caption: "limited edition stanley, last chance today only 😍 link in bio #stanleycup #tiktokshop #sale" },
  ],
  'Thin data (worst case)': [
    { url: 'https://www.tiktok.com/@k/video/11', author: 'x', caption: '' },
    { url: 'https://www.tiktok.com/@l/video/12', author: 'y', caption: '#fyp' },
    { url: 'https://www.tiktok.com/@m/video/13', author: 'z', caption: 'lol' },
  ],
  'No overlap (should find little)': [
    { url: 'https://www.tiktok.com/@n/video/14', author: 'p1', caption: 'Making dinner for the family tonight, roast chicken and potatoes.' },
    { url: 'https://www.tiktok.com/@o/video/15', author: 'p2', caption: 'POV: your cat knocks over the plant again #catsoftiktok' },
    { url: 'https://www.tiktok.com/@p/video/16', author: 'p3', caption: '5 things I learned filing taxes as a freelancer this year #taxes #freelance #money #smallbusiness #selfemployed' },
  ],
};

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${name} ${detail}`); } };

for (const [topic, vids] of Object.entries(SETS)) {
  const a = analyze(vids, { topic });
  console.log(`\n=== ${topic} (${vids.length} videos, confidence: ${a.confidence}) ===`);
  console.log(`findings: ${a.findings.length} | shared tags: ${a.sharedTags.map(t => '#' + t.tag).join(' ') || 'none'}`);
  a.findings.slice(0, 6).forEach(f => console.log(`  [${f.hits}/${f.of}] lift ${f.lift}x  ${f.label}`));

  check(`${topic}: no crash`, !!a);
  check(`${topic}: video count`, a.videoCount === vids.length);
  check(`${topic}: findings have valid hit counts`, a.findings.every(f => f.hits >= 2 && f.hits <= vids.length));
  check(`${topic}: findings sorted by score`, a.findings.every((f, i, arr) => i === 0 || arr[i - 1].score >= f.score));
  check(`${topic}: every finding has a why`, a.findings.every(f => f.why && f.why.length > 20));
  check(`${topic}: lift threshold respected`, a.findings.every(f => f.lift >= 1.25));

  for (const n of [1, 3, 6]) {
    const s = generateScripts(a, n, topic);
    check(`${topic}: ${n} scripts generated`, s.length === n, `got ${s.length}`);
    check(`${topic}: scripts have hooks`, s.every(x => x.hook && x.hook.length > 10));
    check(`${topic}: timelines non-empty`, s.every(x => x.timeline.length >= 4));
    check(`${topic}: must-say present`, s.every(x => x.mustSay.length >= 2));
    check(`${topic}: no template holes`, s.every(x => !JSON.stringify(x).includes('undefined') && !JSON.stringify(x).includes('${')));
  }
  const twice = JSON.stringify(generateScripts(a, 3, topic)) === JSON.stringify(generateScripts(a, 3, topic));
  check(`${topic}: deterministic output`, twice);
}

const thin = analyze(SETS['Thin data (worst case)'], { topic: 'x' });
check('thin data flagged low confidence', thin.confidence === 'low', `got ${thin.confidence}`);
const noise = analyze(SETS['No overlap (should find little)'], { topic: 'x' });
check('unrelated set finds few patterns', noise.findings.length <= 4, `got ${noise.findings.length}`);
const stanley = analyze(SETS['Stanley cup'], { topic: 'Stanley cup' });
check('urgency detected in stanley set', stanley.findings.some(f => f.key === 'has_urgency'));
check('shop hashtag detected', stanley.findings.some(f => f.key === 'shop_hashtag'));
const pencil = analyze(SETS['Apple Pencil'], { topic: 'Apple Pencil' });
check('shared hashtag found', pencil.sharedTags.some(t => t.tag === 'applepencil'));

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
