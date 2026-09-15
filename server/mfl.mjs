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
  nflSchedule:   { params: ['W'], maxAge: 15, noLeague: true },   // game scores, possession, red zone: polled with liveScoring while games are on
  playersMap:    { params: ['PLAYERS'], maxAge: 3600 },   // built here, see below
  seasonScores:  { params: [], maxAge: 600 },             // built here: every week's franchise scores, for the playoffs
  stats:         { params: ['W'], maxAge: 30 },           // built here: Sleeper's live stat lines for rostered players; context, and the touchdown confirmation
  situation:     { params: [], maxAge: 15, noLeague: true },  // built here: ESPN's live game situations (possession, red zone, ball spot); context only
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

export async function playersMap(params = {}) {   // exported for spike/log-cadence.mjs (the MFL -> Sleeper join)
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

/* ---------------- season scores ----------------
   Every finished week's franchise scores, for seeding and folding the
   playoffs (app/playoffs.js). MFL's year-to-date weeklyResults carries every
   player of every franchise of every week (a quarter megabyte by December);
   only the franchise totals go down: ~5KB. */

async function seasonScores() {
  const r = await mfl('weeklyResults', { W: 'YTD' });
  if (r.error) return r;
  const weeks = toArray(r.data?.allWeeklyResults?.weeklyResults).map((wk) => ({
    week: Number(wk.week),
    franchise: toArray(wk.franchise).map((f) => ({ id: f.id, score: Number(f.score) || 0 })),
  }));
  return { data: { weeks } };
}

/* ---------------- stat lines ----------------
   Context beside MFL's points, never a score (recomputing points from
   stats is disqualified: see CLAUDE.md). Sleeper's weekly stats are free
   and update during games, but cover every NFL player (~570KB), so they
   are cut down here to the league's rostered players (their Sleeper ids
   come from the same join playersMap uses, remembered for an hour) and to
   the keys a stat line is built from: ~10KB, held a minute. */

const STAT_KEYS = ['pass_cmp', 'pass_att', 'pass_yd', 'pass_td', 'pass_int', 'rush_att', 'rush_yd', 'rush_td',
  'rec', 'rec_tgt', 'rec_yd', 'rec_td', 'fum_lost', 'fum_rec_td', 'fgm', 'fga', 'xpm', 'xpa',
  'pass_2pt', 'rush_2pt', 'rec_2pt', 'fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50_59', 'fgm_50p', 'kr_yd', 'pr_yd',   // every key app/scoring.js reads (2026-09-10)
  'idp_tkl', 'idp_tkl_solo', 'idp_tkl_ast', 'idp_sack', 'idp_int', 'idp_ff', 'idp_fum_rec', 'idp_pass_def', 'idp_tkl_loss',
  'idp_blk_kick', 'idp_safe', 'idp_def_td', 'st_tkl_solo', 'st_ff', 'st_fum_rec', 'st_td', 'kr_td', 'pr_td'];   // special teams counts toward IDP in MFL; every touchdown key confirms a card

let sidCache = { at: 0, sids: null };
async function rosteredSids() {
  if (sidCache.sids && Date.now() - sidCache.at < 3600e3) return sidCache.sids;
  const pm = await playersMap();
  if (pm.error) throw new Error(`stats: ${pm.error}`);
  const sids = new Set(Object.values(pm.data.players).map((p) => p.sid).filter(Boolean));
  sidCache = { at: Date.now(), sids };
  return sids;
}

async function stats(params) {
  const week = String(params.W || '').replace(/\D/g, '');
  if (!week) return { error: 'stats needs W' };
  const sids = await rosteredSids();
  // Five seconds, then give up: a hung Sleeper must never hold a poll. The
  // page keeps its last lines and marks them delayed.
  const res = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${SEASON}/${week}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Sleeper stats: HTTP ${res.status}`);
  const all = await res.json();
  const out = {};
  for (const sid of sids) {
    const src = all[sid];
    if (!src) continue;
    const st = {};
    for (const k of STAT_KEYS) if (src[k]) st[k] = src[k];
    if (Object.keys(st).length) out[sid] = st;
  }
  return { data: { week: Number(week), stats: out } };
}

/* ---------------- game situations (ESPN) ----------------
   MFL's nflSchedule carries hasPossession and inRedZone per team, but on
   the Week 1 opener (2026-09-09) consecutive calls returned different
   snapshots (a team in the red zone at 6 points, then at 7 with the other
   side in possession, both during halftime), so the flags cannot say who
   is in the red zone now. ESPN's public scoreboard carries the live
   situation for every game: who has the ball, the ball spot, down and
   distance and the ball spot, from which the red zone follows (see below).
   Context beside MFL's numbers, never a score: the page reads possession
   and the red zone from here and falls back to MFL's flags without it.
   ~5s timeout; the page keeps its last situation for a while. */

const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
// ESPN abbreviations that differ from MFL's team codes.
const ESPN_TO_MFL = { WSH: 'WAS', JAX: 'JAC', LV: 'LVR', NE: 'NEP', GB: 'GBP', KC: 'KCC', TB: 'TBB', NO: 'NOS', SF: 'SFO' };
const mflCode = (abbr) => ESPN_TO_MFL[abbr] || abbr;

async function situation() {
  const res = await fetch(ESPN_SCOREBOARD, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`ESPN scoreboard: HTTP ${res.status}`);
  const j = await res.json();
  const games = {};
  for (const e of toArray(j.events)) {
    const c = toArray(e.competitions)[0];
    if (!c) continue;
    const sides = toArray(c.competitors).map((x) => ({ espnId: String(x.id), code: mflCode(x.team?.abbreviation), home: x.homeAway === 'home', score: Number(x.score) || 0 }));
    if (sides.length !== 2) continue;
    const st = c.status?.type || {}, sit = c.situation || {};
    const possSide = sit.possession ? sides.find((x) => x.espnId === String(sit.possession)) : null;
    // The red zone from the ball spot, not ESPN's isRedZone: that flag is
    // also up during a kickoff after a score, with nobody in possession
    // (seen 2026-09-09). yardLine is measured from the HOME team's goal
    // line (0 there, 100 at the visitors'; verified the same night: the
    // visitors at the home 32 read 32, the home side at its own 42 read
    // 42), so the home offense is in the red zone at 80 and beyond, the
    // visitors at 20 and under. No possession, no red zone.
    const yl = Number.isFinite(Number(sit.yardLine)) ? Number(sit.yardLine) : null;
    const rz = !possSide ? false : yl != null ? (possSide.home ? yl >= 80 : yl <= 20) : sit.isRedZone === true;
    const g = {
      away: sides.find((x) => !x.home)?.code, home: sides.find((x) => x.home)?.code,
      state: st.state || null,            // pre | in | post
      detail: st.shortDetail || st.detail || null,
      period: c.status?.period ?? null, clock: c.status?.displayClock || null,
      scores: Object.fromEntries(sides.map((x) => [x.code, x.score])),
      poss: possSide?.code || null,
      rz,
      rzFlag: sit.isRedZone === true,   // ESPN's own flag, for reference
      yardLine: sit.yardLine ?? null,     // ESPN's absolute spot, 0-100
      spot: sit.possessionText || null,   // "SEA 24"
      dd: sit.shortDownDistanceText || sit.downDistanceText || null,
      lastPlay: sit.lastPlay?.text?.slice(0, 120) || null,
    };
    for (const x of sides) games[x.code] = g;
  }
  return { data: { at: Date.now(), games } };
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
  // Dev only, likewise: MFL_FAKE_DIR=<dir> serves <type>-w<W>.json or
  // <type>.json from there when the file exists (the body is what `data`
  // would hold), and MFL for everything else. spike/fake-round.mjs writes
  // an in-progress playoff week this way. Never set in production.
  if (process.env.MFL_FAKE_DIR) {
    const fs = await import('node:fs'), path = await import('node:path');
    for (const name of [params.W ? `${type}-w${params.W}.json` : null, `${type}.json`].filter(Boolean)) {
      const file = path.join(process.env.MFL_FAKE_DIR, name);
      if (fs.existsSync(file)) {
        return json(200, { ok: true, type, season: SEASON, league: LEAGUE, fake: file, data: JSON.parse(fs.readFileSync(file, 'utf8')) });
      }
    }
  }

  try {
    const r = type === 'playersMap' ? await playersMap(params)
      : type === 'seasonScores' ? await seasonScores()
      : type === 'stats' ? await stats(params)
      : type === 'situation' ? await situation()
      : await mfl(type, params, { noLeague: spec.noLeague });
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
