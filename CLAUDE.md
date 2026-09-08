# mfl-live — working notes

A live all-play leaderboard for INDOMEXPAK (MFL league `19716`). **Not built
yet, on purpose.** The whole project is gated on one measurement that cannot
happen out of season.

**Read [spike/README.md](spike/README.md) first.** It holds the run commands,
the registered User-Agent, and the pass/fail bars. This file is orientation and
traps only — don't duplicate the spike doc here.

## Verdict (2026-08-13): reduced build

Build the leaderboard. Source it from **MFL's own `liveScoring`**, not a
third-party feed. The roster stat-line view and the Sleeper dependency are cut
from the POC. (Revisited 2026-09-05: stat lines are back as **context
only**, fed live from Sleeper through the proxy's `stats` type; points
never come from them. See "Player images and stats".)

## The app on `main` (started 2026-09-02)

`app/` is the app. It is the POC's page with a data layer in front of it:

- **`server/mfl.mjs`** is the only code that talks to MFL. It sends the
  registered User-Agent, follows `api.myfantasyleague.com`'s redirect to the
  season host, treats MFL's HTTP-200 error bodies as states (`{ ok: false,
  error }`), trims franchise names, and builds `playersMap` (every rostered
  player -> name, position, NFL team, Sleeper id via `rotowire_id`; Sleeper's
  5MB player list is cached server-side for an hour, never sent down). A proxy
  is required: MFL only allows browser calls from its own origin.
- **`netlify/functions/mfl.mjs`** exposes it as `GET /api/mfl?type=...` in
  production (`netlify.toml`: publish `app/`); **`dev.mjs`** serves `app/`
  and the same handler locally (`node dev.mjs`, port 8770; reads `.env`).
- **Production is <https://mfllive.netlify.app>** (site `mfllive`, created
  2026-09-03; `mfl-live` was taken). `MFL_UA` is set in the site
  environment. **Deploys come from GitHub** (linked 2026-09-03 through
  the Netlify GitHub app): every push to `main` publishes `app/` and
  `netlify/functions`, no build command, locked to `main`
  (`allowed_branches`), deploy previews off (`skip_prs`). A failed deploy
  leaves the previous one live; `netlify rollback` restores the last good
  one. The function's response cache is per warm instance, so a cold
  start or a second instance costs one extra MFL call per type.
- **The mockup is at <https://mfllive-poc.netlify.app>** (site
  `mfllive-poc`, created 2026-09-03) so the `poc` branch can be demoed on
  a phone. Static (no function; the fixture and images are in `data.js`),
  and deployed the same way: every push to `poc` publishes `mockup/`,
  locked to `poc`, previews off. The folder's CLI link stays on
  `mfllive`; a manual `netlify deploy` is no longer needed for either
  site, and on a `poc` checkout it would push the mockup to production,
  so don't.
- **Polling budget (MFL rate-limits; an older POC got throttled).** The
  proxy keeps a per-instance response cache by (type, params) with each
  type's max-age (liveScoring 15s, schedule 15s, lineups 5m, rosters 10m, league
  15m, players 1h, stats 1m from Sleeper), coalesces identical in-flight requests, serves stale on
  MFL errors, and on a 429 stops calling MFL for 5 minutes (stale answers
  meanwhile, 503 + Retry-After otherwise). So N open pages cost one MFL
  call per window per type. The page polls liveScoring every 30s in season
  (the schedule every 5m, and with every poll while a game is on, since
  it carries the game scores, possession and red zone; `gamesOn()`),
  everything every 5m before the season, and
  nothing while the tab is hidden (a poll fires when it is shown again).
- **`app/app.js`** boots by loading league + rosters, then polls
  `liveScoring` (and, less often, `nflSchedule`) on that budget. Before the season, liveScoring's
  "not available until the season starts" puts the page in the
  **pre-season phase**: alphabetical franchises with roster counts, a
  countdown hero to the week's first kickoff, a single Roster tab. In season
  it builds franchises from liveScoring (score, `playersYetToPlay`, starters
  by `status`, per-player `gameSecondsRemaining` for the clock) and
  announces a touchdown when a starter jumps >= 6 between polls.
- **The fixture is the fallback.** `data.js` (2025 Week 12) loads only when
  the proxy is unreachable or `?source=fixture` is set; the artifact bundle
  inlines it and sets `window.MFL_FIXTURE`. (The simulator that drove it on
  the POC is gone from `main`; `poc` keeps it.)
- **Pre-season**: no hero, subtitle or capsules; a countdown pill beside
  the WEEK title ticks to the first kickoff. Rows are name-only and
  alphabetical. Lineups come from `weeklyResults` (`status: "starter"`),
  which MFL fills before liveScoring exists, so team pages show Starters and
  Bench (points as a dash) as soon as a lineup is set. The page flips to
  the live board on the first poll after MFL turns liveScoring on for the
  season, not when lineups are set. That flip was rehearsed on 2026-09-03
  by handing the page the 2025 W12 fixture as its next poll: hero, capsules,
  records and gaps appear, the countdown pill goes, the pane lands on
  Starters (the pre-season Roster tab is not remembered as a Bench choice),
  and no "New leader" takeover fires, since an alphabetical board has no
  leader (`leaderId` stays null before the season).
- **Franchise icons**: MFL's league export carries `icon`/`logo` URLs for
  franchises that set one (3 of 11 today). They show by the name in the hero
  and team page and badged on the rank circle in the list (in its place
  pre-season). Plain `<img>` from MFL's host; a failed load removes itself.
- **`MFL_FAKE_LIVE=<liveScoring json>`** on the dev server serves a file as
  the live feed, so the in-season path can be exercised before kickoff
  (`.claude/launch.json` has an `app-fake-live` entry using the 2025 W12
  fixture). Never set it in production.

## Playoffs (Weeks 15–17)

The league's postseason is a **scoring fold, not a bracket** (rules:
<https://fflr.netlify.app/rules>, Playoffs): six qualify on the all-play
record through Week 14 (win pct, then points for); Week 15 seeds 2–6
play and the bottom two are out; Week 16 the three survivors and the
No. 1 seed off its bye play and the bottom two are out; Week 17 is the
Fantasy Bowl, higher score takes it. **MFL cannot represent a five-team
round**: its `playoffBrackets` export is empty for this league, and in
those weeks `liveScoring` lists every franchise, with the ones not in
the round at `0.00` and no starters. So the fold lives in
**`app/playoffs.js`** (pure, a classic script defining `Playoffs`,
mirroring `fantasy-football-records/src/derive.mjs`) and
`spike/verify-playoffs.mjs` replays 2025 offline: the fold names exactly
the franchises MFL scored in each of the three weeks (fixtures
`seasonScores-2025.json`, `liveScoring-2025-w15/16/17.json`). A tie
within a round goes to the higher seed: never observed, but the sort must
be total.

- The proxy's **`seasonScores`** type is MFL's year-to-date
  `weeklyResults` reduced to franchise totals per week (~5KB, held 10m).
  `app.js` fetches it in a playoff week (`loadPlayoffs`, refetched when
  the fold cannot complete) and sets `post`; if it still cannot, `post`
  stays null and the board shows every franchise as in the regular season.
- **The round view**: "Playoffs · Week 15" kicker, the round's name as
  the title, a strip of the three rounds (finished ones link to `?w=`,
  "Back to now" in the kicker when looking back), capsules for "3 of 5
  advance", the cut gap (in its tier colour) and starters left; the Bowl's
  capsules are the purse ($275 / $105, from the rules' payouts table, in
  `Playoffs.PLAYOFFS.purse`). Only the round's franchises are ranked; the
  seed chip replaces the week's record (hero and team page add the
  regular-season record). The **cut line** is the divider under the last
  advancing rank (dashed while settled; live/coin-flip treatments take it
  over as it tightens). Rows under it are `.out` (hollow rank) and carry
  In/Out, which become Advances/Eliminated (Runner-up in the Bowl) once the
  week's games are all final (`roundFinal`: `slate.sunFinal`, since MFL's
  "official" mark is not read yet). Round 1 lists the resting No. 1 seed
  under the board as a bye row (opens its roster). The Bowl is head to head,
  so its hero is the Pro Bowl's face-off (both finalists, higher seed on
  the left, under their franchise icon or an initial, the leader bright,
  the margin in the strip) and the board lists both finalists with no
  divider between them (Champion / Runner-up once final). The Bowl's
  title wears the drift as an **iridescent sweep, not gold** (`h1.bowl`,
  `--iri-*` tokens per theme: white glyphs with a pearl band in dark,
  near-black with a muted glint in light; gold glyphs over the green
  canvas read as Packers colours; a narrower, paler band than the score's
  on a 22s drift, with a glow from a `drop-shadow` filter, since
  `text-shadow` paints over gradient-clipped glyphs) with a trophy emoji
  beside it, kept outside the h1 because the
  gradient is painted through the glyphs and would swallow the emoji's
  colours (on phones under 430px the Bowl title drops to 38px so the
  trophy stays on its line). Behind the board the Bowl also turns on a
  **gold flourish** (`#bowl-bg`, a fixed layer under everything, `.on`
  fades it in over 1.2s): four large soft gold clouds, each a radial
  gradient fading to nothing (no blur filter, phones would stutter),
  drifting on their own loose figures over 23-31s, and a slow diagonal
  wave at page scale; `--bowl-cloud` / `--bowl-wave` tokens per theme,
  warm and luminous in dark, deep and sheer in light. Still under
  reduced motion. The Bowl's
  leading score is not gold but an **iridescent sweep** (`.hero.bowl
  .duel-side.lead .duel-pts`: white glyphs with a pearl band of pink,
  cyan, mint and cream gliding through, painted through the text), live
  and once final. The Bowl's
  leader is "Fantasy Bowl champion" with the gold badge and the money bag
  once final; the
  earlier rounds get no gold, they pay nothing. The spotlight's MVP is
  "MVP of Round 1" and so on. Week 18 (Pakistan vs. the World) is not a
  round; see the Pro Bowl item below.
- **Rehearsing it**: `.claude/launch.json` has `app-2025`
  (`MFL_SEASON=2025 node dev.mjs`, then `?w=15`, `?w=16`, `?w=17` against
  the archive: every round in its final state) and `app-2025-w15-live`
  (`MFL_FAKE_DIR=spike/data/fake-w15`, written by
  `node spike/fake-round.mjs 15`: the same week with its two latest games
  put back on the field, so the cut line, In/Out and starters left show
  mid-round). `MFL_FAKE_DIR` serves `<type>-w<W>.json` or `<type>.json`
  from a directory when the file exists, MFL otherwise; dev only.
- **Week 18, Pakistan vs. the World** (the rules' Pro Bowl, $20 a head):
  each side fields one super lineup of its managers' players, and in MFL
  each manager starts only the players he contributes, so a side's score
  is the **accumulation of its franchises' scores** (2025: 124.31 v 147.63,
  the records site's numbers to the cent; `verify-playoffs.mjs` checks it
  from `liveScoring-2025-w18.json`). The split lives in
  `Playoffs.EXHIBITION` by franchise id (Pakistan 0001/0002/0003/0004/
  0005/0007, the World 0006/0008/0009/0010/0011, the records repo's
  standing split in `data/exhibition.json`; ids are stable, names are
  not) and carries forward until the league re-picks sides. In that week
  `duel` is set instead of `post`: the two sides are the ranked teams
  (hero faces them off under their flags, Pakistan's and the Stars and
  Stripes for the World, drawn as inline SVG in `app.js` since emoji flags
  are plain letters on Windows, the leader bright, the margin in the strip; the
  board lists each side with the contributing managers fused under it and
  what each put in; a side's page is its super lineup, every row naming
  the franchise the player came from, no Bench tab). Players keep their
  franchise's tween key, so a score rolls on both pages. `app-2025` with
  `?w=18` shows it finished; `app-2025-w18-live` (`spike/fake-round.mjs
  18`) mid-week. The strip's fourth chip is the Pro Bowl.
- `classList.toggle(name, force)` with an `undefined` force **flips** the
  class. Pass real booleans (the Bowl-only gold once toggled on in Round 1
  this way).

## What is already settled — do not re-litigate

Each of these was verified against real 2025 data, not inferred:

- **`liveScoring&DETAILS=1` supplies the entire leaderboard in one 22KB
  unauthenticated call** — franchise scores computed under our own rules,
  per-player scores, `status: "starter"`, `playersYetToPlay`,
  `gameSecondsRemaining`. All-play record is then pure arithmetic on the sorted
  list. There is nothing to re-derive and no lineup fetch to schedule.
- **Recomputing scores ourselves is disqualified.** Running real stat lines
  through the fflr scoring engine matched MFL on 127 of 131 starters (96.9%) —
  and still produced the **wrong all-play record for 4 of 11 franchises** in a
  single week. Two franchises were 0.06 apart. Every error was LB or PK.
- **MFL exposes no raw stats**, only fantasy points. Stat lines would have to
  come from Sleeper, which joins at **100% on `rotowire_id`** (228/228
  rostered) — but see the drift finding above before reaching for it.
- **The scoring engine in `fantasy-draft-assistant` is keyed to Sleeper's stat
  vocabulary, not MFL's.** It has never met MFL's. Its header says so.
- **Every touchdown in the league's rules is worth 6** (verified 2026-09-03
  from `TYPE=rules`: passing, rushing, receiving, kick and punt return,
  defensive and fumble return, and the team-defense TD all pay `*6`), so the
  page's "starter jumps >= 6 between polls" touchdown gate matches the QB
  passing value too. The gate cannot tell a touchdown from any other 6-point
  jump: a 45-yard run (0.13333/yd), a 60-yard catch (6 + 0.5) or a 60-yard
  field goal also clear it, and two plays landing in the same 30s poll add
  up. MFL gives points only, so that is the ceiling; accept the rare false
  card rather than recompute from stats.
- **MFL counts special-teams tackles toward IDP totals**; Sleeper breaks them
  out as `st_tkl_solo`. Adding that field lifts escalator agreement from 93.0%
  to 96.1% across four weeks. The residue is provider disagreement on tackle
  attribution, which is a judgment call and not fixable.

## Visual design

The mockup implements the **FFLR Live v2** redesign. The handoff's token
layer lives at the top of `app/styles.css` (ported verbatim). The handoff
files themselves (spec, prototype and its runtime, mock data, screenshots,
`tokens.css`) have all been removed; the mockup is the reference now. Design premise: in all-play
the **gap between adjacent ranks is worth a full win**, so gaps are the loudest
element and scores are second.

- **In dark the kicker ("Playoffs · Week 15") and the subhead are white**
  (`--text-primary`), every week: the muted greys were hard to read on
  the dark canvas, worst under the Bowl's gold clouds (2026-09-05). Light
  keeps its greys and steps them up a shade in the Bowl.
- **Dark-first**: bare `:root` is the dark palette and
  `:root[data-theme="light"]` is the override. Do not "fix" it to follow
  `prefers-color-scheme`; the DARK/LIGHT segmented control stamps the root
  and remembers the choice in localStorage (`mfl-live-theme`), which an
  inline script in `index.html` re-stamps before the stylesheet loads so
  there is no flash. Nothing stored means dark.
- **Archivo** for display (900 italic uppercase headers, 700 roman for names
  in lists), **Nunito** for body and every number, `tabular-nums` on the root.
  The **WEEK title** wears a slow colour drift: a gradient of the text
  colour with a band of the accent gliding through it, painted through
  the glyphs (`background-clip: text`, the spotlight's `fflr-wave`, 12s
  alternate). Both stops are tokens, so dark gets white with mint and
  light gets near-black with deep teal, each at its own contrast. Held
  static mid-title under reduced motion.
- **Loading interstitial** (`#loader`, shown by default in the markup so
  nothing paints before it): a looping cartoon of three players behind a
  field strip, the leader in the middle raising a finger, in navy and
  orange. The source is `design/loader-source.mp4` (Shakeel's own
  Midjourney animation, 624px, 24fps, 5.2s; the GIF export of the same
  clip was 320px and dithered, and looked soft); `design/loader.py`
  (Pillow, numpy, scipy, imageio-ffmpeg) decodes it, clears the white
  background to alpha on every frame (near-white connected to the
  border), crops the baked-in wordmark off the bottom, keeps every frame
  (`STEP=2` halves it but reads choppy) and writes `loader.webp` (620px,
  which is the 2x a Retina screen wants at the 340 CSS px display size;
  ~2.6MB with lossy alpha) next to the page. The image rises
  in, and the page's own **MFL LIVE** wipes in left to right under it
  (clip-path); a status line sits below. `showLoading(msg)` /
  `hideLoading()`. It holds at least 2.8s (`MIN_LOAD_MS`), long enough
  for the scene to play through once, and on `main` longer if the first
  liveScoring poll takes longer.
- **First-load cascade**: once the loader lifts, `cascadeIn()` gives every
  board block, then each standings row and divider, then the laptop pane an
  index (`--i`) and the `.intro` class reveals them top to bottom (55ms
  apart). The class and indexes are removed when the run ends so the
  animations never fight FLIP transforms later. Skipped under reduced
  motion.
- **The mark** is the league's logo (hands reaching for a football in a
  navy ring). `design/mfllive-logo.jpeg` is the source, drawn with a mint
  ball; `design/cutout.py` (needs Pillow + numpy) recolours the ball to
  leather (`LEATHER`, scored by how green a pixel leans so strokes and
  laces are untouched) and writes everything `app/` serves, in two cuts: **transparent** (every white area cleared except the
  laces, told apart by the ball around them) for the 40px header mark,
  `logo.png` at 256px; and **disc** (only the outside cleared, the ring's
  interior white) for `favicon-32.png`, `favicon-192.png` and
  `apple-touch-icon.png`, since a badge reads the same on a dark tab bar.
  The 686px masters are `design/mfllive-logo-transparent.png` and
  `design/mfllive-logo.png`. The loader still spins the line-art football.
- The header is the mark and the wordmark: **MFL LIVE**, with LIVE in the live red
  and a pulsing dot after it, always (it is the name, not a status: it
  used to drop the dot before the season and once a week was official,
  changed 2026-09-05). There is no separate status line.
- **Hero names fit their column** (`fitName()` in `app.js`, 2026-09-07): a
  single word wider than the name column ("WhiskeyDitka" at 30px on a
  375px phone) used to run under the score. The script steps the name
  down to a 24px floor; if the word still cannot sit beside the score, the
  `.hero-mid` goes `.stack` (name across the hero, record and score on one
  line under it), and only past that may the word break (`.wrap-any`).
  Measured on render, after `openTeam()` shows the page (the page is
  `display: none` during `renderTeam()`, so an earlier measurement is 0)
  and on resize. Multi-word names still wrap at full size. Same code in
  `mockup/app.js` on `poc`.
- In dark the hero has **no border and no inset highlight** (`--hero-border`,
  `--hero-shadow`): its gradient fades to near-canvas, so either reads as a
  stray outline. Light keeps both.
- **Accent is mint** and carries "live / on now", the selected segment and the
  leader's badge -- never urgency. Urgency is a separate warm scale:
  `--gap-critical` (< 0.25, coin flip) -> `--gap-live` (< 2.5) ->
  `--gap-settled`. Rows adjacent to a hot gap **fuse into one card** (per-edge
  radius, shadow dropped); the rank circle takes the hotter of its two gaps.
- **Position chips** use `--pos-qb/rb/wr/te/k/lb`; every defensive position
  maps to `--pos-lb`, matching the league's "3 IDP, any combination" rule.
- **Roster rows** are grouped by position in lineup order (QB, RB, WR,
  TE, K, IDP), each group opened by a shallow separator: a micro label in
  the position's colour and a hairline to the right. When the pane's
  contents change (a team selected, Starters/Bench switched) the rows
  **swing in** like a sign hung from its top edge caught by a breeze:
  back and forth about that hinge (away from the viewer, then toward),
  each swing shorter, a trace of side-to-side, settling in .85s, 28ms
  after the row above (9° away at most: a breath, not a gust)
  (`.prow.enter`, `--i`; the roster supplies the perspective). Entering
  rows carry `will-change: transform, opacity` and
  `backface-visibility: hidden` so Safari composites them before the
  swing instead of repainting each frame (it stuttered without), and the
  top scorer's gold wave, a per-frame repaint, waits until the swing has
  settled. `.enter` (and `--i`) come off at the swing's `animationend`
  (2026-09-08), so the compositor hints do not linger on settled rows
  until the next render. A poll's re-render leaves them still.
  **Each row expands** (2026-09-08): the row is a button (tap, Enter or
  Space; `role="button"`, `aria-expanded`) and opens a breakdown under
  it, `.pdetail`, a grid of stat tiles (`statTiles()`: the position's
  core counts always, zeros muted, the rest once they count, a rate
  where the volume supports one; "No stats yet" / "Game not started" /
  "No stats until kickoff" when there is no line). The chevron under
  the points flips. Opened in place, not by re-render, so the panel's
  height transition plays (the script tweens the panel to its measured
  height, then clears the inline size, so an open panel is a plain
  block: natural height, no overflow clip; Safari left the tile labels
  unpainted in the first cut, a `0fr -> 1fr` grid track with a clipped
  inner div, and the labels lost their own overflow clip for the same
  reason, 2026-09-08) and the rows below slide; the open set is remembered by player (`expanded`, MFL id when
  the feed supplies one, slot key on the fixture) so a poll's re-render
  keeps them open. `.prow` has no row gap so the closed panel sits
  flush; the laptop pane refreshes `markMore()` when a panel finishes
  opening. Still context beside MFL's number. **The game strip** heads
  the card (`gameStrip()`): away @ home with both scores once kicked off
  (from `nflSchedule`'s per-team `score`, kept on each `games` entry as
  `match`), the player's team bright, a football after the score of the
  side with `hasPossession`, RZ in the coin-flip red for `inRedZone`,
  and the state on the right: kickoff day and time before the game
  ("MIA at PIT"), the player's own clock from liveScoring while on, or
  Final. The fixture fallback has no schedule, so no strip.
  `spike/fake-round.mjs` stages the home side with the ball in both
  live games and in the red zone in the first, so `app-2025-w15-live`
  shows every RZ marker.
  **Red zone** (2026-09-08): a pulsing red `RZ` chip after the clock
  on a live row when the player's offense is inside the 20 (a defender
  gets it when the opponent is), and "red zone" in the same red
  replaces "on now" in a franchise's status while any starter is in
  one (`inRedZone`). Urgency red, never mint. The game strip's RZ chip
  is the team-level flag.
  Rows carry three small signals: the NFL logo badged on the
  headshot (as on the spotlight and touchdown cards), a mint **TD** chip on
  the headshot's top corner for anyone who has scored (counted from the
  stat line, so a simulated touchdown adds it live), a **gold sweep** on
  the team's top-scoring starter (the spotlight's wave in gold, plus a gold
  ring; wins over the live treatment), and
  a live treatment for players still on the field (mint headshot ring,
  soft mint wash fading across the row).
- The team page is a full-screen route over the board (`position: fixed`),
  so the board keeps its scroll position. **From 1024px up** the shell is a
  two-column grid instead: board left, and the same team page becomes an
  in-flow pane on the right that always shows a team (the leader by
  default; `openTeam` just selects). The pane is a stretched grid item, so
  it spans the board's full height and a tab at any height meets green;
  only its inner shell is sticky. (A viewport-tall sticky pane was the
  bug: on short windows the hero and rows 2-3 sat below its bottom edge
  before any scroll, and their tabs bridged into nothing.) The selected row is a **tab into the
  panel**: the pane is a top-to-bottom green gradient (`--tab-a` to
  `--tab-b`), and the script tells the active element how far down the
  pane it sits (`--tab-t`) so CSS `color-mix` derives `--join`, the pane's
  colour at that height (mixed **in sRGB**, because that is the space
  `linear-gradient` interpolates in -- an oklch mix lands a visibly
  different green at the seam); the tab's own left-to-right gradient and its
  bridge land exactly on `--join`. Hero text and an accent rank badge; right
  corners squared, inset-shadow borders (so selection never shifts the
  list; on laptop the row's radius does not tween, so no flicker before the
  bridge) and a `::after` bridge one gutter wide plus 1px, so it covers the
  panel's border. The standings cast one `filter: drop-shadow` as a whole,
  so fused clusters get a shadow too (`.board` is z-indexed above the pane
  for the bridge). The panel hides its own team hero and header, since the tab
  already carries name, record, status and points, and packs the roster
  (team, status and stat line on one row under the name) so twelve
  starters fit without scrolling on a tall window. On a short one the
  shell is capped at the viewport (`max-height: calc(100vh - 32px)`),
  the tabs stay put, and the roster card scrolls inside itself, with a
  fade over its bottom edge while there is more (`data-more` on the
  page, kept by `markMore()` on render, scroll and resize). Before this
  the sticky shell outgrew short windows and the last IDP row needed the
  whole board scrolled to the end. The leader hero gets the same tab
  treatment when selected, its gradient landing on the panel green. The
  phone layout below 1024px is untouched. Starters/Bench is a segmented
  control; bench rows render at 75% opacity, 42% when scoreless.
- The handoff's headshot placeholder (initials circle) is **replaced by real
  Sleeper headshots**; the initials circle is the fallback only.
- **Live transitions** are in: changed values flash once and **roll** from
  old to new (every live number carries `data-tween="<key>"`; keys are
  shared across hero, row and team page so a value carries over when it
  changes surface), team and player scores pop a floating delta chip, rows
  that change rank slide to their new slot (FLIP on the row elements, keyed
  by franchise id), and clusters re-fuse. The "Simulate live scoring" toggle under the
  footnote exercises this by bumping one starter at a time -- it is a mockup
  affordance, not a feed, and it keeps team total == starters sum.
- **Lead change** fires a takeover on the hero (mint strobe, lightning
  bolts, diagonal sweep, badge spin, name rise; ~1.6s) and the ex-leader
  fades into the list at #2. "Flip the lead" hands #2 just enough to pass
  #1 so the sequence can be seen on demand.
- **Touchdowns** raise a celebration card over everything: headshot with
  the NFL team logo badged on it, TOUCHDOWN slam, franchise, points. It
  stays 4s; further scores queue in arrival order ("+N more") and each gets
  its own card. Tap the scrim or Escape to skip. **Starters only:** a
  bench touchdown moves the row in the Bench tab and the "behind" total,
  never the franchise total, and gets no card (the gate is liveScoring's
  per-player `status: "starter"`; the simulator scores bench TDs now and
  then to exercise it). A Bears scorer adds
  "BEAR DOWN!" stomping in letter by letter in Bears orange with a navy
  trim, and the whole card goes Bears: navy ground, orange glow, flash and
  rays, orange-and-white portrait ring. Literal team colours on purpose,
  identical in both themes. "Bears TD" on the demo bar triggers one. In the mockup a TD is a
  simulated event (6 + yardage); with the feed, MFL gives only fantasy
  points, so the trigger would be one starter jumping a touchdown's worth
  between polls.
- **Spotlight card** under the hero, a between-days card: once a day's
  games are all final it shows that day's highest-scoring *starter*
  (headshot, logo, stat line, franchise, points) and goes away when the
  next day's games kick off; once the week is official it turns gold as the
  MVP of the week and stays until the next week begins. While a day is in
  progress (the mockup's opening state) there is no card. A soft colour wave drifts across its background (accent, gold
  as MVP). When the week is official the leader hero becomes the **Week
  winner**: gold wave, gold badge, and a money-bag emoji hanging over its
  top-right corner (it sits outside the hero, which clips overflow for the
  lightning). The slate is staged (`THU_NFL` = Thursday's teams, everything
  else Sunday, `slate.sunFinal` / `slate.weekFinal`); with the feed the day
  comes from the schedule and "official" from MFL. "End the day", "End
  the week" and "Start next week" on the demo bar step through it; the
  first two stop the simulator, zero the to-play counts and flip the header
  to Final, the last only clears the card and the winner treatment (a full
  rollover to a new week is not mocked).
- **The Witching Hour**: NFL RedZone's 2:30 PM Central moment, Scott
  Hanson's call, recreated as a ten-second full-screen takeover in the
  original's three cuts: a tilted close-up of the clock with both hands
  racing; a hard cut to the clock upright and centred as the hands slow
  onto 2:30; then the card, WITCHING in backlit red over HOUR in white
  (letters stomping in, a red strobe) stacked above a white-faced clock
  with a glowing red rim, on a charcoal wall lit by flickering red neon
  bars, the second hand ticking; then the exit, like the original's: the
  title flies into the camera, growing past the edges as it fades, the
  clock fades out, and the card splits at the middle, the halves (cut 3
  is drawn twice, each clipped to one half) sweeping off the top and
  bottom of the screen to open onto the board (1.1s).
  Cuts are `data-shot` on the overlay, so each shot's animations start
  when it is displayed. Every size is `min()` of a vw and a vh value so
  the stack fits phones (width-bound) and short laptops (height-bound).
  Fires every Sunday at 2:30 PM in `America/Chicago` (the instant is
  resolved through Intl so DST is right; once per Sunday per browser,
  remembered in localStorage `mfl-live-witch`; a hidden tab plays it
  when shown again within the hour). On `main` `?witch=1` plays it on
  load for checking; on `poc` the demo bar has a button. Click or Escape
  skips it. Literal red in both themes; reduced motion holds the card
  alone for 3.5s.
- The **Demo bar** and simulator, the legend and the footnotes exist only
  on the `poc` branch. Its "View" tags (added 2026-09-05) switch the
  mockup into the postseason views described above (`mockup/playoffs.js`
  is a copy of `app/playoffs.js`; keep them the same), seeded from the
  real 2025 season and folded from the board's own points; see the `poc`
  branch's CLAUDE.md. On `main` they are removed, along with the subtitle
  line; in season the subtitle slot shows only "Updated <time>".

Thresholds (`CRITICAL`, `LIVE`, `WITHIN`) live in one place in the script and
the legend and capsules read them. The headline stats and the hero are derived
from the rows.

**Mockup layout.** `app/index.html` is the markup; it links `styles.css`,
`app.js` and the generated `data.js` (ROSTERS, HEADSHOTS, LOGOS -- 2.2MB of
base64, and the only reason the page is big). That is what the preview server
serves. The Artifact needs one self-contained file, so `app/bundle.mjs`
inlines the four into `app/dist/leaderboard.html` (gitignored) -- publish
that, never `index.html`.

`app/build-data.mjs` regenerates `data.js` from the committed fixture and
then rebundles (`MFL_UA='imp19716' node app/build-data.mjs`; plain
`node app/bundle.mjs` when only code changed). It asserts each team has 12
starters whose points sum to the team total, so a bad join fails loudly rather
than shipping. Do not hand-edit `data.js`.

## Player images and stats

MFL serves **neither** -- no image field anywhere in the players export, and
fantasy points only. (`TYPE=playerProfile` does return news headlines free,
which is unused so far.) Both come from Sleeper, reached through the same
`rotowire_id` join: **215/215** rostered players resolve, and 215/215 have a
headshot.

- Headshots: `sleepercdn.com/content/nfl/players/thumb/{sleeper_id}.jpg`
  (250x181). Team logos: `sleepercdn.com/images/team_logos/nfl/{code}.png`
  with Sleeper's **lowercase** codes; MFL's differ for eight teams
  (SFO/NEP/GBP/KCC/TBB/NOS/LVR/JAC -> sf/ne/gb/kc/tb/no/lv/jax), mapped in
  `build-data.mjs`. **An unknown id returns 403, not 404** -- don't branch
  on 404.
- The mockup **inlines** them as data: URIs in `data.js` (~2.2MB: 215
  headshots at 160px plus 32 logos) because the Artifact CSP blocks
  `sleepercdn.com`; a plain `<img src>` to the CDN renders nothing with
  no error. On Netlify there is no such constraint -- load them from the CDN.
- `sips` applies `-Z` **before** `-c` regardless of argument order, so cropping
  square and resizing must be two separate calls or the crop clamps to the
  already-shrunken image. Raw downloads are cached so re-processing never
  re-fetches 215 images.

**The Team view mocks stat lines as context.** `build-data.mjs` embeds each
player's real Week 12 line from Sleeper's free stats endpoint
(`/v1/stats/nfl/regular/2025/12`, keyed by Sleeper id) as `st`, and the row
shows it under the name beside a game status. The status is staged: one
late game (JAC at KCC, "Q3 8:12") and a second (CHI at MIN, "Q4 2:31") are
on the field and everything else is Final; "on now" on the leaderboard is derived from that slate, and the
simulator only bumps players in that game, editing their line to match the
bump. The line is context next to MFL's number and never feeds it.

**Live stat lines are in, as context only (2026-09-05).** The proxy's
`stats` type fetches Sleeper's weekly stats (`/v1/stats/nfl/regular/<season>/<W>`,
free, updates during games, ~570KB for every NFL player), cuts them to the
league's rostered players (Sleeper ids from the playersMap join, remembered
an hour) and to `STAT_KEYS`, and holds the ~10KB result a minute; the page
asks once a minute in season and hands each player its line as `st`, so
rows, the spotlight and the TD chip read real lines. The fetch runs
**beside the poll, never in its path** (`fetchStats`: 5s timeout on the
proxy's Sleeper call, 8s on the page's, fresh lines applied to the
current rosters and re-rendered when they land), so Sleeper can never
delay MFL's numbers. Lines older than five minutes while games are on
read **"stats delayed"** in the subhead and dim (`body.stats-stale`);
lines that never arrived read "stats unavailable". Sleeper down means the
last lines stay, never a missing score: MFL's points are untouched. The drift finding above is why they
stay context: a line beside MFL's number, never feeding it. Headshots are
static files off the live path; a headshot cannot contradict a score.

## Licensing a faster stat feed does not help

Asked and answered (Sep 2026). Cheap live NFL stat feeds do exist -- Tank01
(~$10/mo, 1000 req/day), Big Balls Sports Data (free tier), Rolling Insights
(live from $400/mo), Sportradar (enterprise). Sleeper is already free, live,
and verified here.

None of them solves the problem, because the bottleneck was never stat
availability. Turning stats into *this league's* points needs INDOMEXPAK's
rules applied, and that fails two ways no vendor fixes:

- **Provider disagreement.** MFL's stats come from STATS Perform. Any other
  provider attributes tackles differently, and the tackle escalator pays
  volume, so one tackle is worth points. This is the measured 4-of-11 failure.
- **Rule replication.** Even with perfect stats the scoring engine would be
  reverse-engineered. We never settled whether MFL runs the escalator on solo
  or solo+special-teams; two of three cases matched the latter. That is
  inference, not certainty.

What MFL sells here is not stats -- it is the authoritative application of the
league's custom rules, which is not purchasable at any tier. A faster feed
trades a 90s lag for a number that is wrong in a way that costs someone a
weekly payout.

A fast feed *is* legitimate for context that is not a score ("your RB just
broke a 40-yarder"), since it never has to reconcile against MFL's total.

## What we are actually competing with

MFL publishes its own refresh intervals on its GameDay page: **GameDay every
30-35 seconds, standard live scoring every 90 seconds**. The standard page is
what this league uses and what this project exists to replace.

**GameDay is a Windows desktop program** -- "an optional (and free!) program
that runs on Microsoft Windows computers", downloaded as an executable. So the
30-35s tier does not exist on a phone for anyone, on any platform, and does not
exist on macOS at all. On mobile, MFL's own offering is the 90-second page.

Three consequences:

- The underlying feed sustains ~30s, so a 30s poll of `liveScoring` can be up
  to **3x fresher than MFL's own page**. "You can never be fresher than MFL" is
  wrong as stated -- you cannot beat its *data*, but you can beat its *page*.
- The bar is a 90-second page the league already tolerates, not Sleeper. Even
  a 90s result matches the incumbent exactly and wins on UI.
- **Live-scoring mobile apps already ship on this data** (MFL Live at
  mfl-fantasy.com, MFL Platinum on Play) -- separate domains and package names
  from MFL, so third-party clients on the same public API. Their existence is
  evidence the API sustains live scoring; nobody ships a live-scoring app on a
  feed that cannot do it. They are also built for head-to-head leagues, so none
  of them shows an all-play record live. That is the gap, and it is why "we
  have no choice" is the accurate description of this league's options.

**MFL does not own its stat feed.** Its marketing says it "partners with" data
companies, and `stats_global_id` is the only identifier present for 100% of
players (2,779/2,779) while `cbs_id`/`rotowire_id`/`espn_id` sit at 83-87% --
universal coverage is the signature of a primary key from the source system.
Nobody in this market owns the pipeline; they all license it.

## Traps

**Three separate bugs here failed by looking like success.** That is the
pattern to distrust in this codebase, not crashes:

- **MFL's JSON key order is not stable between calls.** Player objects come
  back with fields in different orders. Hashing the raw response body reports a
  change on every poll — which reads as spectacular cadence. `canonical()`
  exists for this and is tested against checked-in fixtures.
- **MFL reports application errors as HTTP 200 with an error body**
  (`{"error":{"$t":"Live scoring not available until the season starts"}}`).
  Status-code checks alone record a refusal as a normal empty poll. Always
  check `body.error`, as `src/mfl/client.mjs` in the records repo does.
- **Franchise names can carry trailing whitespace** — MFL returns
  `"Reggaeton Forever "`. Trim at the boundary; the records pipeline already
  does this in `unescapeHtml`.

**Never hardcode a summary number that the rows beneath it also express.** The
mockup's headline stats are derived from the data for this reason — a constant
that silently disagrees with its own table is the same class of bug as the
three above.

**The repo root is not your home directory.** `git init` was run here
deliberately; before that, `git rev-parse --show-toplevel` returned
`/Users/shakeelvictor`, and a `git add -A` would have swept the home folder.

## Branches

**`poc`** is the mockup frozen as the proof of concept (branched from
`main` at c81a074, 2026-09-02). Keep it runnable; do not rebase or force-push
it. `main` is for the real app once the Week 1 cadence run returns GO; until
then it still carries the mockup too.

## What is deliberately absent

- **No live-scoring dependence before the cadence run.** The app on `main`
  connects to the league (franchises, rosters, schedule) now; whether a
  30s poll of liveScoring holds is still what the Week 1 run decides.
- **This does not share the FFLR records GitHub Actions pipeline.** Different
  cadence (30s vs weekly), different blast radius (that job commits records
  that settle payouts), and a wrong storage model (it commits data to git).
  Copy `src/mfl/client.mjs` if useful; do not couple the deployments.
- **`spike/data/` is gitignored.** Those logs are measurements, not source.
- **`app/.cache/` is gitignored** (23MB of refetchable MFL and Sleeper
  data plus raw headshots) and so is `app/dist/` (the bundle); the split
  mockup sources including `data.js` are committed. `.claude/launch.json` (a
  static server for previewing the mockup) stays untracked.
