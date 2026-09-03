# MFL Live

A live **all-play leaderboard** for the INDOMEXPAK fantasy football league
(MyFantasyLeague league `19716`).

In an all-play league, every franchise plays every other franchise every week:
finish 1st of 11 and you go 10-0, finish 6th and you go 5-5. That makes the
week a single ranked list, and it makes the **point gap between adjacent
ranks** worth a full win or loss. MFL's own live-scoring page refreshes every
90 seconds and is built around head-to-head matchups; nothing shows the
all-play picture live, and nothing makes the gaps loud. This app does.

## Status

The app is connected to the league. Whether a 30-second poll of MFL's live
feed holds up during games is still the open question, measured by the spike
in [`spike/`](spike/README.md) during NFL Week 1 (September 2026).

What exists today:

> The mockup is preserved on the [`poc`](https://github.com/shakeelvictor/mfl-live/tree/poc)
> branch as the proof of concept, so it can always be run and referred to.
> `main` is where the real app goes once the cadence measurement returns GO.

- **`app/`** — the app: the page, plus a data layer that loads the league
  (franchises, rosters, schedule) through a small proxy and polls live scoring
  once the season starts. Before kickoff it shows a pre-season board. Its
  fallback is the embedded 2025 Week 12 fixture, which is also the POC.
- **`server/`, `netlify/`, `dev.mjs`** — the proxy that talks to MFL with the
  league's registered client, as a Netlify function in production and a local
  server in development.
- **`spike/`** — the cadence measurement: scripts, fixtures, and the write-up
  of everything already verified against real data.

## What the mockup shows

- **Leaderboard.** A hero card for the current leader, then the standings.
  Each gap between ranks is a divider whose treatment says how close it is:
  settled, live (under 2.5 points), or a coin flip (under 0.25). Rows that
  touch a hot gap fuse into one card. Headline capsules (franchises within 3
  points, wins at stake, starters left) are derived from the rows.
- **Team page.** Tap any franchise for its lineup: starters and bench, with
  headshots, position, NFL team, game status, the real stat line, and points.
- **Live transitions.** Changed numbers roll to their new value and pop a
  delta chip; rows slide when ranks swap; a lead change fires a lightning
  takeover on the hero.
- **Touchdown cards.** A starter's touchdown raises a four-second celebration
  card (headshot, team logo, points); multiple scores queue. Bench players
  never get one. Bears scorers get "BEAR DOWN!" in team colours.
- **Spotlight.** After a day's games are final, the day's top-scoring starter
  gets a card; once the week is official it becomes the MVP of the week, and
  the leader's hero becomes the Week winner.
- **Loading and reveal.** A football-themed loading interstitial (spiral,
  yard-marked field, status line) holds until the data is ready, then the
  page cascades in top to bottom.
- **Dark and light themes.** Phone-first; from 1024px up the board sits on
  the left and the selected team in a panel on the right, with the selected
  row drawn as a tab into it.

The simulator that drives all of this on demand (score a touchdown, flip the
lead, end the day or week) lives on the `poc` branch; `main` runs on the live
league instead.

## Running it

```bash
node dev.mjs
```

Then open <http://localhost:8770/>. That serves `app/` and answers `/api/mfl`
against the real league. `?source=fixture` shows the embedded 2025 Week 12
fixture instead. To exercise the in-season path before kickoff:

```bash
MFL_FAKE_LIVE=spike/fixtures/liveScoring-2025-w12.json node dev.mjs
```

Production is <https://mfllive.netlify.app> (Netlify site `mfllive`, with
`MFL_UA` set in the site environment). It is deployed from the working tree
with the CLI, not from GitHub:

```bash
netlify deploy --no-build --prod
```

```
app/
  index.html      markup; links the three files below
  styles.css      the design's token layer and all styling
  app.js          all behaviour
  data.js         generated: rosters, headshots, logos (2.2MB of base64)
  build-data.mjs  regenerates data.js from the fixture, then bundles
  bundle.mjs      inlines everything into dist/leaderboard.html for publishing
```

Regenerate the data (needs the registered MFL user-agent, see the spike README;
fetched files are cached under `app/.cache/`):

```bash
MFL_UA='imp19716' node app/build-data.mjs
```

Rebuild only the single-file bundle after a code change:

```bash
node app/bundle.mjs
```

The bundle exists because the mockup is also published as a Claude artifact,
which needs one self-contained file and blocks external images — which is why
headshots and logos are embedded rather than loaded from Sleeper's CDN.

## Where the data comes from

- **Scores and lineups: MFL.** One unauthenticated call to
  `liveScoring&DETAILS=1` returns every franchise's score computed under the
  league's own rules, every player's points, who is starting, and how many
  starters have yet to play. The all-play record is arithmetic on the sorted
  list. Recomputing scores from raw stats was tried and disqualified: it gave
  4 of 11 franchises the wrong all-play record in a single week.
- **Headshots, team logos, stat lines: Sleeper.** Players join MFL to Sleeper
  at 100% on `rotowire_id`. Stat lines are shown as context beside MFL's
  number and never feed it.

## Reading further

- [`spike/README.md`](spike/README.md) — the cadence spike: run commands, the
  registered user-agent, pass/fail bars, and every finding verified so far.
- [`CLAUDE.md`](CLAUDE.md) — working notes: settled decisions, the design
  system, traps that have bitten before, and what is deliberately absent.
