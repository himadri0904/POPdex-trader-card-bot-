// api/avatar.js
// Vercel serverless function. Looks up an X (Twitter) profile photo through
// the OFFICIAL X API v2, server-side, so the bearer token never touches the
// browser and never gets rate-limited/blocked the way anonymous scraping is.
//
// SETUP
//   1. Get API access at console.x.com (X API is pay-per-use as of 2026 —
//      there's no free tier for new developer accounts, roughly
//      $0.005-0.01 per call. This function caches results for 12h server-side
//      specifically to keep that cost down).
//   2. Create a Project + App, generate a Bearer Token from it.
//   3. vercel env add X_BEARER_TOKEN        (paste the token when prompted)
//   4. vercel --prod
//
// USAGE (called by public/index.html automatically)
//   GET /api/avatar?handle=someuser
//   -> 200 { ok: true,  url: "https://pbs.twimg.com/profile_images/.../avatar_400x400.jpg" }
//   -> 200 { ok: false, reason: "not_found" | "no_photo" | "rate_limited" | "upstream_error" | "server_not_configured" }
//   -> 400 { ok: false, reason: "invalid_handle" }
//   -> 429 { ok: false, reason: "rate_limited" }   (our own per-IP limit, see below)

const cache = new Map(); // handle -> { url, expires }
const CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12h — photos rarely change; calls cost money

// Best-effort per-IP throttle so one visitor can't burn through your X API
// credits by hammering the endpoint. This resets whenever the function cold-
// starts, so it's a courtesy limit, not a hard guarantee — pair it with
// spend caps in the X developer console for a real ceiling.
const hits = new Map(); // ip -> { count, windowStart }
const RATE_LIMIT = 30;             // requests
const RATE_WINDOW_MS = 60 * 1000;  // per minute, per IP

function isRateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

module.exports = async function handler(req, res) {
  const handle = String(req.query.handle || '').trim().replace(/^@/, '');
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  // X handles are 1-15 chars, letters/digits/underscore only.
  if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return res.status(400).json({ ok: false, reason: 'invalid_handle' });
  }

  if (isRateLimited(ip)) {
    return res.status(429).json({ ok: false, reason: 'rate_limited' });
  }

  const cacheKey = handle.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return res.status(200).json({ ok: true, url: cached.url, cached: true });
  }

  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    return res.status(500).json({ ok: false, reason: 'server_not_configured' });
  }

  try {
    const upstream = await fetch(
      `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=profile_image_url`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (upstream.status === 404) {
      return res.status(200).json({ ok: false, reason: 'not_found' });
    }
    if (upstream.status === 429) {
      return res.status(200).json({ ok: false, reason: 'rate_limited' });
    }
    if (!upstream.ok) {
      return res.status(200).json({ ok: false, reason: 'upstream_error' });
    }

    const data = await upstream.json();
    const rawUrl = data && data.data && data.data.profile_image_url;
    if (!rawUrl) {
      return res.status(200).json({ ok: false, reason: 'no_photo' });
    }

    // X serves a tiny 48x48 "_normal" crop by default — swap it for the
    // full-size original.
    const url = rawUrl.replace('_normal', '_400x400');

    cache.set(cacheKey, { url, expires: Date.now() + CACHE_TTL_MS });

    return res.status(200).json({ ok: true, url });
  } catch (err) {
    return res.status(200).json({ ok: false, reason: 'upstream_error' });
  }
};
