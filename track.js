// netlify/functions/track.js
// Ingests one visitor event and appends it to a per-day blob log.
// No external database required — uses Netlify Blobs (built into your site).
//
// Security notes (see AUDIT.md for the full list):
// - Origin-restricted CORS (only your site can POST events).
// - Per-IP rate limit to stop event-flooding / storage-cost abuse.
// - Body size cap to stop oversized payloads bloating storage.

const { getStore } = require('@netlify/blobs');
const { jsonResponse, clientIp, rateLimit } = require('./_utils');

const ALLOWED_TYPES = new Set([
  'session_start',
  'node_open',
  'node_dwell',
  'cta_click',
  'theme_toggle',
  'session_heartbeat',
  'chat_message',
  'chat_lead'
]);

const MAX_BODY_BYTES = 8 * 1024; // 8KB is generous for these small event payloads

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(event, 200, { ok: true });
  if (event.httpMethod !== 'POST') return jsonResponse(event, 405, { error: 'Method not allowed' });

  if ((event.body || '').length > MAX_BODY_BYTES) {
    return jsonResponse(event, 413, { error: 'Payload too large' });
  }

  const ip = clientIp(event);
  const rl = await rateLimit('rate-limits', `track:${ip}`, 120, 600); // 120 events / 10 min / IP
  if (rl.limited) {
    return jsonResponse(event, 429, { error: 'Too many requests, slow down' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(event, 400, { error: 'Invalid JSON' });
  }

  const { type, sessionId, data } = payload;
  if (!type || !ALLOWED_TYPES.has(type)) {
    return jsonResponse(event, 400, { error: 'Missing or invalid type' });
  }
  if (typeof sessionId !== 'string' || sessionId.length < 6 || sessionId.length > 128) {
    return jsonResponse(event, 400, { error: 'Missing or invalid sessionId' });
  }
  if (payload.referrer && (typeof payload.referrer !== 'string' || payload.referrer.length > 500)) {
    return jsonResponse(event, 400, { error: 'Invalid referrer' });
  }

  const store = getStore('analytics-events');
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD, one blob per day
  const blobKey = `events/${dayKey}.jsonl`;

  const record = {
    type,
    sessionId,
    ts: now.toISOString(),
    ip,
    country: event.headers['x-nf-geo-country'] || null,
    referrer: payload.referrer || null,
    userAgent: (event.headers['user-agent'] || '').slice(0, 300),
    // Cap data to a small serialized size so one event can't dump huge junk in.
    data: JSON.stringify(data || {}).length <= 2000 ? (data || {}) : {}
  };

  // Append-only log: read existing text (if any) and add a new line.
  const existing = (await store.get(blobKey)) || '';
  const updated = existing + JSON.stringify(record) + '\n';
  await store.set(blobKey, updated);

  return jsonResponse(event, 200, { ok: true });
};
