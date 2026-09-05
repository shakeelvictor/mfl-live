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

**Not built yet, on purpose.** The whole build is gated on one measurement
that cannot be taken out of season: how often MFL's live feed actually changes
while games are running, and whether it serves a 30-second poll without
throttling. That is measured by the spike in [`spike/`](spike/README.md) during
NFL Week 1 (September 2026). Until it returns GO, there is no application code.

What exists today:

> The mockup is preserved on the [`poc`](https://github.com/shakeelvictor/mfl-live/tree/poc)
> branch as the proof of concept, so it can always be run and referred to.
> `main` is where the real app goes once the cadence measurement returns GO.

- **`mockup/`** — a working, fully interactive mockup of the finished app,
  built on real 2025 Week 12 data (franchises, scores, lineups, per-player
  points and stat lines). Nothing in it is invented except the mid-slate
  framing (clock, games in progress) used to show the board live.
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
- **The Witching Hour.** At 2:30 PM Central on Sundays, RedZone's
  witching hour, a ten-second full-screen clock takes over the board and
  sweeps open again. The demo bar fires it on demand.
- **The postseason.** The demo bar's View tags switch the board into Round
  1, the Semifinal, the Fantasy Bowl and the Week 18 Pro Bowl (Pakistan
  vs. the World): the round's name as the title, a strip of the rounds,
  only the teams playing ranked with their seed, a cut line under the last
  advancing rank with In/Out on every row, the resting No. 1 seed under
  the board, the Bowl's purse, and for the Pro Bowl the two sides face to
  face under their flags with each manager's contribution listed under
  his side. The simulator and the other demo buttons keep working inside
  every view.
- **Spotlight.** After a day's games are final, the day's top-scoring starter
  gets a card; once the week is official it becomes the MVP of the week, and
  the leader's hero becomes the Week winner.
- **Loading and reveal.** A looping cartoon of three players behind a field
  strip, the leader raising a finger, with the wordmark wiping in under
  it, holds until the data is ready; then the page cascades in top to
  bottom.
- **Dark and light themes.** Phone-first; from 1024px up the board sits on
  the left and the selected team in a panel on the right, with the selected
  row drawn as a tab into it.

A **Demo** toggle in the header reveals a bar that drives all of this:
simulate live scoring, flip the lead, score a touchdown (or a Bears one), end
the day, end the week, start the next week. It is mockup-only and will be
removed.

## Running the mockup

It is published at <https://mfllive-poc.netlify.app>: every push to the
`poc` branch deploys `mockup/` there (Netlify site `mfllive-poc`, locked to
this branch, no build step, deploy previews off).

The mockup is static files; any web server pointed at `mockup/` works.

```bash
python3 -m http.server 8770 --directory mockup
```

Then open <http://localhost:8770/>.

```
mockup/
  index.html      markup; links the three files below
  styles.css      the design's token layer and all styling
  app.js          all behaviour
  data.js         generated: rosters, headshots, logos (2.2MB of base64)
  build-data.mjs  regenerates data.js from the fixture, then bundles
  bundle.mjs      inlines everything into dist/leaderboard.html for publishing
```

Regenerate the data (needs the registered MFL user-agent, see the spike README;
fetched files are cached under `mockup/.cache/`):

```bash
MFL_UA='imp19716' node mockup/build-data.mjs
```

Rebuild only the single-file bundle after a code change:

```bash
node mockup/bundle.mjs
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
