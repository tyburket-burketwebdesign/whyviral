/* GET /api/enrich?url=<tiktok url>
   Full metadata + spoken transcript + comments for one video.
   With no SCRAPER_KEY configured it returns 503 {enabled:false} and the front
   end falls back to the free oEmbed path. */

import { json, validTikTokUrl, resolveShort, getVideo, getTranscript, getComments,
         normalizeVideo, normalizeTranscript, normalizeComments } from './_provider.js';
import { checkAccess, commitUsage, denyResponse } from './_gate.js';

async function onRequestGet({ request, env }) {
  /* Entitlement first: never spend an API credit on a request that isn't
     allowed to have one. */
  const access = await checkAccess(env, request);
  if (!access.allowed) return denyResponse(access);

  if (!env.SCRAPER_KEY) return json({ enabled: false, reason: 'no key configured' }, 503, 0);

  const target = new URL(request.url).searchParams.get('url');
  if (!target || !validTikTokUrl(target)) return json({ error: 'not a tiktok url' }, 400, 0);

  const full = await resolveShort(target);

  try {
    /* Transcript and comments are optional and the most likely to come back
       empty (silent video, comments disabled). Neither may fail the request. */
    const [detail, transcript, comments] = await Promise.all([
      getVideo(env, full),
      getTranscript(env, full).catch(() => null),
      getComments(env, full).catch(() => null),
    ]);

    const video = normalizeVideo(detail, { url: full });
    if (!video.caption && !video.stats.plays) {
      return json({ error: 'no usable video data returned',
                    sample: JSON.stringify(detail).slice(0, 300) }, 502, 0);
    }
    const t = normalizeTranscript(transcript);

    /* Only now, with real data in hand, does this count against the trial. */
    await commitUsage(env, access, 'enrich', { id: video.id });

    return json({
      enabled: true,
      access: { mode: access.mode, remaining: access.remaining ?? null },
      ...video,
      transcript: t.text,
      subtitleTracks: t.tracks,
      creatorCaptioned: t.creatorCaptioned,
      comments: comments ? normalizeComments(comments) : [],
    });
  } catch (e) {
    return json({ error: 'upstream failed', status: e.status || 0, detail: e.body || String(e) }, 502, 0);
  }
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
