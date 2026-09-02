// Reads a cadence log and answers the three questions the spike exists to ask.
//
// Raw JSONL is useless on a Sunday evening when you want a go/no-go, so this
// prints the bars explicitly and states which ones cleared.
//
//   Usage: node spike/analyze.mjs spike/data/cadence-....jsonl

import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node spike/analyze.mjs <cadence-log.jsonl>');
  process.exit(1);
}

const rows = fs
  .readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

if (rows.length === 0) {
  console.error('empty log');
  process.exit(1);
}

// status 200 alone is not success — MFL returns errors with a 200 (see below).
const ok = rows.filter((r) => r.status === 200 && r.event !== 'mfl-error');
const throttled = rows.filter((r) => r.status === 429);
const errored = rows.filter(
  (r) => r.event === 'exception' || r.event === 'http-error' || r.event === 'mfl-error',
);
// MFL reports application errors as HTTP 200 with an error body. These are the
// most informative failures in the log — surface the message rather than
// letting them disappear into an error count.
const mflErrors = rows.filter((r) => r.event === 'mfl-error');

// "Live" = MFL says players are on the field. Cadence measured outside this
// window is meaningless: a feed that does not change between games is correct,
// not slow, and including those polls would understate the real refresh rate.
const live = ok.filter((r) => (r.currentlyPlaying || 0) > 0);

const t = (r) => new Date(r.at).getTime();
const span = (a) => (a.length < 2 ? 0 : (t(a[a.length - 1]) - t(a[0])) / 60000);

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

// Gaps between successive CONTENT changes, within the live window.
const changeTimes = live.filter((r) => r.changed).map(t);
const gaps = [];
for (let i = 1; i < changeTimes.length; i++) {
  gaps.push((changeTimes[i] - changeTimes[i - 1]) / 1000);
}

const lineupChanges = ok.filter((r) => r.startersChanged);
const latencies = ok.map((r) => r.ms).filter(Number.isFinite);

const fmt = (n, d = 1) => (n == null ? 'n/a' : Number(n).toFixed(d));
// Seconds get their unit inside the formatter so a missing value reads "n/a"
// rather than "n/as".
const secs = (n) => (n == null ? 'n/a' : `${Number(n).toFixed(1)}s`);
const msec = (n) => (n == null ? 'n/a' : `${Math.round(Number(n))}ms`);

console.log(`
MFL liveScoring cadence — ${file}
${'='.repeat(64)}

RUN
  polls                ${rows.length}   over ${fmt(span(rows))} min
  successful (200)     ${ok.length}
  throttled (429)      ${throttled.length}
  errors               ${errored.length}${mflErrors.length ? `   (${mflErrors.length} refused by MFL with HTTP 200)` : ''}
  response time        p50 ${msec(pct(latencies, 50))}   p95 ${msec(pct(latencies, 95))}${
    mflErrors.length
      ? `\n\n  MFL said:\n${[...new Set(mflErrors.map((r) => r.error))].map((m) => `    "${m}"`).join('\n')}`
      : ''
  }

LIVE WINDOW  (polls where MFL reports players on the field)
  live polls           ${live.length}   over ${fmt(span(live))} min
  polls showing change ${live.filter((r) => r.changed).length}  (${fmt((live.filter((r) => r.changed).length / (live.length || 1)) * 100)}% of live polls)
  distinct changes     ${changeTimes.length}

  time between changes
    median             ${secs(pct(gaps, 50))}
    p90                ${secs(pct(gaps, 90))}
    max                ${secs(gaps.length ? Math.max(...gaps) : null)}

  lineup changes seen  ${lineupChanges.length}
`);

// ---------------------------------------------------------------------------
// The three bars
// ---------------------------------------------------------------------------

const bar1 = throttled.length === 0 && ok.length > 0;
const median = pct(gaps, 50);
const bar2 = median != null && median <= 120;
const bar3 = lineupChanges.length > 0;

const mark = (b) => (b ? 'PASS' : 'FAIL');

// Whether MFL populates `updatedStats` during live games decides where stat
// lines can come from at all -- the same response as the points, or a second
// provider with a timing skew against them. See log-cadence.mjs.
const withStats = ok.filter((r) => (r.updatedStatsPlayers || 0) > 0);
if (live.length > 0) {
  console.log(`UPDATEDSTATS  (can official stat lines come from this feed?)`);
  if (withStats.length) {
    const peak = Math.max(...withStats.map((r) => r.updatedStatsPlayers));
    const sample = withStats.find((r) => r.updatedStatsSamples)?.updatedStatsSamples;
    console.log(`  POPULATED on ${withStats.length}/${live.length} live polls, peak ${peak} players`);
    if (sample) console.log(`  sample: ${JSON.stringify(sample)}`);
    console.log(`  -> official stat lines may come from liveScoring itself.\n`);
  } else {
    console.log(`  empty on all ${live.length} live polls`);
    console.log(`  -> stat lines would have to come from Sleeper, with a timing`);
    console.log(`     skew against MFL's points after every scoring play.\n`);
  }
}

console.log(`BARS
  1. no throttling at this interval        ${mark(bar1)}   ${throttled.length} x 429`);
console.log(`  2. content changes <= ~2 min (live)      ${mark(bar2)}   median ${secs(median)}`);
console.log(`  3. late lineup swap detected             ${bar3 ? 'PASS' : 'not observed'}   ${lineupChanges.length} seen`);

console.log(`
VERDICT`);

if (mflErrors.length === rows.length && rows.length > 0) {
  const msgs = [...new Set(mflErrors.map((r) => r.error))];
  console.log(`  NO DATA — MFL refused every request:
${msgs.map((m) => `    "${m}"`).join('\n')}
  Nothing was measured. Fix the cause and re-run; this is not a cadence result.`);
} else if (live.length === 0) {
  console.log(`  INCONCLUSIVE — no poll saw players on the field.
  Either no games were live, or this ran against a completed week.
  A dry run proves the harness works; it cannot measure cadence.`);
} else if (!bar1) {
  console.log(`  STOP — MFL throttled ${throttled.length} of ${rows.length} polls at this interval.
  Re-run at a longer interval to find the real ceiling before designing
  around 30s. Confirm the registered User-Agent was sent exactly.`);
} else if (!bar2) {
  console.log(`  PREMISE AT RISK — median ${secs(median)} between changes.
  MFL is your upstream, so this is the floor on how fresh the app can be.
  Above ~2 min, "better than MFL's page" shrinks toward a styling exercise.
  Worth deciding whether the all-play leaderboard alone still justifies it.`);
} else {
  console.log(`  GO — sustained ${fmt(span(rows))} min with no throttling, median ${fmt(median)}s
  between score changes. The cadence premise holds; build the leaderboard.`);
}

if (!bar3 && live.length > 0) {
  console.log(`
  Note: no lineup change was observed. That is expected if nobody swapped a
  starter during the window — it is not a failure, just unproven. Re-check
  during the Sunday 12:00 CT window when late swaps actually happen.`);
}

// ---------------------------------------------------------------------------
// Provider lag (only if Sleeper sampling was on)
// ---------------------------------------------------------------------------

const withSleeper = rows.filter((r) => r.sleeper?.hash);
if (withSleeper.length > 1) {
  let sChanges = 0;
  for (let i = 1; i < withSleeper.length; i++) {
    if (withSleeper[i].sleeper.hash !== withSleeper[i - 1].sleeper.hash) sChanges++;
  }
  const sSpan = span(withSleeper);

  // An unequal sampling rate makes this comparison meaningless in one
  // direction: whichever feed is sampled less often cannot appear to change
  // faster than its own sampling interval.
  const unequal = withSleeper.length < ok.length;

  console.log(`
PROVIDER COMPARISON  (Sleeper sampled ${withSleeper.length}x over ${fmt(sSpan)} min)
  Sleeper content changes  ${sChanges}   (~1 per ${fmt(sSpan / (sChanges || 1))} min)
  MFL content changes      ${changeTimes.length}   (~1 per ${fmt(span(live) / (changeTimes.length || 1))} min)

  If Sleeper changes materially more often than MFL, MFL is the bottleneck
  and no amount of client-side polling makes the app fresher.`);

  if (unequal) {
    console.log(`
  !! Sleeper was sampled ${withSleeper.length}x against MFL's ${ok.length}. Its
     cadence cannot read faster than that sampling interval, so this
     comparison understates Sleeper and flatters MFL. Re-run with
     --sleeper-every 1 before trusting it.`);
  } else if (changeTimes.length === 0 || sChanges === 0) {
    // Guard: with no observed changes the ratio collapses to 0, which would
    // sail past the threshold below and print a confident verdict from no
    // data at all. Same failure shape as the other traps in this repo.
    console.log(`
  Not enough movement to compare (MFL ${changeTimes.length} changes,
  Sleeper ${sChanges}). Needs a live window with real scoring.`);
  } else {
    const mflPer = span(live) / changeTimes.length;
    const slpPer = sSpan / sChanges;
    const ratio = slpPer > 0 ? mflPer / slpPer : Infinity;
    console.log(`
  Sampled at equal rates. MFL changes once per ${fmt(mflPer)} min,
  Sleeper once per ${fmt(slpPer)} min -- MFL is ${fmt(ratio)}x Sleeper's interval.`);
    console.log(ratio <= 1.5
      ? `  -> MFL is in the same freshness class as Sleeper. Matching the feel of
     a Sleeper/Yahoo/ESPN board is then a UI problem, not a data one.`
      : `  -> MFL lags Sleeper materially. You cannot be fresher than your
     upstream, so the app would feel slower than the apps it competes with.`);
  }
}

console.log('');
