
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
$('#brand-home').onclick = () => show('welcome');
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
    b.appendChild(el('p', 'sum', `${r.videoCount} videos · ${r.findings.length} shared traits · ${r.confidence} confidence`));
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

async function refreshAccount() {
  const s = await WV_AUTH.status(true);
  const bar = $('#acct-state');
  if (!bar) return s;
  bar.innerHTML = '';
  if (!s.billing) { bar.hidden = true; return s; }
  bar.hidden = false;

  if (s.subscribed) {
    bar.appendChild(el('span', 'trial-pill', s.status === 'trialing' ? 'Trial' : 'Pro'));
    const m = $('#paywall-manage'); if (m) m.hidden = false;
  } else if (s.trialMode === 'card') {
    bar.appendChild(el('span', 'trial-pill', `${s.trialDays || 7}-day trial`));
  } else if (typeof s.remaining === 'number') {
    bar.appendChild(el('span', 'trial-pill', `${s.remaining} free left`));
  }
  try { renderPaywall(null, s); } catch {}
  const btn = el('button', 'ghost-btn', s.signedIn ? 'Sign out' : 'Sign in');
  btn.onclick = async () => {
    if (s.signedIn) { WV_AUTH.signOut(); WV_AUTH.invalidate(); await refreshAccount(); show('welcome'); }
    else show('auth');
  };
  bar.appendChild(btn);
  return s;
}

let authEmail = '';
const sendBtn = $('#auth-send');
const showAuthError = m => { const e = $('#auth-error'); e.textContent = m; e.hidden = false; };

async function requestCode() {
  const email = ($('#auth-email').value || '').trim();
  $('#auth-error').hidden = true;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showAuthError('That email does not look right.'); return; }
  authEmail = email;
  sendBtn.disabled = true;
  const original = sendBtn.textContent;
  sendBtn.textContent = 'Sending…';
  try {
    await WV_AUTH.sendCode(email);
    $('#auth-step2').hidden = false;
    sendBtn.textContent = 'Code sent';
    $('#auth-code').focus();
  } catch (e) {
    showAuthError(String(e.message || e));
    sendBtn.disabled = false;
    sendBtn.textContent = original;
  }
}
if (sendBtn) sendBtn.onclick = requestCode;

const resendBtn = $('#auth-resend');
if (resendBtn) resendBtn.onclick = () => { sendBtn.disabled = false; requestCode(); };

const verifyBtn = $('#auth-verify');
async function submitCode() {
  const code = ($('#auth-code').value || '').trim();
  $('#auth-error').hidden = true;
  verifyBtn.disabled = true;
  verifyBtn.textContent = 'Checking…';
  try {
    await WV_AUTH.verifyCode(authEmail, code);
    WV_AUTH.invalidate();
    await refreshAccount();
    toast('Signed in');
    show('welcome');
  } catch (e) {
    showAuthError(String(e.message || e));
    verifyBtn.disabled = false;
    verifyBtn.textContent = 'Sign in';
  }
}
if (verifyBtn) verifyBtn.onclick = submitCode;

const codeInput = $('#auth-code');
if (codeInput) {
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    if (codeInput.value.length === 6) submitCode();     /* auto-submit on the 6th digit */
  });
  codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitCode(); });
}
$('#auth-email')?.addEventListener('keydown', e => { if (e.key === 'Enter') requestCode(); });

const payGo = $('#paywall-go');
if (payGo) payGo.onclick = async () => {
  const signedIn = await WV_AUTH.isSignedIn();
  if (!signedIn) {
    $('#auth-title').textContent = 'Sign in to subscribe';
    $('#auth-lede').textContent = 'We need an email to attach your subscription to. No password required.';
    show('auth');
    return;
  }
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

(async function bootAccount() {
  const result = WV_AUTH.captureRedirect();
  if (result === 'signed-in') {
    WV_AUTH.invalidate();
    toast('Signed in');
  } else if (typeof result === 'string' && result) {
    /* A dead magic link used to leave a blank page. Say what happened and
       put them straight back into the code flow. */
    show('auth');
    showAuthError(result);
  }
  await refreshAccount();
})();
