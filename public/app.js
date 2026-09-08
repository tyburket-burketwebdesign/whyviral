
const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const MAX = 5, MIN = 3, KEY = 'whyviral.history.v1', LEGACY_KEY = 'whyfamous.history.v1';
let rows = [], current = null, scriptCount = 3;

/* ---------------- routing ---------------- */
function show(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const t = $('#screen-' + name);
  if (t) t.classList.add('active');
  $('#nav-history').hidden = (name === 'history' || readHistory().length === 0);
  window.scrollTo({ top: 0, behavior: 'instant' });
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-back]');
  if (b) show(b.dataset.back);
});
const brandEl = $('#brand-home');
if (brandEl && brandEl.tagName === 'BUTTON') brandEl.onclick = () => show('welcome');
$('#go-new').onclick = () => show('input');
$('#go-history').onclick = () => { renderHistory(); show('history'); };
$('#nav-history').onclick = () => { renderHistory(); show('history'); };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._x); t._x = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------------- link rows ---------------- */
function addRow(value = '') {
  if (rows.length >= MAX) return;
  const id = 'r' + Math.random().toString(36).slice(2, 7);
  const row = el('div', 'link-row');
  row.dataset.id = id;
  row.innerHTML = `
    <div class="link-top">
      <span class="link-idx"></span>
      <input type="text" placeholder="https://www.tiktok.com/@creator/video/..." autocomplete="off" spellcheck="false">
      <button class="rm" aria-label="Remove this link">×</button>
    </div>
    <textarea placeholder="Optional: paste the caption and any on-screen text" hidden></textarea>
    <p class="link-status" hidden></p>`;
  const input = row.querySelector('input');
  const ta = row.querySelector('textarea');
  input.addEventListener('input', () => {
    const v = input.value.trim();
    row.classList.toggle('filled', isTikTok(v));
    row.classList.toggle('bad', v.length > 6 && !isTikTok(v));
    ta.hidden = v.length === 0;
    updateCount();
  });
  row.querySelector('.rm').onclick = () => {
    if (rows.length <= 1) { input.value = ''; ta.value = ''; ta.hidden = true; row.className = 'link-row'; updateCount(); return; }
    rows = rows.filter(r => r !== row); row.remove(); updateCount();
  };
  input.value = value;
  $('#link-rows').appendChild(row);
  rows.push(row);
  updateCount();
}
function updateCount() {
  rows.forEach((r, i) => r.querySelector('.link-idx').textContent = i + 1);
  const filled = rows.filter(r => isTikTok(r.querySelector('input').value.trim())).length;
  $('#link-count').textContent = `${filled} of ${MAX}`;
  $('#add-link').hidden = rows.length >= MAX;
}
const isTikTok = v => /tiktok\.com\/.+/i.test(v) || /^https?:\/\/(vm|vt)\.tiktok\.com\/\w+/i.test(v);
$('#add-link').onclick = () => addRow();
for (let i = 0; i < MIN; i++) addRow();

/* ---------------- fetch ---------------- */
/* Tier 1: /api/enrich — full metadata, transcript, engagement. Needs a key.
   Tier 2: /api/oembed — caption and author only. Free, always available.
   Tier 3: whatever the user pasted by hand. */
/* Set when any API call comes back 402 so the run can stop and show the wall. */
let paywallHit = null;

async function fetchVideo(url) {
  try {
    const r = await WV_AUTH.apiFetch('/api/enrich?url=' + encodeURIComponent(url), { headers: { accept: 'application/json' } });
    if (r.status === 402 || r.status === 401) { paywallHit = await r.json().catch(() => ({})); return { caption: '', tier: 'blocked', ok: false }; }
    if (r.ok) {
      const j = await r.json();
      if (j && j.enabled) return { ...j, tier: 'enriched', ok: true };
    }
  } catch { /* fall through */ }

  try {
    const r = await WV_AUTH.apiFetch('/api/oembed?url=' + encodeURIComponent(url), { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('status ' + r.status);
    const j = await r.json();
    if (!j || (!j.title && !j.author_name)) throw new Error('empty');
    return { caption: j.title || '', author: j.author_name || null, thumbnail: j.thumbnail_url || null, tier: 'basic', ok: true };
  } catch (err) {
    return { caption: '', author: null, thumbnail: null, tier: 'none', ok: false, error: String(err.message || err) };
  }
}

async function fetchControl(topic, tag, excludeIds) {
  try {
    const qs = new URLSearchParams({ topic, exclude: excludeIds.join(',') });
    if (tag) qs.set('tag', tag);
    const r = await WV_AUTH.apiFetch('/api/control?' + qs, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const j = await r.json();
    return (j && j.enabled && j.sufficient) ? j : null;
  } catch { return null; }
}

/* ---------------- loading choreography ---------------- */
const STEP_TEXT = n => [
  `Reading ${n} links`,
  'Pulling captions, audio and engagement',
  'Collecting ordinary videos to compare against',
  'Classifying hooks and structure',
  'Finding what the winners do that others do not',
];
function renderSteps(n) {
  const ol = $('#steps'); ol.innerHTML = '';
  STEP_TEXT(n).forEach(t => {
    const li = el('li'); li.appendChild(el('span', 'dot')); li.appendChild(el('span', null, t)); ol.appendChild(li);
  });
}
function setStep(i, total) {
  [...$('#steps').children].forEach((li, idx) => {
    li.classList.toggle('done', idx < i);
    li.classList.toggle('now', idx === i);
  });
  const pct = Math.round(((i + 1) / total) * 100);
  $('#bar-fill').style.width = pct + '%';
  const left = Math.max(0, Math.round((total - i - 1) * 4.5));
  $('#eta').textContent = left ? `about ${left}s left` : 'almost done';
}
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- run ---------------- */
$('#start-analysis').onclick = async () => {
  const topic = $('#topic').value.trim();
  const items = rows.map(r => ({
    url: r.querySelector('input').value.trim(),
    overlay: r.querySelector('textarea').value.trim(),
    row: r,
  })).filter(i => i.url.length > 0);

  const err = $('#input-error');
  err.hidden = true;
  if (!topic) { err.textContent = 'Add the product or topic first — the scripts are built around it.'; err.hidden = false; $('#topic').focus(); return; }
  if (items.length < MIN) { err.textContent = `Add at least ${MIN} links. The whole method depends on comparing videos against each other.`; err.hidden = false; return; }
  const bad = items.find(i => !isTikTok(i.url));
  if (bad) { err.textContent = 'One of those is not a TikTok link. Check it and try again.'; err.hidden = false; bad.row.querySelector('input').focus(); return; }

  const btn = $('#start-analysis'); btn.disabled = true;
  $('#loading-topic').textContent = topic;
  $('#loading-headline').textContent = 'Finding the pattern';
  renderSteps(items.length);
  show('loading');

  const total = 5;
  setStep(0, total); await wait(600);
  setStep(1, total);

  const metas = await Promise.all(items.map(async i => {
    const m = await fetchVideo(i.url);
    return {
      url: i.url, caption: m.caption || '', overlay: i.overlay, author: m.author,
      thumbnail: m.thumbnail, tier: m.tier, fetched: m.ok,
      hashtags: m.hashtags, transcript: m.transcript, duration: m.duration,
      soundOriginal: m.soundOriginal, creatorCaptioned: m.creatorCaptioned,
      followerCount: m.followerCount, stats: m.stats, rates: m.rates, id: m.id,
    };
  }));

  if (paywallHit) {
    btn.disabled = false;
    renderPaywall(paywallHit, await WV_AUTH.status());
    paywallHit = null;
    show(paywallHit === null && WV_AUTH.configured() ? 'paywall' : 'paywall');
    return;
  }

  const usable = metas.filter(m => (m.caption + (m.overlay || '') + (m.transcript || '')).trim().length > 0);
  if (usable.length < 2) {
    btn.disabled = false;
    show('input');
    err.textContent = 'Nothing could be read from these links, and no text was pasted. Open the box under each link, paste the caption plus any on-screen text, then run it again.';
    err.hidden = false;
    metas.forEach((m, idx) => {
      const st = items[idx].row.querySelector('.link-status');
      st.hidden = false; st.className = 'link-status warn';
      st.textContent = m.fetched ? 'Came back empty — paste the caption below' : 'Could not read this one — paste the caption below';
      items[idx].row.querySelector('textarea').hidden = false;
    });
    return;
  }

  /* Control set: the most-shared hashtag is the tightest comparison pool. */
  setStep(2, total);
  const tagCount = {};
  metas.forEach(m => new Set(m.hashtags || []).forEach(h => { tagCount[h] = (tagCount[h] || 0) + 1; }));
  const topTag = Object.entries(tagCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const control = await fetchControl(topic, topTag, metas.map(m => m.id).filter(Boolean));

  setStep(3, total); await wait(700);
  const result = analyze(metas, { topic, control });
  result.fetchedCount = metas.filter(m => m.fetched).length;
  result.enrichedTier = metas.filter(m => m.tier === 'enriched').length;

  setStep(4, total); await wait(600);

  current = result;
  scriptCount = 3;
  renderResult(result);
  saveHistory(result);
  btn.disabled = false;
  show('result');
};

/* ---------------- render breakdown ---------------- */
function renderResult(r) {
  $('#result-topic').textContent = `${r.topic} · ${r.videoCount} videos`;
  const c = $('#confidence');
  c.className = 'confidence ' + r.confidence;
  c.textContent = {
    high: 'Strong pattern — most traits shared by every video',
    medium: 'Moderate pattern — worth acting on, not gospel',
    low: 'Weak pattern — thin captions or genuinely different videos',
  }[r.confidence];

  const box = $('#findings'); box.innerHTML = '';
  $('#no-findings').hidden = r.findings.length > 0;

  /* Several traits often come from the same hook line. Printing that quote on
     every card makes the page look duplicated, so each one is shown once. */
  const shownQuotes = new Set();
  r.findings.forEach(f => {
    const d = el('div', 'finding ' + f.strength);
    const top = el('div', 'finding-top');
    top.appendChild(el('h3', null, f.label));
    top.appendChild(el('span', 'score', `${f.hits} of ${f.of}`));
    d.appendChild(top);
    d.appendChild(el('p', 'why', f.why));
    d.appendChild(el('span', 'lift', `${f.capped ? '5×+' : f.lift + '×'} ${f.measured ? 'more common than in ordinary videos' : 'more common than typical'}`));
    const q = f.examples[0];
    if (q && !shownQuotes.has(q)) {
      shownQuotes.add(q);
      d.appendChild(el('p', 'eg', `"${q.slice(0, 88)}${q.length > 88 ? '…' : ''}"`));
    }
    box.appendChild(d);
  });

  /* Say plainly where the comparison numbers came from. */
  const bl = $('#baseline'); bl.innerHTML = '';
  if (r.baseline) {
    bl.className = 'baseline ' + r.baseline.source;
    bl.appendChild(el('span', 'baseline-k', r.baseline.source === 'measured' ? 'Measured' : 'Estimated'));
    bl.appendChild(el('span', 'baseline-v', r.baseline.source === 'measured'
      ? `Compared against ${r.baseline.n} ordinary videos pulled from ${r.baseline.from}.`
        + (r.baseline.partial ? ' A few traits the comparison set could not report on fall back to estimates.' : '')
      : 'Compared against typical rates for TikTok product content, not a live sample.'));
    bl.hidden = false;
  } else { bl.hidden = true; }

  const mp = $('#metrics-panel'); mp.innerHTML = '';
  if (r.metrics && r.metrics.length) {
    mp.hidden = false;
    mp.appendChild(el('h3', null, 'How hard they outperformed'));
    mp.appendChild(el('p', 'sub', 'Median rate across your videos versus the ordinary ones on the same tag.'));
    r.metrics.forEach(m => {
      const row = el('div', 'metric');
      const head = el('div', 'metric-head');
      head.appendChild(el('span', 'metric-label', m.label));
      head.appendChild(el('span', 'metric-mult', `${m.multiple}×`));
      row.appendChild(head);
      const bar = el('div', 'metric-bar');
      const fillEl = el('div', 'metric-fill');
      fillEl.style.width = Math.min(100, Math.round((m.multiple / 20) * 100)) + '%';
      bar.appendChild(fillEl);
      row.appendChild(bar);
      row.appendChild(el('p', 'metric-note', m.note));
      mp.appendChild(row);
    });
  } else { mp.hidden = true; }

  /* What viewers actually said. */
  const ap = $('#audience-panel'); ap.innerHTML = '';
  if (r.audience && r.audience.themes.length) {
    ap.hidden = false;
    ap.appendChild(el('h3', null, 'What viewers actually said'));
    ap.appendChild(el('p', 'sub', `${r.audience.analysed} comments across ${r.audience.videos} videos.`));
    r.audience.themes.slice(0, 4).forEach(t => {
      const row = el('div', 'theme');
      const head = el('div', 'theme-head');
      head.appendChild(el('span', 'theme-label', t.label));
      head.appendChild(el('span', 'theme-count', `${t.videos}/${t.of} · ${t.share}%`));
      row.appendChild(head);
      row.appendChild(el('p', 'theme-why', t.why));
      if (t.quotes[0]) row.appendChild(el('p', 'theme-quote', `"${t.quotes[0]}"`));
      ap.appendChild(row);
    });
    if (r.audience.topQuestions.length) {
      const h = el('h3', null, 'Questions to answer on camera');
      h.style.marginTop = '16px';
      ap.appendChild(h);
      const ul = el('ul', 'qlist');
      r.audience.topQuestions.forEach(q => ul.appendChild(el('li', null, q)));
      ap.appendChild(ul);
    }
  } else { ap.hidden = true; }

  const p = $('#shared-panel'); p.innerHTML = '';
  if (r.sharedTags.length || r.sharedWords.length) {
    if (r.sharedTags.length) {
      p.appendChild(el('h3', null, 'Hashtags they share'));
      p.appendChild(el('p', 'sub', 'Reuse these — they define the pool the algorithm is testing you in.'));
      const w = el('div');
      r.sharedTags.forEach(t => w.appendChild(el('span', 'tag', `#${t.tag} · ${t.count}/${r.videoCount}`)));
      p.appendChild(w);
    }
    if (r.sharedWords.length) {
      const h = el('h3', null, 'Language they share');
      h.style.marginTop = r.sharedTags.length ? '16px' : '0';
      p.appendChild(h);
      p.appendChild(el('p', 'sub', 'Vocabulary appearing across the set. Work these into your own copy.'));
      const w2 = el('div');
      r.sharedWords.forEach(t => w2.appendChild(el('span', 'tag word', t.word)));
      p.appendChild(w2);
    }
  } else {
    p.hidden = true;
  }

  let note = '';
  if (r.fetchedCount < r.videoCount) note += ` Data was read automatically for ${r.fetchedCount} of ${r.videoCount}; the rest used text you pasted.`;
  if (typeof r.enrichedTier === 'number' && r.enrichedTier === 0) note += ' Running on captions only — add a scraper key to read audio and engagement.';
  $('#caveat').textContent = r.caveat + note + ' Traits shared by ordinary videos too are filtered out rather than reported as insight.';
  $('#script-n').textContent = scriptCount;
  updateStepper();
}

/* ---------------- stepper ---------------- */
function updateStepper() {
  $('#script-n').textContent = scriptCount;
  $('#dec').disabled = scriptCount <= 1;
  $('#inc').disabled = scriptCount >= 6;
}
$('#dec').onclick = () => { if (scriptCount > 1) { scriptCount--; updateStepper(); } };
$('#inc').onclick = () => { if (scriptCount < 6) { scriptCount++; updateStepper(); } };

/* ---------------- scripts ---------------- */
$('#build-scripts').onclick = () => {
  if (!current) return;
  const scripts = generateScripts(current, scriptCount, current.topic);
  $('#scripts-title').textContent = `${scriptCount} script${scriptCount > 1 ? 's' : ''} for ${current.topic}`;
  const box = $('#scripts'); box.innerHTML = '';

  scripts.forEach(s => {
    const d = el('div', 'script');
    const head = el('div', 'script-head');
    head.appendChild(el('span', 'script-angle', s.angle));
    const cp = el('button', 'copy-btn', 'Copy script');
    cp.onclick = () => {
      navigator.clipboard.writeText(plain(s, current.topic)).then(
        () => toast('Script copied'),
        () => toast('Copy blocked by the browser — select and copy manually'));
    };
    head.appendChild(cp);
    d.appendChild(head);
    d.appendChild(el('div', 'script-hook', s.hook));

    s.timeline.forEach(b => {
      const row = el('div', 'beat');
      row.appendChild(el('div', 'beat-t', b.t));
      const right = el('div');
      right.appendChild(el('div', 'beat-label', b.label));
      right.appendChild(el('div', 'beat-line', b.line));
      right.appendChild(el('div', 'beat-shot', b.shot));
      row.appendChild(right);
      d.appendChild(row);
    });

    const meta = el('div', 'script-meta');
    meta.appendChild(metaRow('Energy', s.energy));
    meta.appendChild(metaRow('Caption', s.caption));
    const must = el('div', 'meta-row');
    must.appendChild(el('div', 'meta-k', 'Must say it'));
    const ul = el('ul', 'must');
    s.mustSay.forEach(m => ul.appendChild(el('li', null, m)));
    must.appendChild(ul);
    meta.appendChild(must);
    d.appendChild(meta);
    box.appendChild(d);
  });
  show('scripts');
};
function metaRow(k, v) {
  const r = el('div', 'meta-row');
  r.appendChild(el('div', 'meta-k', k));
  r.appendChild(el('div', 'meta-v', v));
  return r;
}
function plain(s, topic) {
  return [
    `${topic} — ${s.angle}`, '',
    `HOOK: ${s.hook}`, '',
    ...s.timeline.map(b => `[${b.t}] ${b.label}\n${b.line}\nShot: ${b.shot}\n`),
    `ENERGY: ${s.energy}`, '',
    `CAPTION:\n${s.caption}`, '',
    `MUST SAY:\n${s.mustSay.map(m => '- ' + m).join('\n')}`,
    '', 'Built with WhyViral',
  ].join('\n');
}

/* ---------------- history ---------------- */
function readHistory() {
  try {
    const cur = localStorage.getItem(KEY);
    if (cur) return JSON.parse(cur);
    /* Carry over anything saved under the old brand key, once. */
    const old = localStorage.getItem(LEGACY_KEY);
    if (old) { localStorage.setItem(KEY, old); localStorage.removeItem(LEGACY_KEY); return JSON.parse(old); }
    return [];
  } catch { return []; }
}
function saveHistory(r) {
  try {
    const h = readHistory();
    h.unshift(r);
    localStorage.setItem(KEY, JSON.stringify(h.slice(0, 25)));
    $('#nav-history').hidden = false;
  } catch { /* private mode — history just won't persist */ }
}
function renderHistory() {
  const list = $('#history-list'); list.innerHTML = '';
  const h = readHistory();
  if (!h.length) {
    const e = el('div', 'empty');
    e.appendChild(el('h3', null, 'Nothing here yet'));
    e.appendChild(el('p', null, 'Your breakdowns are saved on this device as you run them. Nothing is uploaded anywhere.'));
    const b = el('button', 'btn btn-quiet btn-sm', 'Start a breakdown');
    b.onclick = () => show('input');
    e.appendChild(b);
    list.appendChild(e);
    return;
  }
  h.forEach(r => {
    const b = el('button', 'hist');
    const top = el('div', 'hist-top');
    top.appendChild(el('h3', null, r.topic || 'Untitled'));
    top.appendChild(el('span', 'when', new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
    b.appendChild(top);
    const nf = r.findings.length;
    b.appendChild(el('p', 'sum', `${r.videoCount} videos · ${nf} shared trait${nf === 1 ? '' : 's'} · ${r.confidence} confidence`));
    b.onclick = () => { current = r; scriptCount = 3; renderResult(r); show('result'); };
    list.appendChild(b);
  });
}
if (readHistory().length) $('#nav-history').hidden = false;

/* ---------------- niceties ---------------- */
$('#topic').addEventListener('keydown', e => { if (e.key === 'Enter') rows[0]?.querySelector('input').focus(); });

/* Load sentinel — the inline guard in index.html watches for this. */
window.__wfReady = true;


/* ---------------- accounts, trial, paywall ---------------- */
function renderPaywall(info, acct) {
  /* Someone who has already used a trial gets a straight subscribe offer.
     Advertising "7 days free" to them is a promise Stripe will not honour. */
  const lapsed = acct && (acct.plan === 'pro' || acct.status === 'canceled' || acct.status === 'past_due');
  if (lapsed) {
    $('#paywall-eyebrow').textContent = 'Welcome back';
    $('#paywall-title').textContent = 'Pick up where you left off';
    $('#paywall-lede').textContent = 'Your breakdowns are still saved. Resubscribe to run new ones.';
    $('#paywall-go').textContent = 'Resubscribe';
    $('#paywall-error').hidden = true;
    return;
  }
  const card = (acct?.trialMode || 'card') === 'card';
  const days = acct?.trialDays || 7;
  $('#paywall-eyebrow').textContent = card ? `${days} days free, then $29` : "You've used your free breakdowns";
  $('#paywall-title').textContent = card ? 'Reverse-engineer without limits' : 'Keep reverse-engineering';
  $('#paywall-lede').textContent = card
    ? `Try every feature free for ${days} days. Cancel any time from your account — no email required.`
    : 'Unlimited breakdowns, unlimited scripts, and every analysis saved to your account.';
  $('#paywall-go').textContent = card ? `Start ${days}-day free trial` : 'Subscribe';
  $('#paywall-error').hidden = true;
}

/* Theme. Stored per-device, applied before the first paint by an inline
   script in app.html so there is no flash of the wrong theme. */
const THEME_KEY = 'whyviral.theme.v1';
function currentTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'light'; } catch { return 'light'; }
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
  try { localStorage.setItem(THEME_KEY, t); } catch {}
  document.querySelectorAll('.switch').forEach(s => s.setAttribute('aria-checked', String(t === 'dark')));
}
function toggleTheme() { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'); }
applyTheme(currentTheme());
$('#menu-theme')?.addEventListener('click', toggleTheme);
$('#set-theme')?.addEventListener('click', toggleTheme);

const initialsOf = (name, email) => {
  const n = (name || '').trim();
  if (n) return n.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (email || '?').slice(0, 2).toUpperCase();
};

/* Account menu open/close, including the click-outside and Escape that make a
   dropdown feel finished rather than bolted on. */
const menuEl = $('#acct-menu'), avatarBtn = $('#avatar-btn');
function setMenu(open) {
  if (!menuEl) return;
  menuEl.hidden = !open;
  avatarBtn?.setAttribute('aria-expanded', String(open));
}
avatarBtn?.addEventListener('click', e => { e.stopPropagation(); setMenu(menuEl.hidden); });
document.addEventListener('click', e => { if (menuEl && !menuEl.hidden && !e.target.closest('.avatar-wrap')) setMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });

function daysLeft(iso) {
  if (!iso) return null;
  /* Round, not floor or ceil. Floor turns "exactly 5 days" into 4 because a
     few milliseconds have passed; ceil turns "3 hours left" into "1 day left".
     Rounding reads correctly at both ends. */
  const d = Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
  return isFinite(d) ? Math.max(0, d) : null;
}
const fmtDate = iso => {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return '—'; }
};

/* One state machine for the account banner. Every branch a real customer can
   land in, including the unhappy ones: a declined card, a cancellation still
   inside its paid period, and a subscription that has already lapsed. Getting
   these wrong is worse than having no banner — telling someone whose payment
   just failed that they can have a free trial is how you lose them. */
function accountState(s) {
  if (!s.billing || !s.signedIn) return 'anon';
  if (s.status === 'past_due') return 'past_due';
  if (s.status === 'trialing') return 'trialing';
  if (s.subscribed && s.cancelAtPeriodEnd) return 'cancelling';
  if (s.subscribed) return 'active';
  /* plan 'pro' or a terminal status means they have subscribed before, so a
     "free trial" offer would be a promise we cannot keep. */
  if (s.plan === 'pro' || s.status === 'canceled') return 'lapsed';
  if (s.trialMode !== 'card' && typeof s.remaining === 'number' && s.remaining > 0) return 'free_runs';
  return 'new';
}

function renderStatus(s) {
  const bar = $('#status-bar');
  if (!bar) return;
  bar.innerHTML = '';
  const state = accountState(s);
  if (state === 'anon') { bar.hidden = true; return; }

  const left = daysLeft(s.renewsAt);
  const main = el('div', 'status-main');
  const title = t => main.appendChild(el('span', 'status-title', t));
  const sub = t => { if (t) main.appendChild(el('span', 'status-sub', t)); };
  let action = null;

  if (state === 'past_due') {
    title('Your last payment failed');
    sub('Update your card to keep your access. Nothing else has changed.');
    action = ['Update card', () => openBilling()];
  } else if (state === 'trialing') {
    title(left === 0 ? 'Trial ends today' : `${left} day${left === 1 ? '' : 's'} left in your trial`);
    sub(s.cancelAtPeriodEnd ? 'Cancelled — access ends when the trial does.'
                            : `Then $29 a month from ${fmtDate(s.renewsAt)}.`);
  } else if (state === 'cancelling') {
    title('Subscription cancelled');
    sub(`You keep full access until ${fmtDate(s.renewsAt)}.`);
    action = ['Resume subscription', () => openBilling()];
  } else if (state === 'active') {
    title('Pro — unlimited breakdowns');
    sub(s.renewsAt ? `Renews ${fmtDate(s.renewsAt)}.` : '');
  } else if (state === 'lapsed') {
    title('Your subscription has ended');
    sub('Resubscribe to pick your breakdowns back up. $29 a month, cancel any time.');
    action = ['Resume subscription', () => { renderPaywall(null, s); show('paywall'); }];
  } else if (state === 'free_runs') {
    title(`${s.remaining} free breakdown${s.remaining === 1 ? '' : 's'} left`);
    sub('Subscribe for unlimited.');
    action = ['Subscribe', () => { renderPaywall(null, s); show('paywall'); }];
  } else {
    title('Your trial has not started');
    sub(`${s.trialDays || 7} days free, then $29 a month.`);
    action = ['Start free trial', () => { renderPaywall(null, s); show('paywall'); }];
  }

  bar.appendChild(main);
  if (action) {
    const b = el('button', 'btn btn-primary', action[0]);
    b.onclick = action[1];
    bar.appendChild(b);
  }
  if (state === 'trialing' && left !== null) {
    const track = el('div', 'status-track');
    const fill = el('i');
    const total = s.trialDays || 7;
    fill.style.width = Math.min(100, Math.round(((total - left) / total) * 100)) + '%';
    track.appendChild(fill);
    bar.appendChild(track);
  }
  bar.hidden = false;
}

async function refreshAccount() {
  const s = await WV_AUTH.status(true);
  const chip = $('#trial-chip'), wrap = $('#avatar-wrap'), signin = $('#nav-signin');

  if (!s.billing) {
    if (chip) chip.hidden = true;
    if (wrap) wrap.hidden = true;
    if (signin) signin.hidden = true;
    renderStatus(s);
    return s;
  }

  /* Subscribers get a manage-billing button on the paywall screen. */
  const manage = $('#paywall-manage');
  if (manage) manage.hidden = !s.subscribed;

  if (s.signedIn) {
    if (signin) signin.hidden = true;
    if (wrap) wrap.hidden = false;
    $('#avatar-initials').textContent = initialsOf(s.name, s.email);
    $('#menu-name').textContent = s.name || 'Your account';
    $('#menu-email').textContent = s.email || '';
    const left = daysLeft(s.renewsAt);
    $('#menu-plan').textContent = s.status === 'trialing' ? `Trial · ${left ?? '–'}d left`
      : (s.subscribed ? 'Pro' : 'No plan');

    if (chip) {
      const st = accountState(s);
      chip.hidden = false;
      if (st === 'past_due') { chip.className = 'trial-chip warn'; chip.textContent = 'Card failed'; }
      else if (st === 'trialing') {
        chip.className = 'trial-chip' + (left !== null && left <= 2 ? ' warn' : '');
        chip.textContent = left === 0 ? 'Ends today' : `${left}d left`;
      }
      else if (st === 'cancelling') { chip.className = 'trial-chip pro'; chip.textContent = 'Ends soon'; }
      else if (st === 'active') { chip.className = 'trial-chip pro'; chip.textContent = 'Pro'; }
      else if (st === 'lapsed') { chip.className = 'trial-chip warn'; chip.textContent = 'Ended'; }
      else if (st === 'free_runs') { chip.className = 'trial-chip'; chip.textContent = `${s.remaining} free`; }
      else chip.hidden = true;
    }

    $('#set-name').textContent = s.name || '—';
    $('#set-email').textContent = s.email || '—';
    $('#set-plan').textContent = s.status === 'trialing' ? 'Free trial' : (s.subscribed ? 'Pro' : 'No plan');
    $('#set-renews').textContent = s.renewsAt ? fmtDate(s.renewsAt) : '—';
  } else {
    if (wrap) wrap.hidden = true;
    if (chip) chip.hidden = true;
    if (signin) signin.hidden = false;
  }

  try { renderPaywall(null, s); } catch {}
  renderStatus(s);
  const note = $('#hero-note');
  if (note) {
    let st = accountState(s);
    /* A signed-out visitor still needs to know what the first run costs. */
    if (st === 'anon') st = s.trialMode === 'card' ? 'new' : 'free_runs';
    note.textContent =
      st === 'active' || st === 'cancelling' || st === 'trialing' ? 'Paste your links below.'
      : st === 'past_due' ? 'Update your card to carry on.'
      : st === 'lapsed' ? 'Resubscribe to run breakdowns again.'
      : st === 'free_runs' ? 'No account needed for your first breakdown.'
      : `${s.trialDays || 7} days free, then $29 a month. Cancel any time.`;
  }
  return s;
}

async function doSignOut() {
  WV_AUTH.signOut(); WV_AUTH.invalidate();
  setMenu(false);
  await refreshAccount();
  show('welcome');
  toast('Signed out');
}
$('#menu-signout')?.addEventListener('click', doSignOut);
$('#set-signout')?.addEventListener('click', doSignOut);
$('#nav-signin')?.addEventListener('click', () => show('auth'));
$('#menu-settings')?.addEventListener('click', () => { setMenu(false); show('settings'); });
$('#menu-breakdowns')?.addEventListener('click', () => { setMenu(false); renderHistory(); show('history'); });

async function openBilling() {
  try {
    const r = await WV_AUTH.apiFetch('/api/portal', { method: 'POST' });
    const j = await r.json();
    if (j.url) { location.href = j.url; return; }
    toast(j.message || 'No billing account yet.');
  } catch { toast('Could not open billing.'); }
}
$('#menu-billing')?.addEventListener('click', () => { setMenu(false); openBilling(); });
$('#set-billing')?.addEventListener('click', openBilling);

/* Default script count, remembered between visits. */
const SCRIPTS_KEY = 'whyviral.scripts.v1';
try {
  const saved = parseInt(localStorage.getItem(SCRIPTS_KEY) || '3', 10);
  if (saved >= 1 && saved <= 6) scriptCount = saved;
} catch {}
const setScriptsLabel = () => { const e = $('#set-scripts'); if (e) e.textContent = scriptCount; };
setScriptsLabel();
$('#set-scripts-dec')?.addEventListener('click', () => {
  if (scriptCount > 1) { scriptCount--; try { localStorage.setItem(SCRIPTS_KEY, scriptCount); } catch {} setScriptsLabel(); updateStepper(); }
});
$('#set-scripts-inc')?.addEventListener('click', () => {
  if (scriptCount < 6) { scriptCount++; try { localStorage.setItem(SCRIPTS_KEY, scriptCount); } catch {} setScriptsLabel(); updateStepper(); }
});

const showErr = (sel, m) => { const e = $(sel); e.textContent = m; e.hidden = false; };
const clearErr = sel => { const e = $(sel); if (e) e.hidden = true; };

/* Live strength feedback. Cheap to add and it stops the "your password is
   invalid" surprise after someone has already committed to a form. */
function scorePassword(p) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p) || /[^A-Za-z0-9]/.test(p)) s++;
  return s;
}
function wireMeter(input, meter) {
  const el2 = $(input), m = $(meter);
  if (!el2 || !m) return;
  el2.addEventListener('input', () => {
    const v = el2.value;
    m.hidden = v.length === 0;
    const s = scorePassword(v);
    [...m.querySelectorAll('i')].forEach((seg, i) => {
      seg.classList.toggle('on', i < s);
      seg.classList.toggle('strong', i < s && s >= 3);
    });
    el2.classList.remove('bad');
  });
}
wireMeter('#su-pass', '#su-meter');
wireMeter('#rp-pass', '#rp-meter');

const suBtn = $('#su-submit');
if (suBtn) suBtn.onclick = async () => {
  const name = ($('#su-name').value || '').trim();
  const email = ($('#su-email').value || '').trim();
  const pass = $('#su-pass').value || '';
  const pass2 = $('#su-pass2').value || '';
  clearErr('#su-error');
  ['#su-name', '#su-email', '#su-pass', '#su-pass2'].forEach(s => $(s).classList.remove('bad'));

  const bad = (sel, msg) => { $(sel).classList.add('bad'); $(sel).focus(); showErr('#su-error', msg); };
  if (name.length < 2) return bad('#su-name', 'Tell us your name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('#su-email', 'That email does not look right.');
  if (pass.length < 8) return bad('#su-pass', 'Your password needs at least 8 characters.');
  if (pass !== pass2) return bad('#su-pass2', 'Those two passwords do not match.');

  suBtn.disabled = true;
  suBtn.textContent = 'Creating your account…';
  try {
    const r = await WV_AUTH.signUp(email, pass);
    if (!r.signedIn) {
      WV_AUTH.stashProfile({ fullName: name });
      showErr('#su-error', 'Account created. Confirm your email, then sign in.');
      suBtn.disabled = false;
      suBtn.textContent = 'Create account';
      return;
    }
    await WV_AUTH.saveProfile({ fullName: name }).catch(() => {});
    WV_AUTH.invalidate();
    const acct = await refreshAccount();
  const landing = acct.signedIn ? 'home' : 'welcome';
    toast('Account created');
    renderPaywall(null, acct);
    renderDashboard(acct);
    show(acct.subscribed ? 'home' : 'paywall');
  } catch (e) {
    const msg = String(e.message || e);
    /* Surface what Supabase actually said. A generic failure here is the
       difference between a two-minute fix and an hour of guessing. */
    showErr('#su-error', /already registered|already been/i.test(msg)
      ? 'That email already has an account. Sign in instead.'
      : (/password/i.test(msg) ? msg : 'Could not create your account: ' + msg));
    suBtn.disabled = false;
    suBtn.textContent = 'Create account';
  }
};

const siBtn = $('#si-submit');
if (siBtn) siBtn.onclick = async () => {
  const email = ($('#si-email').value || '').trim();
  const pass = $('#si-pass').value || '';
  clearErr('#auth-error'); $('#auth-sent').hidden = true;
  if (!email || !pass) return showErr('#auth-error', 'Enter your email and password.');
  siBtn.disabled = true;
  siBtn.textContent = 'Signing in…';
  try {
    await WV_AUTH.signIn(email, pass);
    await WV_AUTH.flushProfile();
    WV_AUTH.invalidate();
    const acct = await refreshAccount();

    /* Supabase accepted the password but our API refused the token. Almost
       always a JWT configuration mismatch — say so rather than bouncing the
       person back to a page that still says "Sign in". */
    if (acct.rejected || !acct.signedIn) {
      showErr('#auth-error', 'Signed in, but the server would not accept the session. Check SUPABASE_JWT_SECRET matches your project.');
      siBtn.disabled = false;
      siBtn.textContent = 'Sign in';
      return;
    }
    toast('Signed in');
    renderDashboard(acct);
    show('home');
  } catch (e) {
    showErr('#auth-error', 'Wrong email or password.');
    siBtn.disabled = false;
    siBtn.textContent = 'Sign in';
  }
};

const rpBtn = $('#rp-submit');
if (rpBtn) rpBtn.onclick = async () => {
  const p1 = $('#rp-pass').value || '', p2 = $('#rp-pass2').value || '';
  clearErr('#rp-error');
  if (p1.length < 8) return showErr('#rp-error', 'Your password needs at least 8 characters.');
  if (p1 !== p2) return showErr('#rp-error', 'Those two passwords do not match.');
  rpBtn.disabled = true;
  rpBtn.textContent = 'Saving…';
  try {
    await WV_AUTH.updatePassword(p1);
    WV_AUTH.invalidate();
    await refreshAccount();
    toast('Password updated');
    show('welcome');
  } catch (e) {
    showErr('#rp-error', String(e.message || e));
    rpBtn.disabled = false;
    rpBtn.textContent = 'Save new password';
  }
};

const resetLink = $('#go-reset');
if (resetLink) resetLink.onclick = async (ev) => {
  ev.preventDefault();
  const email = ($('#si-email').value || '').trim();
  clearErr('#auth-error');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showErr('#auth-error', 'Enter your email above first, then tap Forgot.');
  try { await WV_AUTH.sendReset(email); $('#auth-sent').hidden = false; }
  catch (e) { showErr('#auth-error', String(e.message || e)); }
};

$('#go-signin')?.addEventListener('click', e => { e.preventDefault(); show('auth'); });
$('#go-signup')?.addEventListener('click', e => { e.preventDefault(); show('signup'); });
$('#si-pass')?.addEventListener('keydown', e => { if (e.key === 'Enter') siBtn.click(); });
$('#su-pass2')?.addEventListener('keydown', e => { if (e.key === 'Enter') suBtn.click(); });
$('#rp-pass2')?.addEventListener('keydown', e => { if (e.key === 'Enter') rpBtn.click(); });

/* Plan choice on the paywall. This block was lost in an earlier rewrite, which
   left chosenPlan undeclared and the toggle inert — Subscribe threw before it
   ever reached checkout. */
let chosenPlan = 'monthly';
document.querySelectorAll('.plan-opt').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.plan-opt').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    chosenPlan = b.dataset.plan || 'monthly';
  });
});

const payManage = $('#paywall-manage');
if (payManage) payManage.onclick = async () => {
  payManage.disabled = true;
  try {
    const r = await WV_AUTH.apiFetch('/api/portal', { method: 'POST' });
    const j = await r.json();
    if (j.url) { location.href = j.url; return; }
    throw new Error(j.message || 'Billing portal unavailable.');
  } catch (e) {
    showErr('#paywall-error', String(e.message || e));
    payManage.disabled = false;
  }
};

const payGo = $('#paywall-go');
if (payGo) payGo.onclick = async () => {
  const signedIn = await WV_AUTH.isSignedIn();
  if (!signedIn) { show('signup'); return; }
  payGo.disabled = true;
  try {
    const r = await WV_AUTH.apiFetch('/api/checkout?plan=' + chosenPlan, { method: 'POST' });
    const j = await r.json();
    if (j.url) { location.href = j.url; return; }
    throw new Error(j.message || 'Checkout is not available yet.');
  } catch (e) {
    $('#paywall-error').textContent = String(e.message || e);
    $('#paywall-error').hidden = false;
    payGo.disabled = false;
  }
};

/* The marketing site links straight to a screen, so honour the hash.
   Read it before captureRedirect(), which clears the fragment. */
/* Stripe hands the customer back with ?checkout=success. The webhook that
   flips the subscription on may not have landed yet, so poll briefly rather
   than telling a paying customer they have no plan. */
async function waitForSubscription(tries = 6, gapMs = 1200) {
  for (let i = 0; i < tries; i++) {
    const s = await WV_AUTH.status(true);
    if (s.subscribed) return s;
    if (i < tries - 1) await new Promise(r => setTimeout(r, gapMs));
  }
  return WV_AUTH.status(true);
}

function checkoutResult() {
  const p = new URLSearchParams(location.search || '');
  const c = p.get('checkout');
  if (!c) return null;
  history.replaceState(null, '', location.pathname);   /* don't leave it in history */
  return c;
}

function routeFromHash() {
  const h = (location.hash || '').replace('#', '').toLowerCase();
  if (h === 'signin') { history.replaceState(null, '', location.pathname); return 'auth'; }
  if (h === 'signup') { history.replaceState(null, '', location.pathname); return 'signup'; }
  if (h === 'reset') { history.replaceState(null, '', location.pathname); return 'reset'; }
  if (h === 'pricing' || h === 'upgrade') { history.replaceState(null, '', location.pathname); return 'paywall'; }
  return null;
}

(async function bootAccount() {
  const checkout = checkoutResult();
  const deepLink = routeFromHash();
  const result = WV_AUTH.captureRedirect();
  if (result === 'signed-in') { WV_AUTH.invalidate(); toast('Signed in'); }
  const acct = await refreshAccount();

  if (typeof result === 'string' && result && result !== 'signed-in' && result !== 'recovery') {
    /* Expired or already-used link. Put them on sign-in with a way forward. */
    show('auth');
    showErr('#auth-error', result);
  } else if (result === 'recovery') {
    /* Arrived from a reset link: they hold a temporary session, so send them
       straight to choosing a new password. */
    show('reset');
  } else if (deepLink) {
    if (deepLink === 'paywall') renderPaywall(null, acct);
    show(deepLink);
  } else if (checkout === 'success') {
    /* Show the confirmation immediately; confirm the subscription behind it. */
    show('welcome-pro');
    document.body.classList.remove('booting');
    const s = await waitForSubscription();
    renderDashboard(s);
    if (!s.subscribed) {
      $('#pro-kicker').textContent = 'Payment received';
      $('#pro-title').textContent = 'Almost there';
      $('#pro-sub').textContent = 'Stripe has your payment. Your plan takes a moment to activate — refresh if the app still asks you to subscribe.';
      $('#pro-note').textContent = 'If it stays like this for more than a minute, email support@whyviral.io and we will sort it.';
    } else if (s.status !== 'trialing') {
      $('#pro-kicker').textContent = 'Subscribed';
      $('#pro-sub').textContent = 'Everything is unlocked. Cancel any time from your account.';
      $('#pro-note').textContent = 'A receipt is on its way to your inbox.';
    }
    return;
  } else if (checkout === 'cancelled') {
    renderPaywall(null, acct);
    show('paywall');
    showErr('#paywall-error', 'Checkout was cancelled — nothing has been charged.');
  } else if (acct.signedIn) {
    /* Signed in: the workspace, not the pitch. */
    renderDashboard(acct);
    show('home');
  }

  /* Reveal only once routing has decided, so the welcome screen never flashes
     before the sign-up form it was supposed to show. */
  document.body.classList.remove('booting');
})();

/* ================= dashboard ================= */
/* Signed-in people get a workspace, not a pitch. The primary action sits on
   the page itself so the common case is zero clicks away. */

const QMAX = 5;
let qrows = [];

function qAdd(value = '') {
  if (qrows.length >= QMAX) return;
  const row = el('div', 'qrow');
  row.innerHTML = '<span class="n"></span><input type="text" placeholder="Paste a TikTok link" autocomplete="off" spellcheck="false"><button class="rm" aria-label="Remove">×</button>';
  const inp = row.querySelector('input');
  inp.value = value;
  inp.addEventListener('input', () => { inp.classList.toggle('ok', isTikTok(inp.value.trim())); qCount(); });
  row.querySelector('.rm').onclick = () => {
    if (qrows.length <= 1) { inp.value = ''; inp.classList.remove('ok'); qCount(); return; }
    qrows = qrows.filter(r => r !== row); row.remove(); qCount();
  };
  $('#quick-links').appendChild(row);
  qrows.push(row);
  qCount();
}
function qCount() {
  qrows.forEach((r, i) => r.querySelector('.n').textContent = i + 1);
  const filled = qrows.filter(r => isTikTok(r.querySelector('input').value.trim())).length;
  const hint = $('#launch-count');
  if (hint) hint.textContent = `${filled} of ${QMAX} links`;
  const add = $('#quick-add');
  if (add) add.hidden = qrows.length >= QMAX;
}
if ($('#quick-links')) { for (let i = 0; i < 3; i++) qAdd(); }
$('#quick-add')?.addEventListener('click', () => qAdd());

/* Hand the dashboard's inputs to the existing analysis screen and run it, so
   there is one code path for analysis rather than two that can drift. */
$('#quick-go')?.addEventListener('click', () => {
  const topic = ($('#quick-topic').value || '').trim();
  const links = qrows.map(r => r.querySelector('input').value.trim()).filter(Boolean);
  const err = $('#quick-error');
  err.hidden = true;
  if (!topic) { err.textContent = 'Name the product first — the scripts are built around it.'; err.hidden = false; $('#quick-topic').focus(); return; }
  if (links.filter(isTikTok).length < 3) { err.textContent = 'Add at least 3 TikTok links. The method needs videos to compare.'; err.hidden = false; return; }

  $('#topic').value = topic;
  while (rows.length < links.length) addRow();
  rows.forEach((r, i) => {
    const inp = r.querySelector('input');
    inp.value = links[i] || '';
    inp.dispatchEvent(new Event('input'));
  });
  $('#start-analysis').click();
});

function renderDashboard(s) {
  const greet = $('#dash-greet');
  if (greet) {
    const h = new Date().getHours();
    const when = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    greet.textContent = s.name ? `${when}, ${s.name.split(' ')[0]}` : when;
  }

  const hist = readHistory();
  const sub = $('#dash-sub');
  if (sub) sub.textContent = hist.length ? 'What are we breaking down next?' : 'Paste three viral videos to begin.';

  const stats = $('#dash-stats');
  if (stats) {
    stats.innerHTML = '';
    const scripts = hist.reduce((n, r) => n + (r.findings?.length ? 1 : 0), 0);
    [[hist.length, hist.length === 1 ? 'breakdown' : 'breakdowns'],
     [hist.reduce((n, r) => n + (r.videoCount || 0), 0), 'videos read'],
     [scripts, 'patterns found']].forEach(([n, l]) => {
      const d = el('div', 'dash-stat');
      d.appendChild(el('b', null, String(n)));
      d.appendChild(el('span', null, l));
      stats.appendChild(d);
    });
  }

  const wrap = $('#recent-wrap'), list = $('#recent-list');
  if (wrap && list) {
    list.innerHTML = '';
    hist.slice(0, 3).forEach(r => {
      const b = el('button', 'recent-item');
      const left = el('div');
      left.appendChild(el('div', 't', r.topic || 'Untitled'));
      const n = r.findings.length;
      left.appendChild(el('div', 'm', `${r.videoCount} videos · ${n} shared trait${n === 1 ? '' : 's'} · ${r.confidence} confidence`));
      b.appendChild(left);
      b.appendChild(el('span', 'when', new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
      b.onclick = () => { current = r; renderResult(r); show('result'); };
      list.appendChild(b);
    });
    wrap.hidden = hist.length === 0;
  }
}

$('#pro-start')?.addEventListener('click', async () => {
  renderDashboard(await WV_AUTH.status());
  show('home');
});

$('#tool-history')?.addEventListener('click', () => { renderHistory(); show('history'); });
$('#recent-all')?.addEventListener('click', () => { renderHistory(); show('history'); });
$('#tool-hooks')?.addEventListener('click', () => {
  const hist = readHistory();
  if (!hist.length) { toast('Run a breakdown first — hooks are built from one.'); return; }
  current = hist[0];
  scriptCount = Math.max(scriptCount, 4);
  renderResult(current);
  $('#build-scripts').click();
});

/* ---- score a draft ----
   The retention loop: check your own writing against a pattern you already
   trust. Runs entirely on the existing engine, no extra API cost. */
$('#tool-score')?.addEventListener('click', () => {
  const hist = readHistory();
  if (!hist.length) { toast('Run a breakdown first — scoring compares against one.'); return; }
  const sel = $('#score-source');
  sel.innerHTML = '';
  hist.forEach((r, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${r.topic || 'Untitled'} · ${new Date(r.createdAt).toLocaleDateString()}`;
    sel.appendChild(o);
  });
  $('#score-out').innerHTML = '';
  $('#score-text').value = '';
  show('score');
});

$('#score-go')?.addEventListener('click', () => {
  const hist = readHistory();
  const r = hist[Number($('#score-source').value || 0)];
  const text = ($('#score-text').value || '').trim();
  const err = $('#score-error'); err.hidden = true;
  if (!r) { err.textContent = 'Pick a breakdown to compare against.'; err.hidden = false; return; }
  if (text.length < 15) { err.textContent = 'Paste a bit more — at least a sentence.'; err.hidden = false; return; }

  const f = extractFeatures({ url: 'draft', caption: text });
  const targets = r.findings.slice(0, 8);
  const hits = targets.map(t => ({ ...t, present: !!f.traits[t.key] }));
  const got = hits.filter(h => h.present).length;
  const pct = targets.length ? Math.round((got / targets.length) * 100) : 0;

  const out = $('#score-out');
  out.innerHTML = '';
  const head = el('div', 'score-head');
  const ring = el('div', 'score-ring', `${pct}%`);
  ring.style.background = pct >= 70 ? 'rgba(143,217,245,.3)' : pct >= 40 ? 'rgba(201,184,255,.32)' : 'rgba(255,61,139,.13)';
  ring.style.color = pct >= 70 ? 'var(--blue-deep)' : pct >= 40 ? '#4B34A8' : 'var(--pink-deep)';
  head.appendChild(ring);
  const txt = el('div');
  txt.appendChild(el('div', 'score-word', pct >= 70 ? 'Close to the pattern' : pct >= 40 ? 'Halfway there' : 'Off the pattern'));
  txt.appendChild(el('div', 'score-note', `Your draft hits ${got} of ${targets.length} traits these videos shared. The misses below are the cheapest things to change.`));
  head.appendChild(txt);
  out.appendChild(head);

  /* Misses first — that is the part someone can act on. */
  [...hits.filter(h => !h.present), ...hits.filter(h => h.present)].forEach(h => {
    const row = el('div', 'hit ' + (h.present ? 'yes' : 'no'));
    row.appendChild(el('span', 'mark', h.present ? '✓' : '—'));
    const d = el('div');
    d.appendChild(el('div', 'l', h.label));
    if (!h.present) d.appendChild(el('div', 'w', h.why));
    row.appendChild(d);
    out.appendChild(row);
  });
});
