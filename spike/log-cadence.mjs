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
import { canonical } from './canonical.mjs';

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
const SLEEPER_EVERY = Number(arg('sleeper-every', 3)); // poll Sleeper 1-in-N
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
  return {
    status: res.status,
    hash: crypto.createHash('sha1').update(rows.sort().join(',')).digest('hex').slice(0, 12),
    scoringPlayers: rows.length,
  };
}

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
      };

      const flag = changed ? 'CHANGED' : '       ';
      const sw = startersChanged ? '  LINEUP-CHANGE' : '';
      console.log(
        `${at}  200  ${String(r.ms).padStart(4)}ms  ${flag}  ` +
          `playing=${c.currentlyPlaying} yetToPlay=${c.yetToPlay}${sw}`,
      );

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
      const s = await fetchSleeperHash();
      if (s) row.sleeper = s;
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
