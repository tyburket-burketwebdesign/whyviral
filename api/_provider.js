/* Data provider: ScrapeCreators.
   https://docs.scrapecreators.com — one x-api-key header, GET with query params.

   Endpoints take a TikTok URL directly, so there's no video-id parsing.

   Every normalizer below reads through a list of candidate field names rather
   than assuming one shape. Providers rename things; this keeps a rename from
   turning into a blank screen. If a field comes back empty on real data, fix it
   in the FIELDS map at the bottom — that's the only place to touch. */

const BASE = 'https://api.scrapecreators.com';

export const json = (body, status = 200, maxAge = 3600) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': `public, max-age=${maxAge}`,
    'access-control-allow-origin': '*',
  },
});

export function validTikTokUrl(u) {
  try {
    const p = new URL(u);
    if (p.protocol !== 'https:' || !/(^|\.)tiktok\.com$/.test(p.hostname)) return false;
    /* Short links resolve later, so allow them through unexamined. Otherwise
       require a video or photo path — a profile URL costs a credit and returns
       nothing this app can use. */
    if (/^(vm|vt)\.tiktok\.com$/.test(p.hostname)) return true;
    return /\/(video|photo)\/\d+/.test(p.pathname);
  } catch { return false; }
}

/* Kept so short links still resolve before we hand the URL over. */
export async function resolveShort(url) {
  if (!/^(vm|vt)\.tiktok\.com$/.test(new URL(url).hostname)) return url;
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; WhyViral/1.0)' } });
    return validTikTokUrl(r.url) ? r.url.split('?')[0] : url;
  } catch { return url; }
}

async function call(env, path, params) {
  const key = env.SCRAPER_KEY;
  const qs = new URLSearchParams(params);
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { 'x-api-key': key, accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`scrapecreators ${res.status}`), { status: res.status, body: body.slice(0, 300) });
  }
  return res.json();
}

export const getVideo = (env, url) => call(env, '/v2/tiktok/video', { url });
export const getTranscript = (env, url) => call(env, '/v1/tiktok/video/transcript', { url });
export const getComments = (env, url) => call(env, '/v1/tiktok/video/comments', { url });
export const getHashtagVideos = (env, hashtag) => call(env, '/v1/tiktok/search/hashtag', { hashtag });
export const searchVideos = (env, query) => call(env, '/v1/tiktok/search/keyword', { query });

/* ---------- defensive field access ---------- */

const dig = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/* First non-empty value across candidate paths. */
function firstOf(obj, paths, fallback = undefined) {
  for (const p of paths) {
    const v = dig(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return fallback;
}

/* Providers wrap the video in different envelopes. Unwrap carefully: a real
   payload also has a `video` field holding media metadata, so unwrapping
   blindly lands on {duration, cover} and loses everything else. Only descend
   when the candidate actually looks like a video record. */
const looksLikeVideo = o => !!o && typeof o === 'object' && !Array.isArray(o) &&
  (firstOf(o, FIELDS.id) !== undefined || firstOf(o, FIELDS.desc) !== undefined);

function unwrap(p) {
  if (!p || typeof p !== 'object') return {};
  if (looksLikeVideo(p)) return p;
  for (const k of ['aweme_detail', 'data', 'item', 'result', 'video', 'aweme_info']) {
    if (looksLikeVideo(p[k])) return p[k];
  }
  return p;
}

const FIELDS = {
  id:        ['aweme_id', 'id', 'video_id'],
  desc:      ['desc', 'description', 'title', 'caption'],
  author:    ['author.unique_id', 'author.uniqueId', 'author.username', 'author_unique_id'],
  followers: ['author.follower_count', 'author.followerCount', 'authorStats.followerCount'],
  verified:  ['author.verified', 'author.is_verified'],
  cover:     ['video.cover', 'video.origin_cover', 'cover', 'thumbnail_url', 'thumbnail'],
  duration:  ['video.duration', 'duration', 'videoMeta.duration'],
  plays:     ['statistics.play_count', 'stats.play_count', 'stats.playCount', 'statistics.playCount', 'play_count', 'view_count'],
  likes:     ['statistics.digg_count', 'stats.digg_count', 'stats.diggCount', 'digg_count', 'like_count'],
  comments:  ['statistics.comment_count', 'stats.comment_count', 'stats.commentCount', 'comment_count'],
  shares:    ['statistics.share_count', 'stats.share_count', 'stats.shareCount', 'share_count'],
  saves:     ['statistics.collect_count', 'stats.collect_count', 'stats.collectCount', 'collect_count', 'save_count'],
  musicOrig: ['music.original', 'music.is_original_sound', 'music.isOriginal'],
  musicName: ['music.title', 'music.name'],
  created:   ['create_time', 'createTime', 'created_at'],
  slideshow: ['is_slideshow', 'image_post_info'],
};

const num = v => (typeof v === 'number' ? v : Number(v) || 0);

/* Cover images arrive either as a plain URL or as an object carrying url_list.
   Anything that isn't a usable string becomes null rather than "[object Object]". */
function asUrl(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.startsWith('http') ? v : null;
  const list = v.url_list || v.urlList;
  if (Array.isArray(list) && list.length) return String(list[0]);
  if (typeof v.uri === 'string' && v.uri.startsWith('http')) return v.uri;
  return null;
}

function extractHashtags(v, desc) {
  const raw = firstOf(v, ['hashtags', 'challenges', 'text_extra', 'cha_list'], null);
  if (Array.isArray(raw)) {
    const names = raw
      .map(h => (typeof h === 'string' ? h : (h?.name ?? h?.hashtag_name ?? h?.title ?? '')))
      .filter(Boolean).map(s => String(s).replace(/^#/, '').toLowerCase());
    if (names.length) return names;
  }
  return (String(desc || '').match(/#[\p{L}\p{N}_]+/gu) || []).map(h => h.slice(1).toLowerCase());
}

export function normalizeVideo(payload, extra = {}) {
  const v = unwrap(payload);
  const desc = firstOf(v, FIELDS.desc, '');
  const plays = num(firstOf(v, FIELDS.plays, 0));
  const likes = num(firstOf(v, FIELDS.likes, 0));
  const comments = num(firstOf(v, FIELDS.comments, 0));
  const shares = num(firstOf(v, FIELDS.shares, 0));
  const saves = num(firstOf(v, FIELDS.saves, 0));

  let duration = num(firstOf(v, FIELDS.duration, 0)) || null;
  /* Some providers report milliseconds. Anything over 10 minutes is almost
     certainly ms for short-form video. */
  if (duration && duration > 600) duration = Math.round(duration / 1000);

  return {
    id: firstOf(v, FIELDS.id, null),
    url: extra.url || firstOf(v, ['share_url', 'url'], ''),
    caption: String(desc),
    hashtags: extractHashtags(v, desc),
    author: firstOf(v, FIELDS.author, null),
    followerCount: firstOf(v, FIELDS.followers, null) ?? null,
    verified: !!firstOf(v, FIELDS.verified, false),
    thumbnail: asUrl(firstOf(v, FIELDS.cover, null)),
    duration,
    isSlideshow: !!firstOf(v, FIELDS.slideshow, false),
    soundOriginal: firstOf(v, FIELDS.musicOrig, null),
    soundTitle: firstOf(v, FIELDS.musicName, null),
    postedAt: firstOf(v, FIELDS.created, null),
    stats: { plays, likes, comments, shares, saves },
    rates: plays > 0
      ? { like: likes / plays, comment: comments / plays, share: shares / plays, save: saves / plays }
      : null,
    ...extra,
  };
}

export function normalizeTranscript(payload) {
  if (!payload) return { text: '', tracks: 0, creatorCaptioned: false };
  const text = firstOf(payload, ['transcript', 'text', 'voice_to_text', 'data.transcript',
    'transcript_text', 'data.text', 'subtitle', 'captions'], '');
  const tracks = firstOf(payload, ['subtitles', 'tracks'], []);
  const list = Array.isArray(tracks) ? tracks : [];
  return {
    text: typeof text === 'string' ? text.trim()
      : (Array.isArray(text) ? text.map(t => t?.text ?? '').join(' ').trim() : ''),
    tracks: list.length,
    creatorCaptioned: list.some(t => t?.source && String(t.source).toUpperCase() !== 'ASR'),
  };
}

export function normalizeComments(payload) {
  const list = firstOf(payload, ['comments', 'data', 'items', 'comment_list'], null);
  const arr = Array.isArray(list) ? list : (Array.isArray(payload) ? payload : []);
  return arr.map(c => ({
    text: String(firstOf(c, ['text', 'comment', 'content', 'desc'], '')).trim(),
    likes: num(firstOf(c, ['digg_count', 'like_count', 'likes', 'diggCount'], 0)),
  })).filter(c => c.text.length > 1).slice(0, 50);
}

export function normalizeVideoList(payload) {
  const list = firstOf(payload, ['videos', 'aweme_list', 'data', 'items', 'search_item_list', 'results'], null);
  const arr = Array.isArray(list) ? list : (Array.isArray(payload) ? payload : []);
  return arr.map(item => normalizeVideo(item.aweme_info || item.item || item));
}
