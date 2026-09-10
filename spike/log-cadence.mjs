// Spike 1 — measure MFL liveScoring's real in-game cadence and throttle tolerance.
//
// This answers the one question the whole project rests on and that cannot be
// answered out of season: how often does MFL's live feed ACTUALLY change while
// games are running, and will it serve a 30-second poll without throttling?
//
// Everything else about mfl-live has already been verified against real data.
// This has not, and it gates the build. See the evaluation notes for why.
//
// Design constraints, in order of importance:
//
//   1. The measurement window is unrepeatable. There is one Week 1 Sunday. So
//      nothing here throws: every failure is recorded as an observation and the
//      loop continues. A crashed logger at minute 90 loses the spike.
//   2. Results are flushed to disk every poll, append-only. Kill it at any
//      point and the data collected so far is intact and analysable.
//   3. MFL's JSON key order is NOT stable — the same endpoint returns player
//      objects with fields in different orders between calls, and array order
//      is a display setting. Hashing the raw body would report "changed" on
//      every poll. We hash a canonical projection instead (see canonical()).
//
// Usage:
//   MFL_UA='<your registered user-agent>' node spike/log-cadence.mjs
//   MFL_UA='...' node spike/log-cadence.mjs --season 2025 --week 14 --minutes 2
//
// Then: node spike/analyze.mjs spike/data/<file>.jsonl

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonical, toArray } from './canonical.mjs';
import { playersMap } from '../server/mfl.mjs';   // the MFL -> Sleeper join the proxy uses, so the replay needs no network

const LEAGUE = '19716';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const SEASON = arg('season', String(new Date().getFullYear()));
const WEEK = arg('week', null);          // omit -> MFL serves the current week
const INTERVAL = Number(arg('interval', 30)) * 1000;
const MINUTES = Number(arg('minutes', 120));
// Sample Sleeper at the SAME rate as MFL by default. Sampling it less often
// floors its measured cadence at the sampling interval and makes MFL look
// competitive when it may not be -- and "is MFL as fresh as Sleeper" is the
// question that decides whether this app is worth building at all. Sleeper's
// payload is ~500KB, so an equal-rate 2h run downloads ~120MB. That is the
// cost of an honest comparison; raise this only if bandwidth is a problem.
const SLEEPER_EVERY = Number(arg('sleeper-every', 1)); // poll Sleeper 1-in-N
const NO_SLEEPER = has('no-sleeper');

// The registered User-Agent must be sent byte-identical on every request or the
// client registration does not apply and we would measure the UNREGISTERED rate
// limit — i.e. the wrong ceiling. There is deliberately no default: running the
// spike with the wrong UA silently invalidates it.
const UA = process.env.MFL_UA;
if (!UA) {
  console.error(`
MFL_UA is not set.

Set it to the exact User-Agent string you registered with MFL, byte for byte:

  MFL_UA='fflr-live/1.0 (league 19716)' node spike/log-cadence.mjs

Registration is per-User-Agent. A mismatched string measures the unregistered
limit, which is the wrong number and would not be obvious in the output.
`.trim());
  process.exit(1);
}

const OUT_DIR = path.join(import.meta.dirname, 'data');
fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(OUT_DIR, `cadence-${SEASON}${WEEK ? `w${WEEK}` : ''}-${stamp}.jsonl`);

// canonical() lives in ./canonical.mjs so verify-canonical.mjs can test it
// offline against checked-in fixtures. It is the one piece of logic here whose
// failure would silently invalidate the whole measurement.

// Every player in liveScoring carries an `updatedStats` field. It is an empty
// string on every completed week, and whether it holds anything DURING games
// is unknown -- MFL refuses liveScoring out of season, so it cannot be tested
// until kickoff.
//
// This matters well beyond curiosity. If it carries stat deltas, then official
// stat lines come from the SAME response as the points: no second provider on
// the live path, and no timing skew between two feeds. If it stays empty, the
// only source is Sleeper, and a stat line will disagree with the points beside
// it for a minute or two after every scoring play.
//
// Capturing it is free -- same poll, same bytes -- so the rehearsal answers it.
function probeUpdatedStats(ls) {
  let total = 0;
  let populated = 0;
  const samples = [];
  for (const f of toArray(ls?.franchise)) {
    for (const pl of toArray(f?.players?.player)) {
      total++;
      const v = pl.updatedStats;
      if (v !== undefined && v !== null && v !== '') {
        populated++;
        if (samples.length < 3) samples.push({ id: pl.id, updatedStats: v });
      }
    }
  }
  return { total, populated, samples };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchMfl() {
  const url = new URL(`https://api.myfantasyleague.com/${SEASON}/export`);
  url.searchParams.set('TYPE', 'liveScoring');
  url.searchParams.set('L', LEAGUE);
  url.searchParams.set('DETAILS', '1');
  url.searchParams.set('JSON', '1');
  if (WEEK) url.searchParams.set('W', WEEK);

  const t0 = performance.now();
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA },
  });
  const body = await res.text();
  const ms = Math.round(performance.now() - t0);
  return { status: res.status, ms, bytes: body.length, body };
}

// The league's players, MFL id -> { sid, pos, tm, n }, for cutting Sleeper's
// lines to the roster and for the offline replay (2026-09-09: the log now
// carries every poll's per-player MFL points and, whenever they move, the
// rostered players' full Sleeper lines, so an estimator -- MFL's last
// official points plus what Sleeper's line has added since -- can be
// replayed against a real day before it is trusted live). Refreshed hourly
// for waiver moves; written to the log as its own row each time.
let leagueMap = { at: 0, byMfl: null, sids: null };
async function refreshLeagueMap() {
  if (leagueMap.byMfl && Date.now() - leagueMap.at < 3600e3) return leagueMap;
  const pm = await playersMap();
  if (pm.error) throw new Error(`playersMap: ${pm.error}`);
  const byMfl = pm.data.players;
  const sids = new Map();   // sid -> mfl id
  for (const [id, info] of Object.entries(byMfl)) if (info.sid) sids.set(String(info.sid), id);
  leagueMap = { at: Date.now(), byMfl, sids };
  record({ at: new Date().toISOString(), event: 'playersMap', players: byMfl });
  return leagueMap;
}

// Sleeper is polled at a lower cadence purely to measure PROVIDER LAG: when a
// scoring event lands in each feed. It is not a scoring source — that question
// is already settled (recomputing from Sleeper produced wrong all-play records).
async function fetchSleeperHash() {
  const wk = WEEK || (await currentSleeperWeek());
  if (!wk) return null;
  const res = await fetch(
    `https://api.sleeper.app/v1/stats/nfl/regular/${SEASON}/${wk}`,
    { headers: { 'User-Agent': UA } },
  );
  if (!res.ok) return { status: res.status, hash: null };
  const d = await res.json();
  // Hash only fantasy-relevant movement, sorted for stability.
  const rows = [];
  for (const [pid, s] of Object.entries(d)) {
    if (!s || typeof s !== 'object') continue;
    const pts = Number(s.pts_half_ppr ?? s.pts_ppr ?? s.pts_std ?? 0);
    const idp = Number(s.pts_idp ?? 0);
    if (pts || idp) rows.push(`${pid}:${pts}:${idp}`);
  }
  // The league's own players, every key Sleeper gives (not the proxy's cut),
  // hashed on their own so a line is stored only when one of them moved.
  const lines = {};
  const map = leagueMap.sids;
  if (map) for (const [sid, st] of Object.entries(d)) if (map.has(sid) && st && typeof st === 'object') lines[sid] = st;
  const rosteredHash = crypto.createHash('sha1').update(JSON.stringify(Object.keys(lines).sort().map((k) => [k, lines[k]]))).digest('hex').slice(0, 12);
  return {
    status: res.status,
    hash: crypto.createHash('sha1').update(rows.sort().join(',')).digest('hex').slice(0, 12),
    scoringPlayers: rows.length,
    rosteredHash,
    rosteredPlayers: Object.keys(lines).length,
    lines,
  };
}
let prevRosteredHash = null;

let sleeperWeekCache = null;
async function currentSleeperWeek() {
  if (sleeperWeekCache !== null) return sleeperWeekCache;
  try {
    const r = await fetch('https://api.sleeper.app/v1/state/nfl', {
      headers: { 'User-Agent': UA },
    });
    sleeperWeekCache = r.ok ? (await r.json()).week : null;
  } catch {
    sleeperWeekCache = null;
  }
  return sleeperWeekCache;
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let polls = 0;
let changes = 0;
let throttled = 0;
let errors = 0;
let prev = null;
let prevStarter = null;
let sawUpdatedStats = false;
let stopping = false;

function record(row) {
  fs.appendFileSync(OUT, `${JSON.stringify(row)}\n`);
}

process.on('SIGINT', () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log('\n\nstopping — finishing current poll…');
});

console.log(`MFL liveScoring cadence spike
  league    ${LEAGUE}   season ${SEASON}${WEEK ? `  week ${WEEK}` : '  (current week)'}
  interval  ${INTERVAL / 1000}s          duration ${MINUTES}m
  user-agent "${UA}"
  sleeper   ${NO_SLEEPER ? 'off' : `every ${SLEEPER_EVERY} polls`}
  output    ${OUT}

Ctrl-C to stop early; data written so far stays valid.
`);

const deadline = Date.now() + MINUTES * 60 * 1000;

while (Date.now() < deadline && !stopping) {
  const at = new Date().toISOString();
  let row;

  try {
    const r = await fetchMfl();

    if (r.status === 429) {
      // A 429 is a RESULT, not a failure — it is one of the three things this
      // spike exists to detect. Record it, back off one interval so we are not
      // leaning on MFL harder after they have asked us not to, and continue.
      throttled++;
      row = { at, poll: polls, status: 429, ms: r.ms, event: 'throttled' };
      console.log(`${at}  429 THROTTLED  (backing off one interval)`);
      record(row);
      polls++;
      await sleep(INTERVAL);
      continue;
    }

    if (r.status !== 200) {
      errors++;
      row = { at, poll: polls, status: r.status, ms: r.ms, event: 'http-error' };
      console.log(`${at}  HTTP ${r.status}`);
    } else if (JSON.parse(r.body)?.error) {
      // MFL reports application errors as HTTP 200 with an error body, so the
      // status code alone is not enough. Observed in preseason:
      //   {"error":{"$t":"Live scoring not available until the season starts"}}
      // Without this branch that response records as a normal 200 with zero
      // players — indistinguishable from "no games live yet", which would burn
      // the Sunday window chasing the wrong explanation.
      const msg = JSON.parse(r.body).error.$t || JSON.stringify(JSON.parse(r.body).error);
      errors++;
      row = { at, poll: polls, status: 200, ms: r.ms, event: 'mfl-error', error: msg };
      console.log(`${at}  MFL ERROR  ${msg}`);
    } else {
      const parsed = JSON.parse(r.body);
      const c = canonical(parsed?.liveScoring);
      const us = probeUpdatedStats(parsed?.liveScoring);
      const changed = prev !== null && c.scoreHash !== prev;
      const startersChanged = prevStarter !== null && c.starterHash !== prevStarter;
      if (changed) changes++;

      row = {
        at,
        poll: polls,
        status: 200,
        ms: r.ms,
        bytes: r.bytes,
        scoreHash: c.scoreHash,
        starterHash: c.starterHash,
        changed,
        startersChanged,
        currentlyPlaying: c.currentlyPlaying,
        yetToPlay: c.yetToPlay,
        franchises: c.franchiseCount,
        scores: c.byFranchise,
        // Every player's MFL points, for the replay; with the first poll and
        // whenever any score moved (the rows between repeat the last one).
        ...(changed || prev === null ? { players: Object.fromEntries(toArray(parsed.liveScoring?.franchise).flatMap((f) => toArray(f.players?.player).map((p) => [p.id, Number(p.score) || 0]))) } : {}),
        updatedStatsPlayers: us.populated,
        ...(us.populated ? { updatedStatsSamples: us.samples } : {}),
      };

      const flag = changed ? 'CHANGED' : '       ';
      const sw = startersChanged ? '  LINEUP-CHANGE' : '';
      console.log(
        `${at}  200  ${String(r.ms).padStart(4)}ms  ${flag}  ` +
          `playing=${c.currentlyPlaying} yetToPlay=${c.yetToPlay}${sw}`,
      );

      if (us.populated && !sawUpdatedStats) {
        sawUpdatedStats = true;
        console.log(`\n  *** updatedStats IS POPULATED (${us.populated}/${us.total} players) ***`);
        console.log(`  ${JSON.stringify(us.samples)}`);
        console.log('  Official stat lines may be available from this same response.\n');
      }

      prev = c.scoreHash;
      prevStarter = c.starterHash;
    }
  } catch (err) {
    // Network blips, DNS, malformed JSON — all observations, none fatal.
    errors++;
    row = { at, poll: polls, event: 'exception', error: String(err?.message || err) };
    console.log(`${at}  ERROR  ${err?.message || err}`);
  }

  // Sleeper comparison, at a lower cadence.
  if (!NO_SLEEPER && polls % SLEEPER_EVERY === 0) {
    try {
      await refreshLeagueMap().catch((err) => console.log(`${at}  playersMap failed: ${err.message}`));
      const s = await fetchSleeperHash();
      if (s) {
        // The lines ride along only when a rostered player's line moved.
        const moved = s.rosteredHash !== prevRosteredHash;
        prevRosteredHash = s.rosteredHash;
        const { lines, ...rest } = s;
        row.sleeper = moved ? { ...rest, linesChanged: true, lines } : { ...rest, linesChanged: false };
      }
    } catch (err) {
      row.sleeper = { error: String(err?.message || err) };
    }
  }

  record(row);
  polls++;
  if (Date.now() < deadline && !stopping) await sleep(INTERVAL);
}

console.log(`
done.
  polls        ${polls}
  content changes ${changes}
  429s         ${throttled}
  errors       ${errors}
  output       ${OUT}

Now run:  node spike/analyze.mjs ${OUT}
`);
