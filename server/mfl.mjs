// The one place the app talks to MFL. Used by the Netlify function
// (netlify/functions/mfl.mjs) in production and by dev.mjs locally, so both
// behave identically.
//
// Why a proxy at all: MFL's export API answers browsers only from its own
// origin (Access-Control-Allow-Origin: https://www44.myfantasyleague.com),
// and the registered User-Agent has to be sent byte-identical on every call
// or the request is measured against the unregistered rate limit.
//
// Two MFL habits this guards against (see CLAUDE.md, Traps):
//   - application errors arrive as HTTP 200 with an error body, e.g.
//     {"error":{"$t":"Live scoring not available until the season starts"}};
//     those are surfaced as { ok: false, error } so the page can treat them
//     as a state (pre-season) rather than a failure.
//   - franchise names can carry trailing whitespace and HTML entities.

const SEASON = process.env.MFL_SEASON || '2026';
const LEAGUE = process.env.MFL_LEAGUE || '19716';
// Registered with MFL for this league (see spike/README.md). Not a secret,
// but it must match exactly, so it is settable rather than hardcoded twice.
const UA = process.env.MFL_UA || 'imp19716';

// api.myfantasyleague.com 302s to the season's real host (www44 this year).
// Follow it rather than pinning a host: MFL moves leagues between seasons.
const MFL = `https://api.myfantasyleague.com/${SEASON}/export`;

// What the page may ask for, and how long each answer may be cached.
// What the page may ask for, and how long each answer is held. The proxy
// keeps these in memory (see the cache below), so N open pages cost ONE MFL
// call per window per type, not N. liveScoring is the only thing that moves
// fast; everything else is measured in minutes or hours.
const TYPES = {
  league:        { params: [], maxAge: 900 },
  rosters:       { params: [], maxAge: 600 },
  players:       { params: ['PLAYERS', 'DETAILS'], maxAge: 3600 },
  liveScoring:   { params: ['W', 'DETAILS'], maxAge: 15 },
  weeklyResults: { params: ['W'], maxAge: 300 },   // lineups (status: starter) exist before liveScoring does
  nflSchedule:   { params: ['W'], maxAge: 300, noLeague: true },
  playersMap:    { params: ['PLAYERS'], maxAge: 3600 },   // built here, see below
};

// MFL asks clients to cache and back off, not retry. A 429 puts the whole
// proxy on hold for this long; stale answers are served meanwhile.
const BACKOFF_MS = 5 * 60e3;
let backoffUntil = 0;

export const toArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

export const unescapeHtml = (s) => String(s ?? '')
  .replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

async function mfl(type, params = {}, { noLeague = false } = {}) {
  const url = new URL(MFL);
  url.searchParams.set('TYPE', type);
  url.searchParams.set('JSON', '1');
  if (!noLeague) url.searchParams.set('L', LEAGUE);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA } });
  if (res.status === 429) {
    backoffUntil = Date.now() + BACKOFF_MS;
    throw new Error(`MFL ${type}: HTTP 429, backing off ${BACKOFF_MS / 60e3} minutes`);
  }
  if (!res.ok) throw new Error(`MFL ${type}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) return { error: body.error.$t || JSON.stringify(body.error) };
  return { data: body };
}

/* ---------------- players map ----------------
   Every rostered player, resolved to what the page needs: a display name,
   position, NFL team, and the Sleeper id for the headshot. The Sleeper join
   is on rotowire_id (100% of rostered players, verified). Sleeper's player
   list is ~5MB, so it is fetched at most once an hour per warm instance and
   never sent to the browser. */

let sleeperCache = { at: 0, byRotowire: null };

async function sleeperByRotowire() {
  if (sleeperCache.byRotowire && Date.now() - sleeperCache.at < 3600e3) return sleeperCache.byRotowire;
  const res = await fetch('https://api.sleeper.app/v1/players/nfl', { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Sleeper players: HTTP ${res.status}`);
  const all = await res.json();
  const byRotowire = new Map();
  for (const [sid, p] of Object.entries(all)) if (p.rotowire_id != null) byRotowire.set(String(p.rotowire_id), sid);
  sleeperCache = { at: Date.now(), byRotowire };
  return byRotowire;
}

const nm = (s) => { const [l, f] = String(s ?? '').split(',').map((x) => x.trim()); return f ? `${f} ${l}` : l; };

async function playersMap(params = {}) {
  let ids;
  if (params.PLAYERS) {
    ids = [...new Set(String(params.PLAYERS).split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)))];
  } else {
    const r = await mfl('rosters');
    if (r.error) return r;
    ids = [...new Set(toArray(r.data?.rosters?.franchise).flatMap((f) => toArray(f.player).map((p) => p.id)))];
  }
  const byRotowire = await sleeperByRotowire();
  const map = {};
  for (let i = 0; i < ids.length; i += 250) {
    const chunk = await mfl('players', { PLAYERS: ids.slice(i, i + 250).join(','), DETAILS: '1' });
    if (chunk.error) return chunk;
    for (const p of toArray(chunk.data?.players?.player)) {
      map[p.id] = {
        n: nm(p.name), pos: p.position, tm: p.team,
        sid: (p.rotowire_id && byRotowire.get(String(p.rotowire_id))) || null,
      };
    }
  }
  return { data: { players: map, count: ids.length } };
}

/* ---------------- request handler ---------------- */

const json = (status, body, maxAge = 0, extra = {}) => ({
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    ...extra,
  },
  body: JSON.stringify(body),
});

/* ---------------- response cache ----------------
   One entry per (type, params). A fresh entry is served without touching
   MFL; identical requests that arrive while one is in flight share it; and
   when MFL is unreachable or has asked us to back off, the stale entry is
   served rather than nothing. Per process: on Netlify that is per warm
   function instance, which is what we want. */

const cache = new Map();     // key -> { at, maxAge, res }
const inflight = new Map();  // key -> Promise<res>

const withHeader = (res, k, v) => ({ ...res, headers: { ...res.headers, [k]: v } });

export function cacheStats() {
  return { entries: cache.size, inflight: inflight.size, backoffFor: Math.max(0, backoffUntil - Date.now()) };
}

/**
 * query: { type, W?, PLAYERS?, DETAILS? }  ->  { status, headers, body }
 * Always JSON: { ok: true, type, data } or { ok: false, type, error }.
 */
export async function handleMfl(query) {
  const type = String(query.type || '');
  const spec = TYPES[type];
  if (!spec) return json(400, { ok: false, error: `unknown type "${type}"` });

  const params = {};
  for (const k of spec.params) if (query[k] != null) params[k] = String(query[k]);

  const key = type + ' ' + JSON.stringify(params);
  const hit = cache.get(key);
  const ageS = hit ? (Date.now() - hit.at) / 1000 : Infinity;
  if (hit && ageS < hit.maxAge) return withHeader(withHeader(hit.res, 'X-Cache', 'hit'), 'Age', String(Math.floor(ageS)));
  if (Date.now() < backoffUntil) {
    const wait = Math.ceil((backoffUntil - Date.now()) / 1000);
    if (hit) return withHeader(hit.res, 'X-Cache', 'stale-backoff');
    return json(503, { ok: false, type, error: `MFL asked us to back off; retry in ${wait}s` }, 0, { 'Retry-After': String(wait) });
  }
  if (inflight.has(key)) return inflight.get(key).then((r) => withHeader(r, 'X-Cache', 'coalesced'));

  const p = fetchFresh(type, spec, params).then((res) => {
    if (res.status === 200) cache.set(key, { at: Date.now(), maxAge: cacheAgeOf(res, spec), res });
    else if (hit) return withHeader(hit.res, 'X-Cache', 'stale-error');
    return res;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p.then((r) => (r.headers['X-Cache'] ? r : withHeader(r, 'X-Cache', 'miss')));
}

// Error-state answers ("not available until the season starts") are held
// for at most a minute so the flip to live is noticed promptly.
const cacheAgeOf = (res, spec) => (JSON.parse(res.body).ok ? spec.maxAge : Math.min(spec.maxAge, 60));

async function fetchFresh(type, spec, params) {

  // Dev only: MFL_FAKE_LIVE=<path to a liveScoring JSON> serves that file as
  // the live feed, so the live path can be exercised before the season
  // (e.g. spike/fixtures/liveScoring-2025-w12.json). Never set in production.
  if (type === 'liveScoring' && process.env.MFL_FAKE_LIVE) {
    const fs = await import('node:fs');
    const body = JSON.parse(fs.readFileSync(process.env.MFL_FAKE_LIVE, 'utf8'));
    return json(200, { ok: true, type, season: SEASON, league: LEAGUE, fake: process.env.MFL_FAKE_LIVE, data: body });
  }

  try {
    const r = type === 'playersMap' ? await playersMap(params) : await mfl(type, params, { noLeague: spec.noLeague });
    if (r.error) return json(200, { ok: false, type, error: r.error }, Math.min(spec.maxAge, 60));

    // Trim names at the boundary, once, so nothing downstream has to.
    if (type === 'league') {
      for (const f of toArray(r.data?.league?.franchises?.franchise)) f.name = unescapeHtml(f.name);
    }
    return json(200, { ok: true, type, season: SEASON, league: LEAGUE, data: r.data }, spec.maxAge);
  } catch (err) {
    return json(502, { ok: false, type, error: String(err?.message || err) });
  }
}
