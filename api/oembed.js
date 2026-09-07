/* GET /api/oembed?url=<tiktok url>
   Proxies TikTok's public oEmbed endpoint. No key, no auth, no cost.
   Exists because the browser cannot call it directly (CORS) and because
   short links (vm.tiktok.com) need a redirect resolved server-side. */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=3600',
  'access-control-allow-origin': '*',
};

const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function valid(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' && /(^|\.)tiktok\.com$/.test(p.hostname);
  } catch { return false; }
}

async function resolveShort(url) {
  const host = new URL(url).hostname;
  if (!/^(vm|vt)\.tiktok\.com$/.test(host)) return url;
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; WhyViral/1.0)' } });
    return valid(r.url) ? r.url.split('?')[0] : url;
  } catch { return url; }
}

async function onRequestGet({ request }) {
  const target = new URL(request.url).searchParams.get('url');
  if (!target) return ok({ error: 'missing url parameter' }, 400);
  if (!valid(target)) return ok({ error: 'not a tiktok url' }, 400);

  const full = await resolveShort(target);

  try {
    const res = await fetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(full), {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; WhyViral/1.0)' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!res.ok) return ok({ error: 'oembed unavailable', status: res.status }, 502);
    const d = await res.json();
    return ok({
      title: d.title || '',
      author_name: d.author_name || '',
      author_unique_id: d.author_unique_id || '',
      thumbnail_url: d.thumbnail_url || '',
      resolved_url: full,
    });
  } catch (e) {
    return ok({ error: 'fetch failed', detail: String(e) }, 502);
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
