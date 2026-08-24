// netlify/functions/_utils.js
// Shared security helpers used by track.js, stats.js, and chat.js.
// Centralising this means one place to tighten security, not three.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

// ── ORIGIN ALLOWLIST ─────────────────────────────────────────────
// Set ALLOWED_ORIGINS in Netlify env vars as a comma-separated list,
// e.g. "https://aroop.netlify.app,https://www.aroop.dev"
// Defaults to the known production origin if unset.
function allowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || 'https://aroop.netlify.app';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// Returns CORS headers that only permit the request's Origin if it's on
// the allowlist. Cross-origin requests from anywhere else get no
// Access-Control-Allow-Origin header, so browsers block the response —
// this stops other sites from riding on your Anthropic API budget or
// injecting fake analytics events.
function corsHeaders(event, extraAllowedHeaders) {
  const origin = event.headers.origin || event.headers.Origin;
  const allowed = allowedOrigins();
  const headers = {
    'Content-Type': 'application/json',
    'Vary': 'Origin'
  };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else if (!origin) {
    // Same-origin requests, curl, server-to-server, etc. have no Origin
    // header — allow those through (the browser only sends Origin for
    // cross-site fetches, so this branch never weakens browser-side CORS).
    headers['Access-Control-Allow-Origin'] = allowed[0];
  }
  headers['Access-Control-Allow-Headers'] = 'Content-Type' + (extraAllowedHeaders ? ', ' + extraAllowedHeaders : '');
  headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  return headers;
}

function jsonResponse(event, status, body, extraAllowedHeaders) {
  return {
    statusCode: status,
    headers: corsHeaders(event, extraAllowedHeaders),
    body: JSON.stringify(body)
  };
}

// ── CLIENT IP ─────────────────────────────────────────────────────
// Only trust Netlify's own header, never a client-suppliable one.
function clientIp(event) {
  return event.headers['x-nf-client-connection-ip'] || 'unknown';
}

// ── TIMING-SAFE STRING COMPARE ───────────────────────────────────
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still run a comparison of equal length to avoid leaking length via timing.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── FIXED-WINDOW RATE LIMITER (Netlify Blobs backed) ─────────────
// Returns { limited: bool, remaining: number }. Fails open (allows the
// request) if the blob store has a transient error, so a storage hiccup
// never takes your whole site down.
async function rateLimit(bucket, key, limit, windowSeconds) {
  try {
    const store = getStore(bucket);
    const windowId = Math.floor(Date.now() / 1000 / windowSeconds);
    const blobKey = `${key}:${windowId}`;
    const current = parseInt((await store.get(blobKey)) || '0', 10);
    if (current >= limit) {
      return { limited: true, remaining: 0 };
    }
    await store.set(blobKey, String(current + 1));
    return { limited: false, remaining: limit - current - 1 };
  } catch (err) {
    console.error('rateLimit error (failing open)', err);
    return { limited: false, remaining: limit };
  }
}

module.exports = { corsHeaders, jsonResponse, clientIp, safeEqual, rateLimit, allowedOrigins };
