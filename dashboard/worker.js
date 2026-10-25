// Home HQ dashboard API worker. Serves the static SPA (via ASSETS) and a small set of
// guarded JSON endpoints that pull private/third-party data the WebView cannot fetch directly:
//   /api/calendar  — the family Google Calendar (private ICS), parsed + recurring events expanded
//   /api/weather   — Open-Meteo forecast for a fixed location, reshaped to the app's weather model
//   /api/photos    — list of photos in the R2 bucket (empty until the owner uploads some)
//   /api/ha/config — Home Assistant URL + long-lived token, for LAN-only direct calls from the frame
//   /api/config    — feature flags so the client can hide unconfigured sections
//
// Every /api/* route requires the shared dashboard key (?k=... or Authorization: Bearer ...).
// The key lives in the frame's URL, so the static assets stay public but the data stays private.
import ICAL from 'ical.js';

const ALMADA = { lat: 38.679, lon: -9.157 }; // Almada, Portugal

// Portugal public holidays (national; covers Almada/Lisbon). Public calendar, no secret needed.
const PORTUGAL_HOLIDAYS_ICS =
  'https://calendar.google.com/calendar/ical/en-gb.portuguese%23holiday%40group.v.calendar.google.com/public/basic.ics';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function unauthorized() {
  return json({ error: 'unauthorized' }, 401);
}

function authorized(request, env) {
  if (!env.DASHBOARD_KEY) return false;
  const url = new URL(request.url);
  if (url.searchParams.get('k') === env.DASHBOARD_KEY) return true;
  const auth = request.headers.get('authorization') || '';
  return auth === 'Bearer ' + env.DASHBOARD_KEY;
}

// ---------------------------------------------------------------- calendar
function expandEvents(vevents, from, to, extra) {
  const out = [];
  for (const vevent of vevents) {
    let ev;
    try { ev = new ICAL.Event(vevent); } catch (e) { continue; }
    if (ev.status && String(ev.status).toUpperCase() === 'CANCELLED') continue;
    const title = (ev.summary || '').trim() || '(no title)';
    const loc = (ev.location || '').trim();
    const uid = ev.uid || '';
    const startJs = ev.startDate ? ev.startDate.toJSDate() : null;
    if (!startJs) continue;
    const allDay = !!ev.startDate.isDate;
    // Duration: DTEND/DURATION, or a sensible default.
    let durMs = 3600e3;
    if (ev.duration) durMs = ev.duration.toSeconds() * 1000;
    else if (ev.endDate) durMs = ev.endDate.toJSDate() - startJs;
    else if (allDay) durMs = 24 * 3600e3;

    const occurrences = [];
    if (ev.isRecurring()) {
      let it;
      try { it = ev.iterator(); } catch (e) { continue; }
      let next;
      let guard = 0;
      while ((next = it.next()) && guard++ < 2000) {
        const s = next.toJSDate();
        if (s > to) break;
        if (s.getTime() + durMs >= from.getTime()) occurrences.push(s);
      }
    } else {
      if (startJs.getTime() + durMs >= from.getTime() && startJs <= to) occurrences.push(startJs);
    }
    for (const s of occurrences) {
      out.push(Object.assign({ id: uid + '#' + s.getTime(), uid, start: s.toISOString(), end: new Date(s.getTime() + durMs).toISOString(), allDay, title, loc }, extra));
    }
  }
  out.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  return out;
}

// Normalized title for cross-calendar de-duplication: lowercase, diacritics and punctuation
// stripped, so "São João's Party" and "sao joaos party" match.
function normTitle(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

async function calendar(env) {
  if (!env.CALENDAR_ICS_URL) return json({ error: 'not configured' }, 404);
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 864e5);
  const to = new Date(now.getTime() + 90 * 864e5);
  const cache = caches.default;
  const cacheKey = 'https://homehq.local/api/calendar?v=3&t=' + Math.floor(now.getTime() / 600000);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // Family + Sarah's calendar + public holidays, fetched in parallel. A failing secondary
  // source is skipped; the family feed failing fails the endpoint so clients keep their cache.
  const sources = [
    ['family', env.CALENDAR_ICS_URL, null],
    ['sarah', env.SARAH_CALENDAR_ICS_URL, { people: ['sarah'] }],
    ['holiday', PORTUGAL_HOLIDAYS_ICS, { kind: 'holiday', people: '*' }],
  ].filter((s) => s[1]);
  const parsed = await Promise.all(sources.map(async ([name, url, extra]) => {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'HomeHQ/1.0 (+frame dashboard)' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const vevents = new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent');
      return { name, events: expandEvents(vevents, from, to, extra) };
    } catch (e) {
      return { name, events: [], error: String(e.message || e) };
    }
  }));
  const byName = Object.fromEntries(parsed.map((p) => [p.name, p]));
  if (byName.family.error) return json({ error: 'ics fetch failed', detail: byName.family.error }, 502);
  const family = byName.family.events;
  const sarah = byName.sarah ? byName.sarah.events : [];
  const holidays = byName.holiday ? byName.holiday.events : [];

  // De-duplicate: an event in both the family and Sarah's calendars is one event both parents
  // attend — keep the family copy, widen it to everyone (people: '*'), and drop Sarah's copy.
  // Holidays already on a personal calendar are dropped too, so busy days stay uncluttered.
  const events = family.slice();
  const byTitle = new Map();
  const index = (e) => {
    const k = normTitle(e.title);
    if (!k) return;
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k).push(e);
  };
  events.forEach(index);
  let merged = 0, droppedHolidays = 0;
  for (const ev of sarah) {
    const dup = (byTitle.get(normTitle(ev.title)) || []).find((f) => overlaps(f, ev));
    if (dup) { dup.people = '*'; merged++; continue; }
    events.push(ev);
    index(ev);
  }
  for (const ev of holidays) {
    if ((byTitle.get(normTitle(ev.title)) || []).some((f) => overlaps(f, ev))) { droppedHolidays++; continue; }
    events.push(ev);
    index(ev);
  }

  // School events created by the n8n school-emails workflow are titled "[Child] Title".
  // Tag them with the child so the UI colours them per kid instead of as generic family events.
  const CHILD = { xavier: 'xavi', xavi: 'xavi', blaise: 'blaise' };
  for (const ev of events) {
    const m = /^\[(\w+)\]\s*(.*)$/.exec(ev.title);
    if (m && CHILD[m[1].toLowerCase()]) { ev.child = CHILD[m[1].toLowerCase()]; ev.kind = ev.kind || 'school'; }
  }
  events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const resp = json({
    events,
    from: from.toISOString(),
    to: to.toISOString(),
    sources: { family: family.length, sarah: sarah.length, holidays: holidays.length, merged, droppedHolidays },
  });
  resp.headers.set('cache-control', 'public, max-age=600');
  await cache.put(cacheKey, resp.clone());
  return resp;
}

// ---------------------------------------------------------------- weather
function wmo(code) {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3 || code === 45 || code === 48) return 'cloud';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 95) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code === 85 || code === 86) return 'snow';
  return 'cloud';
}

async function weather() {
  const now = new Date();
  const cache = caches.default;
  const cacheKey = 'https://homehq.local/api/weather?v=1&t=' + Math.floor(now.getTime() / 900000);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + ALMADA.lat + '&longitude=' + ALMADA.lon +
    '&hourly=temperature_2m,apparent_temperature,precipitation_probability,weathercode,relative_humidity_2m,wind_speed_10m,is_day' +
    '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=2';
  const res = await fetch(url);
  if (!res.ok) return json({ error: 'weather fetch failed' }, 502);
  const data = await res.json();
  const h = data.hourly;
  const startHour = now.getHours();
  const t = new Array(24).fill(15);
  const c = new Array(24).fill('cloud');
  const p = new Array(24).fill(0);
  for (let i = 0; i < 24 && i < h.time.length; i++) {
    const idx = (startHour + i) % 24;
    t[idx] = Math.round(h.temperature_2m[i]);
    p[idx] = Math.round(h.precipitation_probability[i] || 0);
    const code = h.weathercode[i];
    const cond = wmo(code);
    c[idx] = cond === 'clear' ? (h.is_day[i] ? 'sun' : 'moon') : (cond === 'snow' ? 'cloud' : cond);
  }
  const d = data.daily;
  const cur = 0;
  const out = {
    hi: Math.round(d.temperature_2m_max[0]),
    lo: Math.round(d.temperature_2m_min[0]),
    feels: Math.round(h.apparent_temperature[cur]),
    humidity: Math.round(h.relative_humidity_2m[cur]),
    wind: Math.round(h.wind_speed_10m[cur]),
    t: t, c: c, p: p,
  };
  const resp = json(out);
  resp.headers.set('cache-control', 'public, max-age=900');
  await cache.put(cacheKey, resp.clone());
  return resp;
}

// ---------------------------------------------------------------- photos
async function photos(env) {
  if (!env.PHOTOS) return json({ photos: [] });
  const list = await env.PHOTOS.list({ limit: 200 });
  const photos = list.objects.map(function (o) {
    return { key: o.key, url: '/photos/' + encodeURIComponent(o.key), size: o.size };
  });
  return json({ photos });
}

// ---------------------------------------------------------------- home assistant (LAN-only)
function haConfig(env) {
  if (!env.HA_URL || !env.HA_TOKEN) return json({ configured: false });
  return json({ configured: true, url: env.HA_URL, token: env.HA_TOKEN });
}

function config(env) {
  return json({
    calendar: !!env.CALENDAR_ICS_URL,
    weather: true,
    photos: !!env.PHOTOS,
    ha: !!(env.HA_URL && env.HA_TOKEN),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Photos are served straight from R2 (unauthenticated keys are fine for family photos).
    if (path.startsWith('/photos/') && env.PHOTOS) {
      const key = decodeURIComponent(path.slice('/photos/'.length));
      const obj = await env.PHOTOS.get(key);
      if (!obj) return new Response('not found', { status: 404 });
      return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata && obj.httpMetadata.contentType || 'image/jpeg', 'cache-control': 'public, max-age=86400' } });
    }

    if (path.startsWith('/api/')) {
      if (!authorized(request, env)) return unauthorized();
      if (path === '/api/calendar') return calendar(env);
      if (path === '/api/weather') return weather();
      if (path === '/api/photos') return photos(env);
      if (path === '/api/ha/config') return haConfig(env);
      if (path === '/api/config') return config(env);
      return json({ error: 'not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};