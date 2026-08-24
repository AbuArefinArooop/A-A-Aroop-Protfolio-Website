# Aroop.netlify.app — Visitor Analytics + AI Chatbot

> **See `AUDIT.md` for the full security audit** — what was found, what was
> fixed automatically, and three things flagged for your manual decision
> (two inconsistent WhatsApp numbers, exposed bank details, and unfilled
> Google Drive cert links).

Everything here is custom-built (no third-party analytics service), runs entirely
on Netlify's own infrastructure, and costs nothing extra on Netlify's free tier
for normal portfolio-level traffic.

## What this gives you

- **`netlify/functions/track.js`** — silently logs every visitor action (session
  start, which sections they open, how long they stay, what they click, chatbot
  use) into Netlify Blobs — a built-in key/value store, no database to set up.
- **`netlify/functions/stats.js`** — reads those logs and returns aggregated
  numbers for the dashboard. Password-protected.
- **`netlify/functions/chat.js`** — powers the on-site AI chatbot via the
  Anthropic API. It knows your actual services/bio, answers visitor questions,
  and quietly logs a "lead" whenever someone shares interest, a name, or email.
- **`dashboard.html`** — a private page (not linked from your site) showing
  sessions over time, a visitor funnel, most-viewed sections, click behavior,
  referrers, device split, captured leads, and auto-generated recommendations.
- **`snippets/tracking-and-chat-widget.html`** — one block to paste into your
  existing `index.html`. It hooks into your *existing* `openP()`/`closeP()`
  functions rather than replacing anything, so your site's behavior is untouched.

## 1. Add the files to your repo

Copy into your site's repo (the one deployed to aroop.netlify.app):
```
netlify.toml                              → repo root (merge if you already have one)
package.json                              → repo root (merge if you already have one)
index.html                                → repo root (REPLACES your current index.html — it's your
                                             original file with the dead Privacy Policy link fixed and
                                             the tracking + chatbot widget already merged in at the bottom)
privacy-policy.html                       → repo root, served at /privacy-policy.html
netlify/functions/_utils.js
netlify/functions/track.js
netlify/functions/stats.js
netlify/functions/chat.js
dashboard.html                            → repo root, so it's served at /dashboard.html
vendor/chart.umd.min.js                   → repo root /vendor/ folder (self-hosted chart library, no CDN)
```

This `index.html` already has everything wired in — you don't need to
manually paste the snippet from `snippets/` (that folder is left in for
reference/diffing, but isn't needed if you use this `index.html` directly).

## 2. Install dependencies & push

```bash
npm install
git add .
git commit -m "Add visitor analytics + AI chatbot + security hardening"
git push
```
Netlify will detect the new functions on the next deploy automatically.

## 3. Set environment variables in Netlify

Netlify dashboard → your site → **Site configuration → Environment variables** → add:

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic API key |
| `DASHBOARD_PASSWORD` | a password only you know |
| `ALLOWED_ORIGINS` | `https://aroop.netlify.app` (add more, comma-separated, if you use a custom domain too — e.g. `https://aroop.netlify.app,https://yourdomain.com`) |

Redeploy after adding these (env vars only apply to new deploys).

## 4. Enable Netlify Blobs

Netlify Blobs is enabled automatically for sites with the Functions API — no
extra setup needed on a standard Netlify site created after 2024. If `stats.js`
or `track.js` errors on first deploy, go to **Site configuration → Environment
variables** and confirm nothing is overriding blob context, or check
**Site configuration → Build & deploy → Blobs** is listed as available.

## 5. View your dashboard

Visit `https://aroop.netlify.app/dashboard.html`, enter the password you set,
and you'll see live data start appearing as soon as visitors interact with the
site. It's not linked anywhere on the public site, and `robots.txt`/`noindex`
keeps it out of search engines — but treat the URL itself as semi-private
(anyone with the link still needs the password).

## Cost & limits to know

- **Netlify Blobs**: generous free tier, effectively free at portfolio-site
  traffic levels.
- **Anthropic API**: the chatbot uses `claude-sonnet-5` by default. At light
  traffic (a few conversations a day) this costs cents per month. If you want
  it even cheaper, open `netlify/functions/chat.js` and change:
  ```js
  const MODEL = 'claude-sonnet-5';
  ```
  to:
  ```js
  const MODEL = 'claude-haiku-4-5-20251001';
  ```
  Haiku is faster and cheaper; Sonnet gives more nuanced answers to technical
  visitor questions. Either is fine for a portfolio chatbot.

## What "success" looks like on this dashboard

- **Funnel** tells you where visitors drop off (e.g. lots of visits, few clicks
  into any section → your splash screen or hint text isn't inviting enough).
- **Most-viewed sections + avg. time** tells you what people actually care
  about — double down on that content, add stronger CTAs there.
- **Leads** panel is your actual pipeline — check it regularly and follow up
  fast; a chatbot lead that goes cold after 48 hours is a lost project.
- **Recommendations** panel updates automatically as data comes in — it's
  simple rule-based logic in `dashboard.html` (search for `// Insights`), so
  feel free to tune the thresholds to match your own read on the numbers.

## Extending later

- Want email alerts when a new lead comes in? Add a call to a transactional
  email API (Resend, SendGrid) inside `chat.js` right after `logEvent('chat_lead', ...)`.
  Ask me and I can wire that up.
- Want the chatbot to also live-check your calendar for booking calls? That
  would need a calendar MCP/API connected — happy to build that next once
  this baseline is live and you're seeing real traffic.
