/* GET /api/control?tag=<hashtag>&topic=<text>&exclude=<id,id>
   Ordinary videos from the same niche, so trait rates are measured rather than
   guessed. Returns the LOW-performing half by view count: the question is not
   what viral videos do, it is what they do that ordinary ones don't. */

import { json, getHashtagVideos, searchVideos, normalizeVideoList } from './_provider.js';
import { checkAccess, denyResponse } from './_gate.js';

const MIN_USABLE = 6;

async function onRequestGet({ request, env }) {
  /* Gated, but deliberately not counted: the control set is part of one
     analysis, not a separate billable action. */
  const access = await checkAccess(env, request);
  if (!access.allowed) return denyResponse(access);

  if (!env.SCRAPER_KEY) return json({ enabled: false, videos: [] }, 503, 0);

  const q = new URL(request.url).searchParams;
  const tag = (q.get('tag') || '').replace(/^#/, '').trim();
  const topic = (q.get('topic') || '').trim();
  const exclude = new Set((q.get('exclude') || '').split(',').filter(Boolean));
  if (!tag && !topic) return json({ error: 'need a tag or topic' }, 400, 0);

  let pool = [];
  try {
    if (tag) {
      const r = await getHashtagVideos(env, tag).catch(() => null);
      pool = r ? normalizeVideoList(r) : [];
    }
    /* Hashtag pages come back thin sometimes; keyword search is the fallback
       and usually returns a wider spread of performance. */
    if (pool.length < MIN_USABLE && topic) {
      const r = await searchVideos(env, topic).catch(() => null);
      pool = pool.concat(r ? normalizeVideoList(r) : []);
    }
  } catch (e) {
    return json({ error: 'upstream failed', detail: String(e) }, 502, 0);
  }

  const seen = new Set();
  pool = pool
    .filter(v => v && v.id && !exclude.has(String(v.id)))
    .filter(v => (seen.has(v.id) ? false : (seen.add(v.id), true)))
    .filter(v => v.caption && v.stats.plays > 0);

  if (pool.length < MIN_USABLE) {
    return json({ enabled: true, sufficient: false, found: pool.length, videos: [] }, 200, 1800);
  }

  pool.sort((a, b) => a.stats.plays - b.stats.plays);
  const control = pool.slice(0, Math.max(MIN_USABLE, Math.floor(pool.length / 2)));
  const median = arr => {
    const s = [...arr].sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };

  return json({
    enabled: true,
    sufficient: true,
    source: tag ? `#${tag}` : topic,
    sampled: pool.length,
    videos: control.map(v => ({
      caption: v.caption, hashtags: v.hashtags, duration: v.duration,
      soundOriginal: v.soundOriginal, followerCount: v.followerCount, rates: v.rates,
    })),
    medianPlays: median(control.map(v => v.stats.plays)),
    medianRates: {
      share: median(control.map(v => v.rates?.share || 0)),
      save: median(control.map(v => v.rates?.save || 0)),
      comment: median(control.map(v => v.rates?.comment || 0)),
      like: median(control.map(v => v.rates?.like || 0)),
    },
  }, 200, 1800);
}

/* ---- Vercel Edge adapter ---- */
export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'content-type, accept',
      },
    });
  }
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json', allow: 'GET, OPTIONS' },
    });
  }
  /* Cloudflare hands env in; on Vercel it lives on process.env. */
  return onRequestGet({ request, env: process.env });
}
