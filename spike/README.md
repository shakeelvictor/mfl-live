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
node spike/verify-playoffs.mjs
```

The second replays the 2025 postseason from `fixtures/` and confirms that
`app/playoffs.js` (seeding on the Week 1–14 all-play record, then the
5 → 3 → 4 → 2 fold) names exactly the franchises MFL scored in Weeks 15,
16 and 17. Also offline.

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

## What the log holds for the estimator replay (2026-09-09)

The Week 1 opener measured the export refreshing on a fixed ~200s cycle
(median gap 213s over 150 minutes, zero 429s). The next question is
whether an **unofficial live estimate** can sit in front of it: MFL's last
official points for a player plus what Sleeper's line has added since,
run through the league's rules, re-anchored every time a new MFL snapshot
lands. So the logger now also writes:

- a `playersMap` row at start and hourly (MFL id -> Sleeper id, position,
  team, name), so the replay needs no network;
- `players` (every player's MFL points) on the first poll and whenever a
  score moved;
- the rostered players' **full** Sleeper lines under `sleeper.lines`
  whenever one of them moved (`sleeper.linesChanged`), hashed on their
  own as `rosteredHash`.

Replaying a day from that answers, offline, how often the estimated delta
would have been wrong, by how much and for which positions, before the
estimate is shown to anyone. Scheduled on this Mac's crontab (dated
entries, `crontab -l`) for the Thu Sep 10 game, the whole of Sun Sep 13
and Mon Sep 14 night; the Mac must be awake (`caffeinate -i` holds off
idle sleep, not a closed lid).

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
| 2. At least as fresh as MFL's page | median gap ≤ **90s** | slower than the incumbent means the app loses to what it replaces |
| 3. Lineup swap seen | a starter set changes mid-run | proves late swaps are caught for free |

Bar 2's threshold is MFL's own published number, not a round one. Three
outcomes, and only the last is fatal:

| median gap | Verdict |
|---|---|
| ≤ 35s | **GO, best case.** GameDay class, ~3x the 90s page, and the fastest MFL experience available on a phone (GameDay is Windows desktop only). |
| 36-90s | **GO.** Ties the incumbent on freshness, wins on UI and on showing all-play records live. |
| > 90s | **STOP.** Slower than the page it replaces. |

An earlier version of this bar sat at 120s, set before MFL's 90s page interval
was known -- it would have printed GO on a result that loses to the status quo.

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

## Spike 3: which feed credits a touchdown first (2026-09-15)

The page leads the touchdown card with ESPN's play text and scores the day
on Sleeper's lines. Whether ESPN's box score would make a faster estimate
than Sleeper is an inference, not a measurement. `spike/log-feeds.mjs`
measures it: for every touchdown in every live game, seconds after the
play's own wall clock (ESPN's play-by-play carries one) until each feed
first showed it: the play-by-play entry, the scoreboard's last play (what
the page reads), ESPN's box score crediting the scorer, Sleeper's line
crediting him, and MFL's six-point jump (rostered players only, polled at
30s). Run it through a game night:

```bash
MFL_UA='imp19716' node spike/log-feeds.mjs --minutes 210 --every 10
```

It appends every sighting to `spike/data/feeds-<stamp>.jsonl` as it
happens, waits for the first live game before `--minutes` starts
counting, stops on its own 25 minutes after the last live game ends, and
prints the table on exit (or `--analyze <file>` later). **It runs on a
GitHub runner so nothing at home has to stay awake**: the `log-feeds`
workflow (`.github/workflows/log-feeds.yml`) starts from the Actions tab
with a duration and a window, or on its own: Thursday at 6:17 PM ET, and
Sunday in three runs, since a job may run six hours and the slate runs
eleven: **early** (1 PM kickoffs) from 11:17 AM, **late** (4:05/4:25)
from 2:17 PM, **night** (8:20) from 6:47 PM, each about two hours ahead of
its kickoffs for GitHub's delay. A run watches only the games kicking off
in its window (`--kickoff-after` / `--kickoff-before`, Eastern, on the day
it started), so the night run does not see the late games end and stop
before the night game; `--minutes` counts from its first live game. Each
hands its file and table back as an artifact. The crons are UTC, one set
per clock season (Sep-Oct daylight, Nov-Jan standard). Not covered: London
and other morning kickoffs, Saturday games, and Monday night.

**Fixed after the first run (Thu Sep 17, DET @ BUF).** GitHub started the
scheduled run two hours late, hence the earlier schedule and the wait for
kickoff. Sleeper's and the box score's first touchdown for a player were
never logged (a player at zero was skipped until he appeared, and then
primed instead of counted); both now count from zero once primed. The
summary paired a credit with the athlete's earliest uncovered play, so the
touchdowns before the late start took the later ones' credits; it now
pairs by count and leaves out plays before the `start` marker. And the
name matcher read "A.St. Brown" as S(pencer) Brown; a name no longer
starts after a period (the app's `nameRe` had the same flaw), and the
summary names each play again from the box score's credited athletes, so
an old file reads right. That night's five measurable touchdowns, in
seconds after the play's wall clock (median): scoreboard last play 52,
box score 62, Sleeper 77 (four; Cook's was lost to the zero bug), MFL
158. On the four where both credited the player, the box and Sleeper
tied twice and the box led by 40s and 50s: leaning ESPN, but four plays
are not enough to call against the 30s bar. Sunday's slate is.
`--dry <espn event id>` reads a finished game's summary to check the
parsing and the joins without waiting for a game. ESPN athletes join to
Sleeper through MFL's `espn_id` for the league's rostered players and by
name and team for everyone else (Sleeper's own `espn_id` covers a quarter
of active players).

Reading it: if ESPN's box score sits 30s or more ahead of Sleeper across
the sample, an ESPN-based estimate is worth a week's work (a new join, a
new stat vocabulary, per-game calls, re-verification against MFL). If it
is within 10s, Sleeper stays, since its join covers every rostered player
and the 96.9% agreement was measured on its lines.
