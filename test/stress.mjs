import { loadEngine } from './_load.mjs';
const { analyze, generateScripts } = loadEngine();

const S = {
  'Whoop band': ["I wore whoop for 90 days honest review nobody paid me #whoop #fitnesstok", "whoop vs oura after 6 months with both #whoop #ourarung #wearables", "is whoop worth $30 a month here's the math #whoop #honestreview", "if you're training hard and still exhausted your recovery data is telling you something #whoop #recovery"],
  'Dyson Airwrap': ["stop using the airwrap like this 😭 #dyson #airwrap #hairtok", "3 airwrap attachments i never use and 2 i can't live without #airwrap #hairtok", "is the dyson airwrap worth $600 honest answer #dyson #hairtools"],
  'Owala water bottle': ["run don't walk the new owala color dropped 🏃‍♀️ #owala #tiktokshop #hydration", "restock alert 🚨 grab it before it's gone #owala #tiktokshop", "limited edition owala today only link in bio #owala #deal #tiktokshop"],
  'Air fryer': ["you're preheating your air fryer wrong #airfryer #cooktok #kitchenhacks", "5 things i cook in my air fryer every single week #airfryer #mealprep #easyrecipes", "nobody told me the air fryer basket does this #airfryer #kitchentok"],
  'Kindle': ["POV: you finally stopped doom scrolling #kindle #booktok #reading", "i read 40 books this year because of this #kindle #booktok", "kindle vs paperback after 2 years honestly #kindle #booktok #reading"],
  'Standing desk': ["if your back hurts by 3pm this is why #standingdesk #wfh #posture", "i tested a standing desk for 60 days here's what changed #standingdesk #wfh", "standing desk mistakes almost everyone makes #standingdesk #ergonomics"],
  'AirPods Pro': ["stop cleaning your airpods with water #airpods #techtok #applehacks", "the airpods setting nobody turns on #airpods #techtok #ios", "airpods pro vs the $30 pair honest test #airpods #techreview"],
  'Rare Beauty blush': ["one dot. that's it. that's the tutorial #rarebeauty #makeuptok #blush", "you're using way too much rare beauty blush #rarebeauty #makeup", "rare beauty blush swatches on deeper skin #rarebeauty #makeuptok #blush"],
  'Robot vacuum': ["worth every dollar and i'll tell you why #robotvacuum #cleantok #homehacks", "3 months with a robot vacuum the honest truth #robotvacuum #cleantok", "why your robot vacuum keeps getting stuck #robotvacuum #cleaning"],
  'Notion': ["stop overbuilding your notion setup #notion #productivity #studytok", "the only 3 notion pages you actually need #notion #productivity", "notion vs paper planner after a year #notion #productivity #organization"],
  'Creatine': ["everything you've heard about creatine is wrong #creatine #gymtok #fitness", "i took creatine for 90 days here's what actually happened #creatine #gym", "creatine myths that need to die #creatine #fitnesstok #supplements"],
  'Cast iron pan': ["you're ruining your cast iron doing this #castiron #cooktok", "cast iron seasoning in 3 steps #castiron #kitchentok #cooking", "why my cast iron is better than nonstick #castiron #cooking"],
  'Ring light': ["your lighting is why your videos flop #ringlight #contentcreator #creatortips", "$20 ring light vs $200 honest comparison #ringlight #contentcreation", "3 lighting mistakes killing your videos #ringlight #creatortips"],
  'Sleep mask': ["the reason you wake up tired #sleepmask #sleeptok #wellness", "i tried 6 sleep masks so you don't have to #sleepmask #sleep", "if you sleep on your side you need this #sleepmask #sleeptips"],
  'Electric toothbrush': ["your dentist wishes you knew this #electrictoothbrush #dentaltok", "is the expensive toothbrush worth it honest answer #oralcare #dentist", "stop brushing like this #electrictoothbrush #dentaltok #teeth"],
  'Meal prep containers': ["meal prep for the whole week in 45 minutes #mealprep #healthyeating", "the container mistake wasting your food #mealprep #foodstorage", "5 meal prep containers ranked #mealprep #kitchen #healthy"],
  'Bluetooth tracker': ["i lost my keys 40 times last year. not anymore #airtag #techtok", "airtag vs tile which actually works #airtag #tile #techreview", "3 places to put an airtag you haven't thought of #airtag #travel"],
  'Skincare fridge': ["do you actually need a skincare fridge honest answer #skincare #skintok", "$40 skincare fridge one month later #skincare #beautytok", "skincare fridge what to keep in it #skincare #skintok #beauty"],
  'Portable charger': ["never be at 3% again #portablecharger #techtok #travel", "the power bank mistake everyone makes at the airport #travel #techtips", "3 power banks tested on a 14 hour flight #portablecharger #travelhacks"],
  'Vitamin C serum': ["stop layering your vitamin c with this #skincare #skintok #vitaminc", "i used vitamin c for 8 weeks here are the photos #skincare #skintok", "the vitamin c mistake ruining your results #vitaminc #skincare"],
};

let runs = 0, issues = 0, findingTotals = [], zeroFind = [];
for (const [topic, caps] of Object.entries(S)) {
  const vids = caps.map((c, i) => ({ url: `https://www.tiktok.com/@x/video/${i}`, caption: c, author: 'x' }));
  const a = analyze(vids, { topic });
  runs++;
  findingTotals.push(a.findings.length);
  if (a.findings.length === 0) zeroFind.push(topic);

  const bad = [];
  if (a.findings.some(f => f.hits > vids.length)) bad.push('impossible hit count');
  if (a.findings.some(f => !f.why || f.why.length < 20)) bad.push('missing rationale');
  if (a.findings.some(f => f.lift < 1.25)) bad.push('below lift floor');
  if (!['low', 'medium', 'high'].includes(a.confidence)) bad.push('bad confidence');

  for (const n of [1, 2, 3, 4, 5, 6]) {
    const s = generateScripts(a, n, topic);
    runs++;
    const j = JSON.stringify(s);
    if (s.length !== n) bad.push(`wrong script count at ${n}`);
    if (j.includes('undefined') || j.includes('${') || j.includes('null,')) bad.push(`template hole at ${n}`);
    if (s.some(x => x.timeline.some(b => !b.line || !b.shot || !b.t))) bad.push(`empty beat at ${n}`);
    if (s.some(x => x.hook.length < 12)) bad.push(`weak hook at ${n}`);
    if (n > 1 && new Set(s.map(x => x.hook)).size !== n) bad.push(`duplicate hooks at ${n}`);
  }
  const flag = bad.length ? ' <<< ' + [...new Set(bad)].join(', ') : '';
  if (bad.length) issues++;
  console.log(`${topic.padEnd(24)} ${String(a.findings.length).padStart(2)} traits  ${a.confidence.padEnd(6)} top: ${a.findings[0]?.label.slice(0, 42) || '—'}${flag}`);
}

const avg = (findingTotals.reduce((a, b) => a + b, 0) / findingTotals.length).toFixed(1);
console.log(`\n${runs} analysis + generation runs across ${Object.keys(S).length} niches`);
console.log(`avg traits found: ${avg} | niches with zero: ${zeroFind.length ? zeroFind.join(', ') : 'none'}`);
console.log(issues ? `\n${issues} niches had issues` : '\nno issues across any niche');
process.exit(issues ? 1 : 0);
