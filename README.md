# PopDEX Trader Card

A holographic, tiltable trading card generated from an X handle.

```
popdex-card/
├── public/
│   └── index.html      the card itself — UI, tilt physics, rarity logic
├── api/
│   └── avatar.js        serverless proxy that calls the official X API
├── package.json
└── README.md
```

## How avatar lookup works

`public/index.html` tries three things, in order, every time you mint a card:

1. **`/api/avatar?handle=...`** — your own backend (below), which calls the
   official X API server-side. Reliable, but only live once you deploy it.
2. **`unavatar.io`** — free, keyless, no setup. But X actively blocks the
   unauthenticated scraping this depends on, so it misses a lot of real
   handles. This is what you were seeing fail before.
3. **An initial** — so the card never hangs, even if both above miss.

If you never deploy the backend, the card still works exactly as it did
before — it just relies on step 2 and 3 only.

## Deploying the backend (step 1)

X's API is pay-per-use as of 2026 — there's no free tier for new developer
accounts, roughly $0.005–0.01 per call. `api/avatar.js` caches each handle's
result for 12 hours server-side specifically to keep that cost down, and
throttles each visitor to 30 lookups/minute so one person can't run up your
bill.

1. **Get API access**: sign in at [console.x.com](https://console.x.com),
   create a Project, then an App inside it, and generate a **Bearer Token**
   for that App. Set a spend cap in the console while you're there — the
   function's rate limit is a courtesy, not a hard ceiling.
2. **Install the Vercel CLI** if you don't have it: `npm i -g vercel`
3. **From this project folder**, run:
   ```
   vercel
   ```
   Follow the prompts (link or create a project). This deploys `public/`
   as static hosting and `api/avatar.js` as a serverless function
   automatically — no extra config needed.
4. **Add your token as an environment variable**:
   ```
   vercel env add X_BEARER_TOKEN
   ```
   Paste the bearer token when prompted. Choose Production (and Preview if
   you want it working on preview deploys too).
5. **Redeploy so the env var takes effect**:
   ```
   vercel --prod
   ```

That's it — visiting your deployed URL now tries the official API first for
every handle.

## Local development

```
npm i -g vercel   # if not already installed
vercel dev
```

This runs both the static site and the `/api/avatar` function locally, so
you can test with your own `X_BEARER_TOKEN` in a local `.env` file before
deploying.

## Notes

- `api/avatar.js` validates the handle shape (1–15 chars, letters/digits/
  underscore) before calling out, so it can't be used to probe arbitrary
  input.
- The in-memory cache and rate limiter reset whenever the serverless
  function cold-starts — fine for a side project, but if this needs to
  survive traffic spikes or multiple regions, swap the `Map()`s for Redis
  (Vercel KV works well) instead.
