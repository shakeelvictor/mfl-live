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
  The **WEEK title** wears a slow colour drift: a gradient of the text
  colour with a band of the accent gliding through it, painted through
  the glyphs (`background-clip: text`, the spotlight's `fflr-wave`, 12s
  alternate). Both stops are tokens, so dark gets white with mint and
  light gets near-black with deep teal, each at its own contrast. Held
  static mid-title under reduced motion.
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
  `hideLoading()`. It holds at least 2.8s (`MIN_LOAD_MS`), long enough
  for the scene to play through once; the bundle inlines `loader.webp`
  as a data: URI for the artifact.
- **First-load cascade**: once the loader lifts, `cascadeIn()` gives every
  board block, then each standings row and divider, then the laptop pane an
  index (`--i`) and the `.intro` class reveals them top to bottom (55ms
  apart). The class and indexes are removed when the run ends so the
  animations never fight FLIP transforms later. Skipped under reduced
  motion.
- The header is the wordmark only: **MFL LIVE**, with LIVE in the live red
  and a pulsing dot after it; it stays on always, before the
  season and after a week is final (the name, not a status). There is no separate status line.
- In dark the hero has **no border and no inset highlight** (`--hero-border`,
  `--hero-shadow`): its gradient fades to near-canvas, so either reads as a
  stray outline. Light keeps both.
- **Blue under the mint** (2026-09-11): the dark canvas is blue-black
  (`#060a11`), the surfaces blue-grey, the wash a sea blue, and the hero
  and the pane sweep from the mint's teal into a deep sea blue (the hero
  reaches oklch hue 252 past its middle and fades to the surface;
  `--tab-b` is the blue, `--tab-a` the teal still, so the laptop tab's
  seam is a teal-and-blue mix, sRGB hex at both ends as before). Light
  cools the canvas to a blue-white and runs the hero teal to cobalt.
  **Gold never sits on the blue**: `.hero.winner` reads `--hero-bg-gold`,
  the teal-to-surface hero the gold sat on before. On laptop the picked
  winner hero is still the tab, so its right edge meets the pane's
  mix there; only the phone's winner hero is fully green. Why: the green
  ground under the gold read as the Packers, and the mint beside the
  orange as the Dolphins; the blue takes care of the first (the Bears'
  navy and orange, and a cobalt with crimson, brass, volt and fuchsia,
  were tried the same day and reverted; mint is the keeper).
- **Accent is mint** and carries "live / on now", the selected segment and the
  leader's badge -- never urgency. Urgency is a separate warm scale:
  `--gap-critical` (< 0.25, coin flip) -> `--gap-live` (< 2.5) ->
  `--gap-settled`. Rows adjacent to a hot gap **fuse into one card** (per-edge
  radius, shadow dropped); the rank circle takes the hotter of its two gaps.
- **Position chips** use `--pos-qb/rb/wr/te/k/lb`; every defensive position
  maps to `--pos-lb`, matching the league's "3 IDP, any combination" rule.
- **Roster rows** are grouped by position in lineup order (QB, RB, WR,
  TE, K, IDP), and **within a position the order is fixed for the week**
  (name, then id; 2026-09-08). It used to be points, so two backs swapped
  rows whenever one overtook the other, and tied rows (0.00 before
  kickoff) fell back to MFL's array order, which is not stable between
  polls. Each group is opened by a shallow separator: a micro label in
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
  **Each row opens the player card** (ported from `main`, 2026-09-10;
  from 09-08 to 09-10 a breakdown expanded under the row instead): the
  row is a button (tap, Enter or Space; `role="button"`) and raises
  `#pcard` over the page, the shape of the draft assistant's player
  card. A hero band in the team's colours (`TEAM_COLORS`, the touchdown
  card's table; the club mark ghosted behind the headshot; dark in both
  themes) carries the name, the franchise and week as a kicker, the
  position and, when Sleeper has one, an **injury chip**, then two
  vitals: the points (rolling, on the row's own tween key: the card is
  among `liveNumberEls`) and **the game strip** (`gameStrip()`: away @
  home with both scores from the staged `GAMES` slate, the real 2025
  Week 12 finals re-paired around the two staged live games, the
  player's team bright, a football by the side with the ball, RZ in the
  coin-flip red, the clock or Final on the right; a simulated touchdown
  adds seven to the scorer's side, `scoreNfl`). Under it, one column:
  the stat tiles (`tilesHtml()`, `statTiles()` kept the same as
  `main`'s) and **the latest news** from `sleeper.app/graphql`
  (`get_player_news`, straight from the browser, once per open,
  remembered three minutes; RotoBaller's timestamps are Eastern written
  as UTC and are corrected). Rows wear **badges by the name**
  (`rowBadges`): the injury status and a newspaper for news from the
  last day, from one batched query per roster (`fetchRosterStatus`).
  On the mockup site this all works; **in the Artifact bundle the CSP
  blocks sleeper.app**, so the news reads "Couldn't load the news" and
  no badges show. A centred 600px card on a laptop, a fixed-height
  bottom sheet on a phone with ghost stories while the news loads; the scrim, the close button, Escape or, on a phone, a finger dragging
  the sheet down puts it away (a grab handle at the top says so). No
  chevron on the row. The mechanics and the traps are in `main`'s CLAUDE.md.
  **Red zone** (2026-09-08): a live row whose player's offense is
  inside the 20 (offensive positions only; IDP get nothing, a defender
  facing a red-zone drive is a different signal) wears a faint red
  ring with a **red glow pulsing** around the row and a red headshot
  ring (`.prow.rz::after` is the glow, a pseudo-element so its
  animation never fights the swing-in's; a comet lapping the border
  was tried on 2026-09-08, as a conic sweep and then on a motion path,
  and dropped for the glow alone), and a franchise's status carries a
  breathing red count pill, "2 RZ" (`rzCount`), in place of "on now"
  while any starter is in one (`inRedZone`). Urgency red, never mint.
  The game strip's RZ chip is the team-level flag.
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
  `linear-gradient` interpolates in **for legacy colours**; an oklch mix
  lands a visibly different green at the seam). So `--tab-a`/`--tab-b`
  must stay sRGB hex in both themes: as oklch (2026-09-08) the pane's
  gradient interpolated in oklab and, the colours sitting outside the
  sRGB gamut, gradient and mix were gamut-mapped by different paths and
  the bridge never matched the pane. The tab's own left-to-right gradient
  and its bridge land exactly on `--join`; the hero's 160deg gradient
  reaches `--join` only 70% along its diagonal, which the top of its right
  edge never gets to, so a second 90deg layer fades its right third onto
  `--join`. Hero text and an accent rank badge; right
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
  control; bench rows render at full opacity (the 75% / 42% fade came
  off 2026-09-08: the tab and the muted stat line already mark them).
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
  trim. **The card wears the scorer's team colours** (2026-09-08):
  `TEAM_COLORS` in `app.js` gives every team a dark ground and a bright
  accent by MFL code (`--td-ground` / `--td-accent` on the modal,
  `.td-team`): ground with an accent glow, flash and rays, an
  accent-and-white portrait ring, accent points and bar, every alpha a
  `color-mix` of the two. Literal on purpose and identical in both
  themes; only the scrim differs, a darkened tint of the ground (76% in
  dark, 52% in light). A free agent keeps the theme's own card. **The
  Bears sit a tier above every team** (`.td-chi`): an orange strobe
  over the page on entry, orange rays turning at page scale behind the
  card with a breathing orange halo under it (the scrim's
  pseudo-elements, opacity and transform only), the card rumbling as
  the letters land, its own rays brighter and faster, an orange glow on
  TOUCHDOWN, and a 5.5s hold (`TD_CHI_MS`) against 4s. Under reduced
  motion the page strobe is hidden, not frozen. "Bears TD" on the demo
  bar triggers one. In the mockup a TD is a
  simulated event (6 + yardage); with the feed (`main`), MFL gives only
  fantasy points, so the trigger is one starter jumping a touchdown's
  worth between polls, confirmed by Sleeper's stat line showing one more
  touchdown (2026-09-08); the simulator raises cards directly, so the
  gate does not exist here.
- **Spotlight card** under the hero, a between-days card: once a day's
  games are all final it shows that day's highest-scoring *starter*
  (headshot, logo, stat line, franchise, points) and goes away when the
  next day's games kick off; once the week is official it turns gold as the
  MVP of the week and stays until the next week begins. While a day is in
  progress (the mockup's opening state) there is no card. **The card's entrance** (2026-09-11): a day's last whistle
  used to pop it in; now the space opens first, slowly, from the top
  down (`revealSpotlight`: the card's height tweened from nothing over
  1.6s, the rows below easing down), and only then does the scorer come
  into view a piece at a time (`.spot.reveal`, `--i` per piece, 140ms
  apart). The MVP of the week gets the same: the full opening when it
  arrives from nothing (a Monday night, the day and the week final
  together), the reveal alone when a day's card turns gold in place. A tick's re-render leaves the card alone while the reveal runs
  (`spotRevealUntil`), so the pieces do not restart. **It runs on the
  first visit after a day's end, on a refresh and on a return to the
  app** (2026-09-11): a card present when the page loads waits under
  the loader and opens once the board has cascaded in (`spotQueued`,
  `boardReady` at the cascade's end), and a card showing when the tab
  comes back after a minute or more away (`SPOT_RETURN_MS`) opens again;
  a short flip away leaves it be. A new day's card replacing another
  opens too; the MVP turning gold in place, or a corrected top scorer,
  gets the reveal alone. Skipped under reduced motion. Same on `main`. A soft colour wave drifts across its background (accent, gold
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
  when shown again within the hour), or on demand from the demo bar.
  **Only Escape skips it** (2026-09-08): a stray tap on a full-screen
  takeover is far likelier than a wish to skip it, so the overlay
  ignores clicks; the touchdown card keeps its tap-to-skip. Literal red
  in both themes; reduced motion holds the card alone for 3.5s.
- **The postseason on the demo bar.** A "View" row of tags (Week 12 /
  Round 1 / Semifinal / Fantasy Bowl / Pro Bowl) switches the board into
  each week of the postseason, the same views as the app on `main`:
  `mockup/playoffs.js` is a copy of `app/playoffs.js` (seeds on the
  Week 1-14 all-play record, the 5 -> 3 -> 4 -> 2 fold, the Pakistan /
  World split by franchise id, the purse), and `mockup/season.js` is the
  real 2025 season's weekly franchise scores for the seeding. Each earlier
  round is folded from THIS board's live points, so whoever is above the
  cut line in Round 1 is exactly who plays the Semifinal; the fixture's
  Week 12 points stand in for every round's scores. The Pro Bowl has no
  declared super lineups in the fixture, so `pickLineup` takes each side's
  best twelve from its managers' starters under the lineup rules (greedy,
  a showcase not a solver); a manager's unpicked starters join his bench,
  and every player keeps its franchise key (`k` / `bk`), so the simulator,
  the touchdown cards and the tweens address it exactly as on the
  franchise's own page (`slotPlayer` always reads the franchise). A view
  switch is a debut: rows do not slide, numbers do not roll (`silent`),
  no takeover. "End the day" turns In/Out into Advances/Eliminated and
  crowns the Bowl and Pro Bowl winners; the simulator, Flip the lead and
  the TD buttons work inside every view (in Week 18 the points land on a
  side's managers). Cut line, seed chips, bye row, the sides' flags and
  the rest are described under the app on `main`'s CLAUDE.md.
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
