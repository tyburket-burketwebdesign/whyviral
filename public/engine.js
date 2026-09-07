/* WhyViral analysis engine.
   Pure functions. No network, no keys. Runs identically in browser and node. */

const STOPWORDS = new Set(('a an and the to of in for on with is are was were be been being it its this that these those i me my you your yours he she they them we us our so if but or as at by from up out just now then than too very can will would should could do does did doing have has had not no yes get got go going about over under again more most some such only own same s t don now d ll m o re ve y ain aren couldn didn doesn hadn hasn haven isn ma mightn mustn needn shan shouldn wasn weren won wouldn im ive dont thats whats heres theres like really actually literally').split(' '));

const POWER_WORDS = ['obsessed','viral','underrated','overrated','game changer','gamechanger','life changing','worth it','waste','regret','mistake','secret','nobody','everyone','finally','honestly','shocked','insane','crazy','hack','trick','warning','stop','never','always','proof','tested','review','honest','truth','scam','worth','before','after','hidden','sold out','restock'];
const CTA_PATTERNS = /\b(link in bio|linkinbio|comment|dm me|dm us|follow for|save this|share this|tag someone|check out|shop now|grab|get yours|swipe|click|run don'?t walk|add to cart|tap the)\b/i;
const URGENCY = /\b(sold out|selling out|restock|limited|last chance|hurry|before|today only|while (you|they) can|back in stock|almost gone|deal|sale)\b/i;
const PRICE = /(\$\s?\d|\d+\s?(dollars|bucks)|under \$?\d|cheap|expensive|affordable|budget|worth the money|price)/i;
const SUPERLATIVE = /\b(best|worst|only|#1|number one|favorite|top|ultimate|perfect|greatest|must have|musthave)\b/i;
const NEGATIVE_FRAME = /\b(stop|don'?t|never|avoid|mistake|wrong|worst|hate|regret|waste|scam|problem|struggle|annoying|tired of|sick of)\b/i;
const SECOND_PERSON = /\b(you|your|you'?re|yourself|ur)\b/i;

/* Static base rates: roughly how often each trait shows up across ordinary
   TikTok product content. Used to compute lift so near-universal traits don't
   get reported as insight. Replace with a live control set when you add an API. */
const BASE_RATES = {
  hook_question: 0.22, hook_negation: 0.11, hook_curiosity: 0.14, hook_number: 0.12,
  hook_direct: 0.26, hook_problem: 0.17, hook_proof: 0.09, hook_price: 0.10,
  hook_pov: 0.13, hook_comparison: 0.07, hook_command: 0.15, hook_story: 0.12,
  has_cta: 0.54, has_urgency: 0.19, has_price: 0.28, has_superlative: 0.41,
  has_negative_frame: 0.24, has_second_person: 0.62, has_question: 0.31,
  has_number: 0.34, has_emoji: 0.66, no_punctuation: 0.51, all_lowercase: 0.55,
  short_caption: 0.46, long_caption: 0.22, hashtag_light: 0.43, hashtag_heavy: 0.31,
  power_word: 0.44, shop_hashtag: 0.27, niche_hashtag: 0.48,
  talks_fast: 0.24, talks_slow: 0.21, very_short_video: 0.30, short_video: 0.34,
  long_video: 0.20, original_sound: 0.58, creator_captioned: 0.36,
  small_creator: 0.45, silent_video: 0.18,
};

const HOOK_RULES = [
  { key: 'hook_question',   label: 'Opens on a question',            test: t => /^[^.!?]{0,90}\?/.test(t) || /^(why|how|what|when|who|which|is|are|do|does|did|can|should|would)\b/i.test(t) },
  { key: 'hook_negation',   label: 'Opens by telling you to stop',    test: t => /^(stop|don'?t|never|quit|avoid|please don'?t)\b/i.test(t) },
  { key: 'hook_number',     label: 'Opens with a number or count',    test: t => /^\d+\s|\b(\d+)\s+(things|ways|reasons|tips|mistakes|hacks|products)\b/i.test(t) },
  { key: 'hook_pov',        label: 'POV or scenario framing',         test: t => /^(pov|me when|when you|that moment|imagine)\b/i.test(t) },
  { key: 'hook_price',      label: 'Leads with price or value',       test: t => /^(\$|under \$|\d+\s?(dollars|bucks))|^(worth it|is it worth)/i.test(t) },
  { key: 'hook_comparison', label: 'Leads with a comparison',         test: t => /\b(vs\.?|versus|compared to|better than|instead of)\b/i.test(t) },
  { key: 'hook_proof',      label: 'Leads with proof or testing',     test: t => /^(i (tested|tried|bought|used|wore|took|ate|drank|ran|switched|swapped|spent|wear|carried)|after \d|\d+ (days|weeks|months))/i.test(t) || /\b(here'?s what (actually )?happened|honest (review|verdict|answer|thoughts)|i (tested|tried) \d)\b/i.test(t) },
  { key: 'hook_problem',    label: 'Names a problem first',           test: t => /^(if you|tired of|sick of|struggling|hate it when|the problem with|nobody tells you|the reason you|why your|your .* (is|keeps|wont|won'?t))/i.test(t) },
  { key: 'hook_curiosity',  label: 'Withholds the payoff',            test: t => /\b(nobody|no one|secret|hidden|wish i knew|didn'?t know|here'?s why|the reason|myths?|the truth about|what (nobody|no one) (tells|talks)|is wrong|are wrong|need to die|nobody talks about)\b/i.test(t) || /you'?re .* wrong/i.test(t) },
  { key: 'hook_command',    label: 'Opens with a direct command',     test: t => /^(run|go|watch|listen|look|try|buy|get|grab|hear me out|trust me)\b/i.test(t) },
  { key: 'hook_direct',     label: 'Speaks straight to the viewer',   test: t => /^(you|your|if you|for anyone|for everyone|to the)\b/i.test(t) },
];

const SHOP_TAGS = /^(tiktokshop|tiktokmademebuyit|tiktokfinds|amazonfinds|founditonamazon|creatorsearchinsights|ttsdelivery|sale|deal|blackfriday)$/i;

const ENGAGEMENT_KEYS = ['share', 'save', 'comment', 'like'];

function extractFeatures(video) {
  const caption = (video.caption || '').trim();
  const overlay = (video.overlay || '').trim();
  const spoken = (video.transcript || '').trim();

  /* Everything the creator communicated, for trait scanning. */
  const text = [overlay, caption, spoken].filter(Boolean).join('. ').trim();
  const lower = text.toLowerCase();

  const hashtags = Array.isArray(video.hashtags) && video.hashtags.length
    ? video.hashtags.map(h => String(h).replace(/^#/, '').toLowerCase())
    : (caption.match(/#[\p{L}\p{N}_]+/gu) || []).map(h => h.slice(1).toLowerCase());

  const body = [overlay, caption].filter(Boolean).join('. ')
    .replace(/#[\p{L}\p{N}_]+/gu, '').replace(/@[\p{L}\p{N}_.]+/gu, '').trim();
  const emoji = (text.match(/[\p{Extended_Pictographic}]/gu) || []).length;
  const words = body.split(/\s+/).filter(Boolean);
  const letters = body.replace(/[^a-zA-Z]/g, '');
  const uppers = (body.match(/[A-Z]/g) || []).length;

  /* The hook is whatever the viewer meets first. When we have the spoken
     track that IS the hook; the caption is often unrelated marketing text. */
  const firstSentence = t => (t.split(/(?<=[.!?])\s|\n/)[0] || t).slice(0, 140).trim();
  const spokenHook = spoken ? firstSentence(spoken) : '';
  const writtenHook = firstSentence(overlay || body);
  const hookText = spokenHook || writtenHook;
  const hookSource = spokenHook ? 'spoken' : (overlay ? 'on-screen' : 'caption');

  const spokenWords = spoken ? spoken.split(/\s+/).filter(Boolean).length : 0;
  const duration = video.duration ?? null;
  const wpm = (spokenWords && duration) ? Math.round((spokenWords / duration) * 60) : null;
  const rates = video.rates || null;

  const hooks = HOOK_RULES.filter(r => r.test(hookText.toLowerCase())).map(r => r.key);
  const powerFound = POWER_WORDS.filter(w => lower.includes(w));

  const traits = {
    has_cta: CTA_PATTERNS.test(text),
    has_urgency: URGENCY.test(text),
    has_price: PRICE.test(text),
    has_superlative: SUPERLATIVE.test(text),
    has_negative_frame: NEGATIVE_FRAME.test(text),
    has_second_person: SECOND_PERSON.test(text),
    has_question: /\?/.test(body) || /\?/.test(spokenHook),
    has_number: /\d/.test(body) || /\d/.test(spoken),
    has_emoji: emoji > 0,
    no_punctuation: body.length > 12 && !/[.!?,;:]/.test(body),
    all_lowercase: letters.length > 12 && uppers === 0,
    short_caption: words.length > 0 && words.length <= 9,
    long_caption: words.length >= 26,
    hashtag_light: hashtags.length > 0 && hashtags.length <= 3,
    hashtag_heavy: hashtags.length >= 8,
    power_word: powerFound.length > 0,
    shop_hashtag: hashtags.some(h => SHOP_TAGS.test(h)),
    niche_hashtag: hashtags.some(h => h.length > 11 && !SHOP_TAGS.test(h)),

    /* Only meaningful once a key is wired in. Left false otherwise, which
       keeps them out of findings rather than producing false negatives. */
    talks_fast: wpm !== null && wpm >= 165,
    talks_slow: wpm !== null && wpm > 0 && wpm <= 115,
    very_short_video: duration !== null && duration <= 15,
    short_video: duration !== null && duration > 15 && duration <= 30,
    long_video: duration !== null && duration > 45,
    original_sound: video.soundOriginal === true,
    creator_captioned: video.creatorCaptioned === true,
    small_creator: typeof video.followerCount === 'number' && video.followerCount > 0 && video.followerCount < 50000,
    silent_video: spoken === '' && video.transcript !== undefined && duration !== null,
  };
  for (const r of HOOK_RULES) traits[r.key] = hooks.includes(r.key);

  const analyzedChars = (overlay + caption + spoken).length;
  return {
    url: video.url, author: video.author || null, thumbnail: video.thumbnail || null,
    caption, spoken, hookText, hookSource, spokenHook, writtenHook,
    hashtags, words: words.length, chars: body.length, emoji, powerWords: powerFound,
    duration, wpm, rates, stats: video.stats || null, traits,
    comments: Array.isArray(video.comments) ? video.comments : [],
    enriched: !!(video.transcript !== undefined || video.stats),
    tokens: [...words, ...(spoken ? spoken.split(/\s+/) : [])]
      .map(w => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ''))
      .filter(w => w.length > 2 && !STOPWORDS.has(w)),
    sourceQuality: analyzedChars < 15 ? 'thin' : analyzedChars < 60 ? 'partial' : 'good',
  };
}

/* How much a trait is worth telling someone. A shared hook structure changes
   how you shoot the video; a hashtag count barely changes anything. Both can be
   true at 3 of 3, so ranking on prevalence alone buries the useful finding. */
const WEIGHTS = {
  hook_question: 1, hook_negation: 1, hook_curiosity: 1, hook_number: 1, hook_direct: 1,
  hook_problem: 1, hook_proof: 1, hook_price: 1, hook_pov: 1, hook_comparison: 1, hook_command: 1,
  has_negative_frame: .92, has_second_person: .88, has_cta: .85, has_urgency: .85,
  has_price: .82, has_superlative: .8, has_question: .78, has_number: .72,
  power_word: .7, all_lowercase: .38, no_punctuation: .38, has_emoji: .3,
  short_caption: .4, long_caption: .45, shop_hashtag: .6, niche_hashtag: .45,
  hashtag_light: .28, hashtag_heavy: .3,
  talks_fast: .9, talks_slow: .85, very_short_video: .8, short_video: .75,
  long_video: .75, original_sound: .7, creator_captioned: .78,
  small_creator: .68, silent_video: .8,
};

const LABELS = Object.fromEntries(HOOK_RULES.map(r => [r.key, r.label]));
Object.assign(LABELS, {
  has_cta: 'Explicit call to action in the caption',
  has_urgency: 'Scarcity or urgency language',
  has_price: 'Price or value is named out loud',
  has_superlative: 'Absolute claim (best, only, must-have)',
  has_negative_frame: 'Framed around a problem, not a feature',
  has_second_person: 'Written to "you", not about the product',
  has_question: 'Asks the viewer something directly',
  has_number: 'Uses a specific number',
  has_emoji: 'Emoji in the caption',
  no_punctuation: 'Punctuation stripped — reads like a text message',
  all_lowercase: 'All lowercase, deliberately casual',
  short_caption: 'Very short caption — the video carries it',
  long_caption: 'Long caption doing real work below the fold',
  hashtag_light: 'Three or fewer hashtags',
  hashtag_heavy: 'Heavy hashtag stack',
  power_word: 'High-charge vocabulary',
  shop_hashtag: 'Tagged into shop and discovery feeds',
  niche_hashtag: 'Long-tail niche hashtags, not just broad ones',
  talks_fast: 'Delivered fast — well above normal speaking pace',
  talks_slow: 'Delivered slowly and deliberately',
  very_short_video: 'Under 15 seconds',
  short_video: 'Between 15 and 30 seconds',
  long_video: 'Runs past 45 seconds',
  original_sound: 'Original sound, not a trending audio',
  creator_captioned: 'Creator added their own captions',
  small_creator: 'Posted by an account under 50k followers',
  silent_video: 'No speech at all — text and visuals carry it',
});

const WHY = {
  hook_question: 'A question opens a loop the brain wants closed, which buys you the next two seconds.',
  hook_negation: 'Telling someone to stop implies they are already doing it wrong. That stings enough to hold attention.',
  hook_number: 'A number promises a finite, skippable structure, so the viewer knows what they are committing to.',
  hook_pov: 'POV puts the viewer inside the scene instead of watching an ad.',
  hook_price: 'Price up front filters for buyers and pre-empts the first objection.',
  hook_comparison: 'Comparison borrows attention from something the viewer already has an opinion about.',
  hook_proof: 'First-person testing converts an ad into a report, which lowers the guard.',
  hook_problem: 'Naming the pain before the product means the viewer qualifies themselves in.',
  hook_curiosity: 'Withholding the payoff is the oldest retention device there is.',
  hook_command: 'A command creates immediate motion and implies stakes.',
  hook_direct: 'Second person makes it feel addressed rather than broadcast.',
  has_cta: 'Comments and saves are ranked signals, and asking measurably increases both.',
  has_urgency: 'Scarcity compresses the decision window from later to now.',
  has_price: 'Stating price early removes the top reason people scroll past product content.',
  has_superlative: 'Absolute claims invite disagreement, and disagreement is comments.',
  has_negative_frame: 'Problem-framing outperforms feature-framing because pain is more legible than benefit.',
  has_second_person: 'Direct address reliably beats third-person description on watch time.',
  has_question: 'Questions in captions are the cheapest comment bait available.',
  has_number: 'Specificity reads as credibility.',
  no_punctuation: 'Unpunctuated captions read as native posting rather than marketing.',
  all_lowercase: 'Lowercase signals peer, not brand.',
  short_caption: 'A short caption keeps attention on the video and the on-screen text.',
  long_caption: 'A long caption gives the algorithm text to classify and gives buyers detail.',
  hashtag_light: 'A tight hashtag set concentrates classification instead of diluting it.',
  hashtag_heavy: 'A wide stack casts into multiple feeds at once.',
  power_word: 'Charged vocabulary raises emotional temperature, which drives shares.',
  shop_hashtag: 'These tags route the video into commercial discovery surfaces.',
  niche_hashtag: 'Long-tail tags land you in a smaller pool you can actually win.',
  has_emoji: 'Emoji break up the caption and add tone the text alone cannot carry.',
  talks_fast: 'Fast delivery compresses more information into the window before a scroll decision.',
  talks_slow: 'Slow delivery reads as confidence and gives the demo room to land.',
  very_short_video: 'Short videos get more completions, and completion is the strongest ranking signal.',
  short_video: 'Long enough to demonstrate, short enough to finish.',
  long_video: 'Longer runtime only works when retention holds — these held it.',
  original_sound: 'Original audio means the words are doing the work, not a borrowed trend.',
  creator_captioned: 'Hand-written captions beat auto-captions on watch time, and most sound-off viewers need them.',
  small_creator: 'These did not need an audience to work, which means the format is doing the lifting.',
  silent_video: 'No speech forces every idea into visuals and text, which travels further sound-off.',
};

/* Which underlying field each trait depends on. If the control set can't
   express a trait — hashtag search returns no transcripts and no follower
   counts — then measuring it there yields zero hits, and a winner that HAS the
   trait gets an enormous fake lift. Those traits fall back to the estimate
   table instead of being scored against a control that could never show them. */
const TRAIT_NEEDS = {
  talks_fast: 'transcript', talks_slow: 'transcript', silent_video: 'transcript',
  creator_captioned: 'creatorCaptioned', small_creator: 'followerCount',
  very_short_video: 'duration', short_video: 'duration', long_video: 'duration',
  original_sound: 'soundOriginal',
};

function controlCovers(field, videos) {
  return videos.some(v => {
    const val = v[field];
    if (field === 'followerCount') return typeof val === 'number' && val > 0;
    if (field === 'transcript') return typeof val === 'string' && val.trim().length > 0;
    if (field === 'soundOriginal' || field === 'creatorCaptioned') return typeof val === 'boolean';
    return val !== undefined && val !== null;
  });
}

/* Measure how often each trait shows up in the control group. This is the
   whole point of the control set: it replaces guessed base rates with counted
   ones. Clamped so a zero-hit trait can't produce an infinite lift. */
function measureBaseRates(controlVideos) {
  const feats = controlVideos.map(extractFeatures);
  const n = feats.length;
  const rates = {};
  const covered = {};
  for (const key of Object.keys(BASE_RATES)) {
    const need = TRAIT_NEEDS[key];
    covered[key] = need ? controlCovers(need, controlVideos) : true;
    const hits = feats.filter(f => f.traits[key]).length;
    /* Laplace smoothing. A trait absent from 12 control videos is rare, not
       impossible, and pretending otherwise manufactures enormous fake lifts. */
    rates[key] = Math.min(0.95, (hits + 1) / (n + 2));
  }
  return { rates, n, covered };
}

const median = arr => {
  const s = arr.filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

function analyze(videos, opts = {}) {
  const feats = videos.map(extractFeatures);
  const n = feats.length;
  const minShare = n <= 3 ? 2 : Math.ceil(n * 0.6);
  const findings = [];

  const control = opts.control && opts.control.videos && opts.control.videos.length >= 6
    ? measureBaseRates(opts.control.videos) : null;
  /* Measured rate only where the control could actually express the trait. */
  const measuredFor = key => !!(control && control.covered[key]);
  const rateFor = key => (measuredFor(key) ? control.rates[key] : BASE_RATES[key]);
  const baseline = control
    ? { source: 'measured', n: control.n, from: opts.control.source || 'the same niche',
        partial: Object.keys(TRAIT_NEEDS).filter(k => !control.covered[k]).length }
    : { source: 'estimated', n: 0, from: null, partial: 0 };

  for (const key of Object.keys(BASE_RATES)) {
    const hits = feats.filter(f => f.traits[key]).length;
    if (hits < minShare) continue;
    const observed = hits / n;
    const base = rateFor(key);
    const lift = observed / base;
    if (lift < 1.25) continue;
    /* Past ~5x the estimate stops being trustworthy enough to print a precise
       number for, so it's shown as a floor instead of a false decimal. */
    const capped = lift > 5;
    findings.push({
      key, label: LABELS[key] || key, why: WHY[key] || '',
      hits, of: n, lift: capped ? 5 : Math.round(lift * 10) / 10, capped,
      measured: measuredFor(key),
      score: observed * Math.min(lift, 4) * (WEIGHTS[key] ?? .6) * (key.startsWith('hook_') ? 1.8 : 1),
      strength: hits === n ? 'high' : 'medium',
      examples: feats.filter(f => f.traits[key]).map(f => f.hookText).slice(0, 2),
    });
  }
  findings.sort((a, b) => b.score - a.score);

  /* Engagement comparison — only possible with real stats on both sides. */
  const metrics = [];
  if (opts.control && opts.control.medianRates && feats.some(f => f.rates)) {
    const labels = { share: 'Share rate', save: 'Save rate', comment: 'Comment rate', like: 'Like rate' };
    const notes = {
      share: 'Shares push a video into new networks. This is the number that actually drives reach.',
      save: 'Saves signal intent to buy or come back. TikTok weights them heavily.',
      comment: 'Comments extend the session and re-surface the video.',
      like: 'The weakest of the four signals, but still directional.',
    };
    for (const k of ENGAGEMENT_KEYS) {
      const mine = median(feats.map(f => f.rates?.[k]));
      const theirs = opts.control.medianRates[k];
      if (mine == null || !theirs) continue;
      metrics.push({
        key: k, label: labels[k], note: notes[k],
        value: mine, control: theirs,
        multiple: Math.round((mine / theirs) * 10) / 10,
      });
    }
    metrics.sort((a, b) => b.multiple - a.multiple);
  }

  const tagCounts = {};
  feats.forEach(f => new Set(f.hashtags).forEach(h => { tagCounts[h] = (tagCounts[h] || 0) + 1; }));
  const sharedTags = Object.entries(tagCounts).filter(([, c]) => c >= minShare)
    .sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));

  const tokCounts = {};
  feats.forEach(f => new Set(f.tokens).forEach(t => { tokCounts[t] = (tokCounts[t] || 0) + 1; }));
  const sharedWords = Object.entries(tokCounts).filter(([, c]) => c >= minShare)
    .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([word, count]) => ({ word, count }));

  const avgWords = Math.round(feats.reduce((s, f) => s + f.words, 0) / n);
  const avgTags = Math.round(feats.reduce((s, f) => s + f.hashtags.length, 0) / n);
  const hookKeys = Object.keys(BASE_RATES).filter(k => k.startsWith('hook_'));
  const dominantHook = findings.find(f => f.key.startsWith('hook_'))
    || hookKeys.map(k => ({ key: k, hits: feats.filter(f => f.traits[k]).length }))
        .sort((a, b) => b.hits - a.hits).filter(h => h.hits > 0)
        .map(h => ({ ...h, of: n, label: LABELS[h.key], why: WHY[h.key], strength: 'low', lift: 1 }))[0]
    || null;

  /* Audience reaction. Optional — absent without a key, and absent if the
     comments endpoint returns nothing. Never fatal. */
  let audience = null;
  try {
    if (typeof mineComments === 'function') audience = mineComments(feats, minShare);
  } catch { audience = null; }

  const thin = feats.filter(f => f.sourceQuality === 'thin').length;
  const strong = findings.filter(f => f.strength === 'high').length;
  let confidence = (thin >= n / 2 || findings.length < 2) ? 'low' : (strong >= 3 ? 'high' : 'medium');
  /* A measured baseline is worth more than a big pile of estimated findings. */
  if (control && confidence === 'medium' && strong >= 2) confidence = 'high';

  const enrichedCount = feats.filter(f => f.enriched).length;
  const withSpeech = feats.filter(f => f.spoken).length;

  return {
    topic: opts.topic || '', createdAt: Date.now(), videoCount: n,
    videos: feats.map(f => ({
      url: f.url, author: f.author, thumbnail: f.thumbnail, hookText: f.hookText,
      hookSource: f.hookSource, hashtags: f.hashtags, words: f.words,
      quality: f.sourceQuality, duration: f.duration, wpm: f.wpm, stats: f.stats,
    })),
    findings, metrics, audience, sharedTags, sharedWords, dominantHook, confidence, baseline,
    stats: { avgWords, avgTags, thinSources: thin, enrichedCount, withSpeech },
    caveat: enrichedCount === n && withSpeech > 0
      ? 'Based on spoken audio, caption, hook language, hashtag structure and engagement rates. On-screen text overlays are still not read.'
      : 'Based on caption, hook language and hashtag structure. Spoken audio and on-screen text are not read for these videos.',
  };
}
