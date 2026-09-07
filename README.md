# WhyViral

Paste 3–5 viral TikToks about one product. WhyViral finds the traits they share
that ordinary videos don't, then writes scripts built on that pattern.

Live: deployed on Vercel from this repo.

---

## How it works

**1. Pull the data.** Each link goes through `/api/enrich` — caption, hashtags,
spoken transcript, duration, engagement counts, and up to 30 comments. Without
an API key it falls back to `/api/oembed`, which is free and keyless but returns
caption and author only.

**2. Extract features.** 37 traits per video: hook classification across 11
patterns, problem-framing, second-person address, urgency, price mentions, CTA
presence, caption casing, hashtag structure, speaking pace, video length,
original vs trending sound. When a transcript exists the hook is read from what
was *said*, not the caption — those are frequently unrelated.

**3. Measure against a control set, honestly.** `/api/control` pulls up to 50 ordinary
videos from the most-shared hashtag and keeps the low-performing half. Trait
rates are counted in that group, so "3.1× more common" is a measurement rather
than a guess. Without a key it falls back to a static estimate table, and the UI
labels which one it used.

**4. Compare in code, not in a model.** Overlap is computed arithmetically, then
phrased in prose. Handing the comparison to an LLM produces invented patterns
every time, because that is what you asked it for.

**5. Mine the comments.** Buying intent, price objections, doubt, compatibility
questions. A theme only counts if it appears across multiple videos. The
strongest objection becomes a beat in every generated script.

**6. Generate scripts.** 1–6 scripts across different angles, with per-beat
timings, shot directions, caption, hashtags, and must-say lines.

## Layout

```
api/            Vercel Edge Functions
  _provider.js  ScrapeCreators client (underscore = not routed)
  oembed.js     free keyless caption lookup
  enrich.js     full video data + transcript + comments
  control.js    control set for measured base rates
public/         static site, served at the root
  engine.js     feature extraction and comparison — pure, portable
  comments.js   comment mining
  scriptgen.js  script assembly
  app.js        routing, fetching, rendering, local history
test/           8 suites, 274 assertions
```

`engine.js`, `comments.js` and `scriptgen.js` touch no browser or platform APIs,
so they move to React Native or a server unchanged.

## Local development

```bash
npm install
cp .env.example .env.local     # add your key
npx vercel dev                 # serves the site and the API together
npm run test:all
```

Opening `public/index.html` directly also works — the app ships as classic
scripts, not ES modules, so `file://` doesn't break it. The `/api/*` routes
won't exist that way, so captions get pasted by hand.

## Deploying

Push to `main`. Vercel builds and deploys automatically. Pull requests get their
own preview URL.

Environment variables live in the Vercel dashboard under
**Settings → Environment Variables**:

| Name | Required | Notes |
|---|---|---|
| `SCRAPER_KEY` | no | ScrapeCreators key. Without it the app runs caption-only. |
| `SB_REGION` | no | Defaults to `US`. |

Never commit the key. `.env.local` is gitignored.

## Costs

Three calls per video (details, transcript, comments) plus one control call, so
about 16 requests per five-video analysis. ScrapeCreators gives 100 free credits
on signup and they never expire. Check current per-endpoint costs on their
pricing page before scaling.

## Known gaps

**On-screen text.** The overlay is the real hook on roughly half of TikToks and
no provider currently exposes it directly. Stated in the UI rather than hidden.

**Provider field shapes.** `api/_provider.js` reads through candidate field
names rather than assuming one payload shape, so a provider renaming a field
degrades one value instead of blanking the app. If something comes back empty on
real data, the `FIELDS` map at the bottom of that file is the only place to fix
it — and `test/provider.mjs` covers the shapes seen so far.

**Frame and pacing analysis.** Cut rate and shot length need the video file and
ffmpeg. `download_no_watermark_addr` gives you a clean MP4 when you want it.

**Outcome tracking.** The highest-value thing left. Let a creator paste back
their posted video, pull its stats, and record which predicted traits they
actually executed. That builds a dataset nobody else has.

## Conventions

`public/*.js` files are classic scripts sharing one global scope — a deliberate
trade so `file://` works. `test/globals.mjs` fails the build if two files
declare the same top-level name, which is otherwise a silent page-killing
SyntaxError.
