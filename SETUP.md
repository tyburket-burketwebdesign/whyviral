# Getting this on GitHub and Vercel

## 1. Push to GitHub

Create an empty repo at github.com/new — name it `whyviral`, no README, no
.gitignore, no license. GitHub shows you a URL; copy it.

This folder is already a git repo with a commit, so:

```bash
cd ~/Downloads/whyviral
git remote add origin https://github.com/YOUR-USERNAME/whyviral.git
git branch -M main
git push -u origin main
```

If it asks for a password, use a personal access token, not your account
password: github.com/settings/tokens → Generate new token (classic) → tick
`repo` → copy → paste as the password.

## 2. Connect Vercel

1. vercel.com → **Add New → Project**
2. **Import Git Repository** → pick `whyviral` (authorise GitHub if asked)
3. Framework Preset: **Other**. Leave build and output settings alone —
   `vercel.json` already sets them.
4. **Deploy**

You get a URL like `whyviral.vercel.app`.

## 3. Add your API key

Project → **Settings → Environment Variables**

| Key | Value | Environments |
|---|---|---|
| `SCRAPER_KEY` | your ScrapeCreators key | Production, Preview, Development |

Then **Deployments → latest → ⋯ → Redeploy**. Environment variables do not
apply to deployments that already exist.

## 4. Check it

```
https://YOUR-SITE.vercel.app/api/oembed?url=https://www.tiktok.com/@tiktok/video/7106594312292453675
```

Raw JSON = the API layer is running.

```
https://YOUR-SITE.vercel.app/api/enrich?url=<same url>
```

- big JSON blob with `stats` and `transcript` → the key works
- `{"enabled":false}` → key not set, or you didn't redeploy
- `"status":401` → ScrapeCreators rejected the key
- `"status":429` → out of credits

Then run a real analysis in the app. The header saying **Measured** rather than
Estimated means everything is working end to end.

## From now on

```bash
git add .
git commit -m "what changed"
git push
```

Vercel deploys every push to `main` automatically. Branches and pull requests
get their own preview URLs. GitHub Actions runs the test suite on every push.

## Retiring Cloudflare

The old Worker keeps running until you remove it:
dash.cloudflare.com → Workers & Pages → delete the `whyfamous` Worker and the
`whyfamous` Pages project.

## Do not use drag-and-drop

Vercel's drag-and-drop upload, like Cloudflare Pages', publishes static files
without running `api/`. That is the exact failure mode where `/api/` returns the
homepage instead of JSON. Deploy from git or the CLI.
