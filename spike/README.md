# Spike 1 — MFL liveScoring cadence

The one question that gates the mfl-live build, and the only one that cannot be
answered out of season: **how often does MFL's live feed actually change while
games are running, and will it serve a 30-second poll without throttling?**

Everything else was verified against real 2025 data before this was written:

- `liveScoring&DETAILS=1` returns MFL's own per-franchise and per-player scores,
  marks starters, and reports `playersYetToPlay` — one 22KB unauthenticated call
  supplies the entire leaderboard, with zero scoring drift.
- MFL → Sleeper player IDs join at **100%** on `rotowire_id` (228/228 rostered).
- Recomputing scores from Sleeper instead gave **4 of 11 franchises the wrong
  all-play record** in a single week. That path is closed; MFL's numbers are the
  numbers.

So this spike measures cadence and nothing else.

## Before the season

```bash
node spike/verify-canonical.mjs
```

Offline, no network. Proves change detection works — which the live dry run
below **cannot** do, because a completed week never changes.

## Dry run (any time)

```bash
MFL_UA='<your registered user-agent>' node spike/log-cadence.mjs --season 2025 --week 12 --interval 5 --minutes 1
```

Proves fetch, parse, and write work. It will report INCONCLUSIVE — that is the
correct result against a finished week.

## The real runs

`MFL_UA` must be the **exact** string registered with MFL, byte for byte.
Registration is per-User-Agent; a mismatch silently measures the unregistered
rate limit, which is the wrong ceiling. There is no default — the script refuses
to start without it.

Registered as of Aug 2026: **`imp19716`** (client "MFL Client 1", validated thru
**Aug 14, 2027** — covers all of the 2026 season, lapses before 2027). Source of
truth is the MFL API Client page, not this file:
<https://www41.myfantasyleague.com/2026/csetup?C=APICLI>

MFL's registration field rejects `/`, so the conventional `product/version` form
is unavailable — hence the bare token.

Expiry fails *silently* by demoting you to unregistered limits rather than
erroring, so re-validate before the 2027 season rather than debugging it live.

**Rehearsal — Wed Sep 9, 7:20 PM CT** (Week 1 opener, one game):

```bash
MFL_UA='...' node spike/log-cadence.mjs --minutes 45
```

Low stakes. Confirms the UA is accepted under real conditions and that the
logger survives a live feed, four days before the window that matters.

**The measurement — Sun Sep 13, 12:00 PM CT** (8 simultaneous games):

```bash
MFL_UA='...' node spike/log-cadence.mjs --minutes 120
```

Noon Sunday is chosen deliberately: maximum concurrent games means maximum stat
velocity, which is when cadence and rate limits are both under real load.

Then:

```bash
node spike/analyze.mjs spike/data/<newest>.jsonl
```

## The side question it also answers

Every player in `liveScoring` carries an `updatedStats` field. It is an empty
string on every completed week, and whether it holds anything **during** games
is untestable out of season.

It decides where live stat lines can come from:

- **Populated** -> official stat lines ride the same response as the points.
  No second provider on the live path, and no skew between two feeds.
- **Empty** -> the only source is Sleeper, whose stat line will disagree with
  MFL's points for a minute or two after every scoring play, because two feeds
  update independently. That is visible to the user on exactly the plays they
  are watching.

The logger records `updatedStatsPlayers` on every poll and shouts the first
time it is ever non-zero; `analyze.mjs` reports which way it went. Capturing it
is free -- same poll, same bytes -- so the rehearsal settles it either way.

## Reading the result

| Bar | Passes when | Why it matters |
|---|---|---|
| 1. No throttling | zero 429s across the run | 30s polling is the design assumption |
| 2. Change ≤ ~2 min | median gap between content changes ≤ 120s | MFL is upstream, so this is the floor on app freshness |
| 3. Lineup swap seen | a starter set changes mid-run | proves late swaps are caught for free |

Bar 3 is *not observed* rather than *failed* if nobody swapped a starter — it
needs someone to actually make a change.

**If bar 2 fails**, the "faster than MFL" premise is dead: you poll the same MFL
that renders MFL's page, so you can never be fresher than it. The question then
becomes whether the live all-play leaderboard alone still justifies the build.
That is a real decision, not automatically a no.

## Notes

- The spike window is unrepeatable — there is one Week 1 Sunday. Nothing here
  throws; every failure is recorded as an observation and the loop continues.
- Output is append-only JSONL flushed every poll. Kill it at any point and what
  was collected stays valid.
- On a 429 the logger backs off one interval rather than leaning harder on MFL,
  and records that it did so.
- Sleeper is sampled at MFL's own rate (`--sleeper-every 1`) so the freshness
  comparison is honest; see below. It is not a scoring source. Disable with
  `--no-sleeper`.
- `canonical()` is separate and tested because MFL's JSON key order is **not
  stable between calls**. Hashing the raw body would report a change on every
  poll — a false pass that would look exactly like success.

## Does it feel as live as Sleeper / Yahoo / ESPN?

That is the real bar, and the run answers it directly. Two things are being
measured, and they are not the same:

**Data freshness** is capped by MFL's *data*, which is not the same thing as
MFL's *page*. MFL publishes both numbers on its GameDay page:

> "MyFantasyLeague.com Game Day updates every 30-35 seconds, whereas standard
> MyFantasyLeague.com live scoring refreshes every 90 seconds."

So the underlying feed sustains ~30s; the standard live-scoring page -- the
one this project exists to replace -- throttles itself to 90s. Polling the API
at 30s can therefore be up to **3x fresher than the page the league uses
today**. What it cannot beat is the feed underneath.

MFL also does not own that feed. Its own marketing says it "partners with" data
companies, and the give-away is in the players export: `stats_global_id` is the
only identifier present for all 2,779 players (100%), while `cbs_id`,
`rotowire_id` and `espn_id` sit at 83-87%. Universal coverage is the signature
of a primary key from the source system; the partial ones are mappings layered
on top. MFL licenses, like everyone else in this market.

**Perceived liveness** is a UI property and is entirely yours: the number
changing without a refresh, a tick or flash when it does, a rank actually
swapping places. None of that depends on the upstream interval.

The incumbent is therefore MFL's own 90-second page, not Sleeper. The league
already uses it and already tolerates its freshness, so matching it is a floor
the app clears by construction. Sleeper is still worth measuring as the outside
benchmark, but it is not the bar to clear. Sleeper is the benchmark because
it is both fetchable and one of the apps being compared against, and the run
samples both at the same rate for exactly that reason (`--sleeper-every 1`,
the default). Sampling Sleeper less often floors its measured cadence at the
sampling interval and flatters MFL; `analyze.mjs` refuses to render the
comparison if the rates were unequal, or if neither feed actually moved.

Rough reading of the ratio, once there is real movement:

| MFL vs Sleeper interval | What it means |
|---|---|
| ~1x | Same class. Feel is a UI problem, and a solvable one. |
| up to ~1.5x | Fine. A board updating every 45s reads as live with good transitions. |
| > 2x | MFL is the bottleneck. The app would feel slower than what it replaces. |
