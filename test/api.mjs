/* The Vercel build is generated code, so it gets tested like any other
   deliverable. Vercel Edge uses the same Request/Response API as Workers,
   so these handlers can run directly under Node 18+. */
import fs from 'fs';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };
const req = (p, m = 'GET') => new Request('https://whyviral.vercel.app' + p, { method: m });

console.log('--- api handlers ---');

for (const f of ['api/_provider.js', 'api/oembed.js', 'api/enrich.js', 'api/control.js',
                 'public/index.html', 'public/comments.js', 'vercel.json', 'package.json']) {
  check(`${f} exists`, fs.existsSync('' + f));
}

const enrichSrc = fs.readFileSync('api/enrich.js', 'utf8');
check('imports the provider module', enrichSrc.includes("from './_provider.js'"));
check('edge runtime declared', /runtime:\s*'edge'/.test(enrichSrc));
check('has a default export', /export default async function handler/.test(enrichSrc));
check('cloudflare onRequestOptions stripped', !enrichSrc.includes('onRequestOptions'));
check('no duplicate export of onRequestGet', (enrichSrc.match(/export async function onRequestGet/g) || []).length === 0);

const vjson = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
check('framework set to null', vjson.framework === null);
check('output directory is public', vjson.outputDirectory === 'public');

/* Execute them. */
const load = async n => (await import('../api/' + n + '.js?v=' + Date.now())).default;
const enrich = await load('enrich');
const control = await load('control');
const oembed = await load('oembed');

const prev = process.env.SCRAPER_KEY;
delete process.env.SCRAPER_KEY;

const e = await enrich(req('/api/enrich?url=https://www.tiktok.com/@a/video/1'));
check('enrich degrades to 503 with no key', e.status === 503, String(e.status));
check('enrich reports disabled', (await e.json()).enabled === false);
const c = await control(req('/api/control?tag=x'));
check('control degrades to 503 with no key', c.status === 503);

process.env.SCRAPER_KEY = 'test-key';
const bad = await enrich(req('/api/enrich?url=https://evil.com/x'));
check('url validation intact', bad.status === 400);
const noid = await enrich(req('/api/enrich?url=https://www.tiktok.com/@a'));
check('profile url without a video id rejected', noid.status === 400);
const noargs = await control(req('/api/control'));
check('control arg validation intact', noargs.status === 400);
check('reads key from process.env', (await enrich(req('/api/enrich?url=https://www.tiktok.com/@a/video/1'))).status !== 503);

check('CORS preflight handled', (await enrich(req('/api/enrich', 'OPTIONS'))).status === 200);
const post = await enrich(req('/api/enrich', 'POST'));
check('non-GET rejected', post.status === 405);
check('405 advertises methods', post.headers.get('allow') === 'GET, OPTIONS');

/* Control logic end to end with the network stubbed. */
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, json: async () => ({ videos: Array.from({ length: 20 }, (_, i) => ({
  id: String(i), description: `v${i} #tag`, hashtags: ['tag'], video: { duration: 30 },
  stats: { play_count: (i + 1) * 1000, digg_count: 5, comment_count: 1, share_count: 2, collect_count: 3 },
  author: { unique_id: 'u' + i, follower_count: 5000 }, music: { original: false } })) }) });
const ctl = await control(req('/api/control?tag=tag&topic=x'));
const cb = await ctl.json();
check('control returns a usable set', cb.sufficient === true && cb.videos.length > 5);
check('control skews low', cb.medianPlays < 12000, String(cb.medianPlays));
globalThis.fetch = realFetch;

if (prev === undefined) delete process.env.SCRAPER_KEY; else process.env.SCRAPER_KEY = prev;
void oembed;

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
