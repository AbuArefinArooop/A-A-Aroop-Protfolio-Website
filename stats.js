// netlify/functions/stats.js
// Reads recent day-blobs, aggregates them, and returns dashboard JSON.
// Protected by DASHBOARD_PASSWORD (set as a Netlify env var).
//
// Security notes:
// - Password compared with a timing-safe check, not `!==`.
// - Password accepted via header ONLY (never a URL query string, which
//   would otherwise end up in server logs and browser history).
// - Failed attempts are rate-limited per IP to slow brute-forcing.

const { getStore } = require('@netlify/blobs');
const { jsonResponse, clientIp, safeEqual, rateLimit } = require('./_utils');

function lastNDays(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(event, 200, { ok: true }, 'X-Dashboard-Password');
  if (event.httpMethod !== 'GET') return jsonResponse(event, 405, { error: 'Method not allowed' }, 'X-Dashboard-Password');

  if (!process.env.DASHBOARD_PASSWORD) {
    return jsonResponse(event, 500, { error: 'DASHBOARD_PASSWORD env var not set on the server' }, 'X-Dashboard-Password');
  }

  const ip = clientIp(event);
  // Lock out an IP after repeated failed attempts: 8 tries per 15 minutes.
  const attemptRl = await rateLimit('rate-limits', `stats-auth:${ip}`, 8, 900);
  if (attemptRl.limited) {
    return jsonResponse(event, 429, { error: 'Too many attempts. Try again later.' }, 'X-Dashboard-Password');
  }

  const suppliedPw = event.headers['x-dashboard-password'] || '';
  if (!safeEqual(suppliedPw, process.env.DASHBOARD_PASSWORD)) {
    return jsonResponse(event, 401, { error: 'Unauthorized' }, 'X-Dashboard-Password');
  }

  const rangeDays = Math.min(
    parseInt((event.queryStringParameters && event.queryStringParameters.days) || '14', 10) || 14,
    90
  );

  const store = getStore('analytics-events');
  const days = lastNDays(rangeDays);

  let events = [];
  for (const day of days) {
    const text = await store.get(`events/${day}.jsonl`);
    if (!text) continue;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        /* skip malformed line */
      }
    }
  }

  // ── Aggregate ────────────────────────────────────────────────
  const sessions = new Set();
  const sessionsByDay = {};
  const nodeOpens = {};
  const nodeDwellMs = {};
  const ctaClicks = {};
  const referrers = {};
  const countries = {};
  const devices = { mobile: 0, desktop: 0, unknown: 0 };
  const chatSessions = new Set();
  const leads = [];
  const recentSessions = {};

  for (const e of events) {
    sessions.add(e.sessionId);
    const day = e.ts.slice(0, 10);
    sessionsByDay[day] = sessionsByDay[day] || new Set();
    sessionsByDay[day].add(e.sessionId);

    if (!recentSessions[e.sessionId]) {
      recentSessions[e.sessionId] = {
        sessionId: e.sessionId,
        firstSeen: e.ts,
        lastSeen: e.ts,
        path: [],
        referrer: e.referrer || null,
        country: e.country || null,
        device: null
      };
    }
    const rs = recentSessions[e.sessionId];
    rs.lastSeen = e.ts;
    if (e.referrer && !rs.referrer) rs.referrer = e.referrer;
    if (e.country && !rs.country) rs.country = e.country;

    const ua = (e.userAgent || '').toLowerCase();
    const isMobile = /mobi|android|iphone|ipad/.test(ua);
    if (ua) {
      devices[isMobile ? 'mobile' : 'desktop']++;
      rs.device = isMobile ? 'mobile' : 'desktop';
    } else {
      devices.unknown++;
    }

    if (e.referrer) referrers[e.referrer] = (referrers[e.referrer] || 0) + 1;
    if (e.country) countries[e.country] = (countries[e.country] || 0) + 1;

    if (e.type === 'node_open') {
      const id = e.data.nodeId || 'unknown';
      nodeOpens[id] = (nodeOpens[id] || 0) + 1;
      rs.path.push(id);
    }
    if (e.type === 'node_dwell') {
      const id = e.data.nodeId || 'unknown';
      const ms = Number(e.data.ms) || 0;
      nodeDwellMs[id] = (nodeDwellMs[id] || 0) + ms;
    }
    if (e.type === 'cta_click') {
      const id = e.data.ctaType || 'unknown';
      ctaClicks[id] = (ctaClicks[id] || 0) + 1;
      rs.path.push(`click:${id}`);
    }
    if (e.type === 'chat_message') {
      chatSessions.add(e.sessionId);
    }
    if (e.type === 'chat_lead') {
      leads.push({
        sessionId: e.sessionId,
        ts: e.ts,
        name: e.data.name || null,
        email: e.data.email || null,
        interest: e.data.interest || null,
        summary: e.data.summary || null
      });
    }
  }

  const sessionsByDayArr = days
    .slice()
    .reverse()
    .map((d) => ({ day: d, sessions: sessionsByDay[d] ? sessionsByDay[d].size : 0 }));

  const funnel = {
    visited: sessions.size,
    viewedAnySection: new Set(events.filter((e) => e.type === 'node_open').map((e) => e.sessionId)).size,
    clickedContact: new Set(
      events.filter((e) => e.type === 'cta_click' && ['whatsapp', 'email'].includes(e.data.ctaType)).map((e) => e.sessionId)
    ).size,
    chattedWithBot: chatSessions.size,
    becameLead: new Set(leads.map((l) => l.sessionId)).size
  };

  const topSections = Object.entries(nodeOpens)
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({
      id,
      opens: count,
      avgDwellSec: nodeDwellMs[id] ? Math.round(nodeDwellMs[id] / 1000 / count) : null
    }));

  const recentSessionsArr = Object.values(recentSessions)
    .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
    .slice(0, 40);

  return jsonResponse(event, 200, {
    rangeDays,
    totals: {
      sessions: sessions.size,
      events: events.length,
      leads: leads.length,
      chatSessions: chatSessions.size
    },
    sessionsByDay: sessionsByDayArr,
    topSections,
    ctaClicks,
    referrers: Object.entries(referrers).sort((a, b) => b[1] - a[1]).slice(0, 15),
    countries: Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 15),
    devices,
    funnel,
    leads: leads.sort((a, b) => new Date(b.ts) - new Date(a.ts)),
    recentSessions: recentSessionsArr
  }, 'X-Dashboard-Password');
};
