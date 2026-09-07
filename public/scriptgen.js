/* WhyViral script generator. Deterministic, keyless.
   Consumes the output of analyze() and produces shootable scripts. */

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const ANGLES = [
  {
    id: 'problem', name: 'Problem first', matches: ['hook_problem', 'has_negative_frame', 'hook_direct'],
    hooks: p => [
      `If you keep ${p.pain}, stop scrolling.`,
      `Nobody warns you about ${p.pain} until you're already dealing with it.`,
      `The reason you keep ${p.pain} isn't you. It's your setup.`,
    ],
    beats: p => [
      { label: 'Agitate', line: `Here's what that actually costs you every single day.`, shot: 'Close-up on the annoyance happening in real time. No face needed.' },
      { label: 'Turn', line: `So I switched to the ${p.product}.`, shot: 'Hard cut. Product enters frame in your hands.' },
      { label: 'Show', line: `Watch what happens now.`, shot: 'One continuous take of the thing working. This is the shot people rewatch.' },
      { label: 'Proof', line: `${cap(p.timeframe)} in and I haven't gone back once.`, shot: 'You, talking, product visible on the desk behind you.' },
    ],
  },
  {
    id: 'myth', name: 'Myth bust', matches: ['hook_negation', 'hook_curiosity', 'has_superlative'],
    hooks: p => [
      `Stop buying ${p.category} until you hear this.`,
      `Everyone's wrong about the ${p.product} and I can prove it.`,
      `You're using the ${p.product} wrong. Almost everyone is.`,
    ],
    beats: p => [
      { label: 'The claim', line: `Everyone says ${p.myth}.`, shot: 'Straight to camera, tight framing, no cuts yet.' },
      { label: 'The break', line: `That's not true, and here's the part they leave out.`, shot: 'Cut in tighter. Change your framing to signal a turn.' },
      { label: 'Evidence', line: `Look at this side by side.`, shot: 'Split screen or two quick cuts showing the difference.' },
      { label: 'Resolve', line: `That's the whole thing. That's why it's worth it.`, shot: 'Pull back to the wide. Product held up.' },
    ],
  },
  {
    id: 'test', name: 'I tested it', matches: ['hook_proof', 'has_number', 'has_price'],
    hooks: p => [
      `I used the ${p.product} every day for ${p.timeframe}. Here's the honest verdict.`,
      `I bought the ${p.product} so you don't have to.`,
      `${cap(p.timeframe)} with the ${p.product}. Three things nobody mentions.`,
    ],
    beats: p => [
      { label: 'Setup', line: `I bought it ${p.timeframe} ago, full price, nobody sent me this.`, shot: 'Product on a plain surface. Hands only.' },
      { label: 'Good', line: `The thing it genuinely nails is this.`, shot: 'Demonstrate the single best feature. Slow down here.' },
      { label: 'Bad', line: `And the part I'd change: ${p.flaw}.`, shot: 'Show the flaw honestly. This beat is what makes the rest believable.' },
      { label: 'Verdict', line: `Would I buy it again? Yes, and here's who it's actually for.`, shot: 'Talking head, product in frame.' },
    ],
  },
  {
    id: 'compare', name: 'Head to head', matches: ['hook_comparison', 'has_price', 'has_superlative'],
    hooks: p => [
      `${cap(p.product)} versus the one everybody already owns.`,
      `I put the ${p.product} against the ${p.rival}. It wasn't close.`,
      `Don't buy the ${p.rival}. Do this instead.`,
    ],
    beats: p => [
      { label: 'Frame', line: `Same job, same price range, completely different result.`, shot: 'Both items in frame, side by side, symmetrical.' },
      { label: 'Round one', line: `First test: the thing you'll actually do every day.`, shot: 'Same action performed with each. Cut between them fast.' },
      { label: 'Round two', line: `Second test is where it falls apart.`, shot: 'Close on the failure point of the loser.' },
      { label: 'Call it', line: `Winner, and it's not the expensive one.`, shot: 'Push the winner toward camera. Loser slides out of frame.' },
    ],
  },
  {
    id: 'pov', name: 'POV scene', matches: ['hook_pov', 'has_second_person', 'all_lowercase'],
    hooks: p => [
      `POV: you finally stopped ${p.pain}.`,
      `POV: someone asks why you're so obsessed with the ${p.product}.`,
      `me explaining the ${p.product} to my friend for the fourth time`,
    ],
    beats: p => [
      { label: 'Scene', line: `(no dialogue — let the on-screen text carry it)`, shot: 'You mid-action, already using it. Start in motion, never static.' },
      { label: 'Reveal', line: `This is the part they don't believe until they see it.`, shot: 'The satisfying moment, filmed close and slow.' },
      { label: 'Land', line: `That's it. That's the video.`, shot: 'Hold two extra seconds on the result. Loop-friendly ending.' },
    ],
  },
  {
    id: 'list', name: 'Three things', matches: ['hook_number', 'has_number', 'long_caption'],
    hooks: p => [
      `Three things I wish I knew before buying the ${p.product}.`,
      `Three ways to use the ${p.product} that nobody talks about.`,
      `The ${p.product} does three things. Number two is why I keep it.`,
    ],
    beats: p => [
      { label: 'One', line: `One: the obvious use, done properly.`, shot: 'Quick demo. On-screen counter top-left.' },
      { label: 'Two', line: `Two: the one that actually changed things for me.`, shot: 'Slow this beat down. It is the retention anchor.' },
      { label: 'Three', line: `Three: the one you'll use without thinking about it.`, shot: 'Fast, casual, handheld.' },
      { label: 'Close', line: `That's the whole case for it.`, shot: 'Product centered, hands out of frame.' },
    ],
  },
  {
    id: 'price', name: 'Price anchor', matches: ['hook_price', 'has_price', 'has_urgency'],
    hooks: p => [
      `${cap(p.product)}. Is it actually worth the money?`,
      `I almost didn't buy the ${p.product} because of the price. Mistake.`,
      `Here's exactly what you get for your money with the ${p.product}.`,
    ],
    beats: p => [
      { label: 'The number', line: `Let's just say the number out loud first.`, shot: 'Price as large on-screen text. Product in hand.' },
      { label: 'Objection', line: `Yes, that's more than the alternative. Here's the math.`, shot: 'Hands only, breaking down what you get.' },
      { label: 'Payoff', line: `Divide that over ${p.timeframe} and it stops being expensive.`, shot: 'The product doing its single most valuable job.' },
      { label: 'Close', line: `That's why I stopped hesitating.`, shot: 'Wide, calm, product resting in place.' },
    ],
  },
  {
    id: 'mistake', name: 'Mistake callout', matches: ['hook_negation', 'hook_command', 'has_negative_frame'],
    hooks: p => [
      `You're wasting the ${p.product} if you're doing this.`,
      `Stop doing this with your ${p.product}.`,
      `The mistake I made for ${p.timeframe} with my ${p.product}.`,
    ],
    beats: p => [
      { label: 'The mistake', line: `This is what most people do.`, shot: 'Demonstrate the wrong way. Slightly exaggerated.' },
      { label: 'Why it fails', line: `And this is why it never quite works.`, shot: 'Close on the bad result.' },
      { label: 'The fix', line: `Do it like this instead.`, shot: 'Same framing as the mistake shot so the contrast reads instantly.' },
      { label: 'Result', line: `Same product. Completely different outcome.`, shot: 'Both results side by side, held for two seconds.' },
    ],
  },
];

function params(topic, analysis, rng) {
  const product = (topic || 'this product').trim();
  const category = product.split(/\s+/).length > 1 ? product.split(/\s+/).slice(-1)[0] + 's' : product + 's';
  return {
    product, category,
    pain: pick(rng, ['fighting with the thing you already own', 'redoing the same task twice', 'giving up halfway through', 'losing it in a drawer every single week']),
    timeframe: pick(rng, ['two weeks', 'a month', 'sixty days', 'three months']),
    myth: pick(rng, ['it is overpriced', 'the cheap one does the same job', 'you only need it if you are a professional']),
    flaw: pick(rng, ['the price', 'the learning curve on day one', 'the fact that it does not come with a case']),
    rival: pick(rng, ['cheap one', 'name-brand version', 'one everyone recommends']),
  };
}

const OBJECTION_BEAT = {
  price: { label: 'Kill the price objection', line: 'And before you ask what it costs — here it is, and here is why that number is fine.', shot: 'Price as large on-screen text. Keep talking over it; do not pause.' },
  skeptical: { label: 'Kill the doubt', line: 'Nobody paid me for this, and here is the receipt.', shot: 'Show the proof plainly — receipt, timestamp, or the unedited result.' },
  compat: { label: 'Say who it is for', line: 'And yes, it works with yours. Here is exactly who this is for.', shot: 'On-screen list of what it works with. Two seconds, no voiceover needed.' },
  howto: { label: 'Close the how gap', line: 'Here is the part everyone asks about, start to finish.', shot: 'Slow, uncut demo of the step people keep asking about.' },
};

function generateScripts(analysis, count = 3, topic = '') {
  const seed = hash((topic || '') + analysis.videos.map(v => v.url).join('|'));
  const rng = mulberry(seed);
  const p = params(topic, analysis, rng);
  const active = new Set(analysis.findings.map(f => f.key));
  if (analysis.dominantHook) active.add(analysis.dominantHook.key);

  const ranked = ANGLES
    .map(a => ({ a, score: a.matches.filter(m => active.has(m)).length + rng() * 0.4 }))
    .sort((x, y) => y.score - x.score)
    .map(x => x.a);

  const chosen = [];
  for (let i = 0; chosen.length < count; i++) chosen.push(ranked[i % ranked.length]);

  const tags = analysis.sharedTags.slice(0, 6).map(t => '#' + t.tag);
  const lowercase = active.has('all_lowercase');
  const noPunct = active.has('no_punctuation');
  const wantsCTA = active.has('has_cta');

  return chosen.map((angle, i) => {
    const hookOptions = angle.hooks(p);
    const hook = hookOptions[i % hookOptions.length];
    const beats = angle.beats(p);
    let clock = 2;
    const timeline = [
      { t: '0:00 – 0:02', label: 'Hook', line: hook, shot: 'Start mid-motion. No intro, no logo, no "hey guys". The product or the problem is already on screen.' },
      ...beats.map(b => {
        const start = clock; const len = b.label === 'Show' || b.label === 'Two' ? 7 : 5; clock += len;
        return { t: `0:${String(start).padStart(2, '0')} – 0:${String(clock).padStart(2, '0')}`, ...b };
      }),
    ];
    /* If the audience raised the same objection across the set, every script
       answers it. This is the comment data doing real work. */
    const obj = analysis.audience && analysis.audience.objection;
    if (obj && OBJECTION_BEAT[obj.key]) {
      const start = clock; clock += 4;
      timeline.push({ t: `0:${String(start).padStart(2, '0')} – 0:${String(clock).padStart(2, '0')}`, ...OBJECTION_BEAT[obj.key] });
    }
    if (wantsCTA) timeline.push({ t: `0:${String(clock).padStart(2, '0')} – end`, label: 'CTA', line: pick(rng, [`Comment "${p.product.split(' ')[0].toLowerCase()}" and I'll send the link.`, `Save this before you buy anything.`, `Tell me if you'd try it.`]), shot: 'Text on screen, no voiceover. Keep the visual moving underneath.' });

    let caption = pick(rng, [`${hook}`, `${hook} full breakdown below`, `${hook} honest thoughts`]);
    if (lowercase) caption = caption.toLowerCase();
    if (noPunct) caption = caption.replace(/[.!?,;:]/g, '');

    return {
      id: `${angle.id}-${i}`, angle: angle.name, hook, timeline,
      caption: `${caption}${tags.length ? '\n\n' + tags.join(' ') : ''}`,
      hashtags: tags,
      mustSay: [
        hook,
        timeline.find(b => b.label === 'Show' || b.label === 'Turn' || b.label === 'The fix' || b.label === 'Payoff')?.line || beats[1].line,
        p.product,
        ...(analysis.audience?.objection && OBJECTION_BEAT[analysis.audience.objection.key]
          ? [OBJECTION_BEAT[analysis.audience.objection.key].line] : []),
      ].filter(Boolean),
      energy: pick(rng, ['Fast and flat — talk like you are mid-sentence already.', 'Calm and certain. Let the demo do the persuading.', 'Slightly annoyed at the start, relieved by the end.', 'Conspiratorial. Like you are telling one person a secret.']),
    };
  });
}
