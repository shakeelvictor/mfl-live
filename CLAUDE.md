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
from the POC.

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
- **MFL counts special-teams tackles toward IDP totals**; Sleeper breaks them
  out as `st_tkl_solo`. Adding that field lifts escalator agreement from 93.0%
  to 96.1% across four weeks. The residue is provider disagreement on tackle
  attribution, which is a judgment call and not fixable.

## Visual design

The mockup implements the **FFLR Live v2** redesign. The handoff's token
layer lives at the top of `mockup/styles.css` (ported verbatim). The handoff
files themselves (spec, prototype and its runtime, mock data, screenshots,
`tokens.css`) have all been removed; the mockup is the reference now. Design premise: in all-play
the **gap between adjacent ranks is worth a full win**, so gaps are the loudest
element and scores are second.

- **Dark-first**: bare `:root` is the dark palette and
  `:root[data-theme="light"]` is the override. Do not "fix" it to follow
  `prefers-color-scheme`; the DARK/LIGHT segmented control stamps the root
  and remembers the choice in localStorage (`mfl-live-theme`), which an
  inline script in `index.html` re-stamps before the stylesheet loads so
  there is no flash. Nothing stored means dark.
- **Archivo** for display (900 italic uppercase headers, 700 roman for names
  in lists), **Nunito** for body and every number, `tabular-nums` on the root.
- **Loading interstitial** (`#loader`, shown by default in the markup so
  nothing paints before it): a looping cartoon of three players behind a
  field strip, the leader in the middle raising a finger, in navy and
  orange. The source is `design/loader-source.gif` (Shakeel's own
  Midjourney animation, 320px, 5.2s); `design/loader.py` (Pillow +
  numpy) clears the white background to alpha on every frame, crops the
  baked-in wordmark off the bottom, keeps every second frame (12fps) and
  writes `loader.webp` (~750KB, alpha) next to the page. The image rises
  in, and the page's own **MFL LIVE** wipes in left to right under it
  (clip-path); a status line sits below. `showLoading(msg)` /
  `hideLoading()`. The mockup holds it ~1.1s (fonts ready) and hands
  off; the real app holds it until the first liveScoring poll lands.
- **First-load cascade**: once the loader lifts, `cascadeIn()` gives every
  board block, then each standings row and divider, then the laptop pane an
  index (`--i`) and the `.intro` class reveals them top to bottom (55ms
  apart). The class and indexes are removed when the run ends so the
  animations never fight FLIP transforms later. Skipped under reduced
  motion.
- The header is the wordmark only: **MFL LIVE**, with LIVE in the live red
  and a pulsing dot after it; once the week is official the dot goes and
  LIVE rejoins the name. There is no separate status line.
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
  the position's colour and a hairline to the right. Rows carry three small signals: the NFL logo badged on the
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
  starters fit without scrolling. The leader hero gets the same tab
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
  title flies into the camera, growing past the edges as it fades, and
  the card splits at the middle, the halves (cut 3
  is drawn twice, each clipped to one half) sweeping off the top and
  bottom of the screen to open onto the board (1.1s).
  Cuts are `data-shot` on the overlay, so each shot's animations start
  when it is displayed. Every size is `min()` of a vw and a vh value so
  the stack fits phones (width-bound) and short laptops (height-bound).
  Fires every Sunday at 2:30 PM in `America/Chicago` (the instant is
  resolved through Intl so DST is right; once per Sunday per browser,
  remembered in localStorage `mfl-live-witch`; a hidden tab plays it
  when shown again within the hour), or on demand from the demo bar.
  Click or Escape skips it. Literal red in both themes; reduced motion
  holds the card alone for 3.5s.
- The **Demo bar** (Simulate live scoring / Flip the lead / Score a TD /
  Bears TD / End the day / End the week / Start next week / Witching hour)
  sits under the masthead, hidden by default behind the **Demo** toggle
  next to the theme control (remembered in localStorage), so a shared page
  opens clean. It is mockup-only and will be removed.

Thresholds (`CRITICAL`, `LIVE`, `WITHIN`) live in one place in the script and
the legend and capsules read them. The headline stats and the hero are derived
from the rows.

**Mockup layout.** `mockup/index.html` is the markup; it links `styles.css`,
`app.js` and the generated `data.js` (ROSTERS, HEADSHOTS, LOGOS -- 2.2MB of
base64, and the only reason the page is big). That is what the preview server
serves. The Artifact needs one self-contained file, so `mockup/bundle.mjs`
inlines the four into `mockup/dist/leaderboard.html` (gitignored) -- publish
that, never `index.html`.

`mockup/build-data.mjs` regenerates `data.js` from the committed fixture and
then rebundles (`MFL_UA='imp19716' node mockup/build-data.mjs`; plain
`node mockup/bundle.mjs` when only code changed). It asserts each team has 12
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

**Images are off the live path; stat lines are on it.** The crosswalk is a
cache job and headshots are static files, so neither touches Sunday polling --
and a headshot cannot contradict a score. Live stat lines would need Sleeper
polled *during games* and carry the drift problem above. That asymmetry is why
headshots are in and stat lines are still out.

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

- **No application code.** Not until the Week 1 cadence run returns GO. A
  leaderboard built before that measurement is the sunk cost this whole
  evaluation exists to avoid.
- **This does not share the FFLR records GitHub Actions pipeline.** Different
  cadence (30s vs weekly), different blast radius (that job commits records
  that settle payouts), and a wrong storage model (it commits data to git).
  Copy `src/mfl/client.mjs` if useful; do not couple the deployments.
- **`spike/data/` is gitignored.** Those logs are measurements, not source.
- **`mockup/.cache/` is gitignored** (23MB of refetchable MFL and Sleeper
  data plus raw headshots) and so is `mockup/dist/` (the bundle); the split
  mockup sources including `data.js` are committed. `.claude/launch.json` (a
  static server for previewing the mockup) stays untracked.
