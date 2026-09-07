/* Comment mining.
   The transcript tells you what the creator said. Comments tell you what the
   audience actually did with it — which objection they raised, whether they
   tried to buy. That's the one signal you cannot get by rewatching the videos. */

const INTENT = [
  { key: 'buying', label: 'Ready to buy', weight: 1.0,
    re: /\b(where (can i|did you|do i)|link\??$|link please|drop the link|need this|just ordered|just bought|adding to cart|add to cart|bought (one|this|it)|ordering|purchased|sold me|took my money|on my way to buy)\b/i },
  { key: 'price', label: 'Price objection', weight: .95,
    re: /\b(how much|too expensive|can'?t afford|pricey|worth (it|the money)\??|cheaper (option|version|alternative)|dupe|overpriced|\$\d+ for)\b/i },
  { key: 'skeptical', label: 'Doubt or pushback', weight: .9,
    re: /\b(does (it|this) (really|actually) work|is (this|it) (real|fake|sponsored)|ad\b|#ad|cap\b|doubt it|scam|placebo|not true|prove it)\b/i },
  { key: 'howto', label: 'Asking how', weight: .85,
    re: /\b(how (do|did) you|how does (it|this)|what setting|tutorial|step by step|which one|what model|what size|instructions)\b/i },
  { key: 'compat', label: 'Will it work for me', weight: .8,
    re: /\b(does it work (with|on|for)|compatible|will (it|this) work|for (android|iphone|ipad)|if i have)\b/i },
  { key: 'praise', label: 'Pure enthusiasm', weight: .5,
    re: /\b(need this|obsessed|love this|so good|game ?changer|life ?saver|this is genius|amazing)\b/i },
];

const CMT_WHY = {
  buying: 'Comments asking where to buy are the closest thing to a conversion signal you can read from outside. Put the answer in the video, not just the bio.',
  price: 'Price came up unprompted across the set. Address it on camera and you remove the objection before it becomes a scroll.',
  skeptical: 'Viewers pushed back on whether it is real. Showing proof early converts that doubt into watch time instead of a bounce.',
  howto: 'People asked how it works, which means the demo left a gap. Filling it in the video captures the attention the comments are proving exists.',
  compat: 'Compatibility questions repeat across the set. Say who it is for out loud and you stop losing the people who assume it is not for them.',
  praise: 'Enthusiasm without questions means the video landed but did not create an action. A clearer ask converts more of it.',
};

function mineComments(videosWithComments, minShare) {
  const withAny = videosWithComments.filter(v => v.comments && v.comments.length);
  if (withAny.length < 2) return null;

  const total = withAny.reduce((n, v) => n + v.comments.length, 0);
  const themes = [];

  for (const pat of INTENT) {
    /* Count videos where the theme appears, not raw comment count — one loud
       thread on a single video is not a pattern across the set. */
    let videoHits = 0, commentHits = 0;
    const quotes = [];
    for (const v of withAny) {
      const matches = v.comments.filter(c => pat.re.test(c.text));
      if (matches.length) {
        videoHits++;
        commentHits += matches.length;
        const best = matches.sort((a, b) => b.likes - a.likes)[0];
        if (best && quotes.length < 3) quotes.push(best.text.slice(0, 90));
      }
    }
    if (videoHits < Math.min(minShare, withAny.length)) continue;
    themes.push({
      key: pat.key, label: pat.label, why: CMT_WHY[pat.key],
      videos: videoHits, of: withAny.length,
      share: Math.round((commentHits / total) * 100),
      score: (videoHits / withAny.length) * pat.weight * (1 + commentHits / total),
      quotes,
    });
  }
  themes.sort((a, b) => b.score - a.score);

  const questions = [];
  for (const v of withAny) {
    for (const c of v.comments) {
      if (/\?/.test(c.text) && c.text.length < 110) questions.push(c);
    }
  }
  questions.sort((a, b) => b.likes - a.likes);

  return {
    analysed: total,
    videos: withAny.length,
    themes,
    topQuestions: questions.slice(0, 4).map(q => q.text),
    /* The single objection worth writing into the next script. */
    objection: themes.find(t => ['price', 'skeptical', 'compat', 'howto'].includes(t.key)) || null,
  };
}
