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
- **The redesign preview is at <https://mfllive-redesign.netlify.app>**
  (site `mfllive-redesign`, id `142b0778-...`, created 2026-09-24): the
  same repo through the Netlify GitHub app, publishing `app/` and
  `netlify/functions` from `redesign` only (`allowed_branches`), deploy
  previews off (`skip_prs`), so every push to `redesign` publishes
  there and nothing on it reaches production. **Its own registered MFL
  client**, `MFL_UA=imp219716` in its environment (set through the API:
  the folder's CLI link is `mfllive`, so `netlify env:set` here would
  write production's), so its calls never throttle production's
  `imp19716`. It runs the same function, so it counts against the same
  team's invocation allowance.
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
  type's max-age (liveScoring 30s, schedule 30s, lineups 5m, rosters 10m,
  league 15m, players 1h, stats 15s from Sleeper, situation 15s from
  ESPN; 2026-09-15: MFL's two were 15s and stats 30s), coalesces
  identical in-flight requests, serves stale on
  MFL errors, and on a 429 stops calling MFL for 5 minutes (stale answers
  meanwhile, 503 + Retry-After otherwise). So N open pages cost one MFL
  call per window per type. **And one function invocation** (2026-09-15):
  every answer carries `Netlify-CDN-Cache-Control: public, durable,
  s-maxage=<what is left of its window>`, so Netlify's edge shares it
  across every node and viewer, and only invokes the function when no
  node has it (`cdn()` / `served()` in `server/mfl.mjs`; a stale answer
  is shared 5s, errors never). Without `durable` each edge node asked the
  function itself: three requests in a row from one place all missed, and
  Week 1 cost 9,705 invocations of the Free plan's 125,000 with one
  viewer. **The page polls one `tick`** (2026-09-15): `GET
  /api/mfl?type=tick&W=..&parts=liveScoring,nflSchedule,stats,situation`
  names the parts this poll wants and the proxy answers with each from
  its own cache (`{ ok, parts: { liveScoring: <that type's answer>, ... }
  }`), MFL's parts waited for, Sleeper's and ESPN's given 2.5s
  (`SIDE_MS`) and then the last cached one or a `pending` placeholder
  while the fetch in flight fills the cache for the next tick; the
  answer's own edge window is the shortest left among its parts. If the
  tick itself fails the page polls each type on its own, the old way
  (`refreshLive`). **Every 15s while a game is on** (`POLL_GAME_MS`;
  30s before), 30s otherwise in season, everything every 5m before the
  season, and nothing while the tab is hidden (a poll fires when it is
  shown again). The schedule comes every 5m, and with every poll while a
  game is on (`gamesOn()`); the lines and the situation with every poll
  while a game is on, the lines once a minute otherwise. Read the
  invocation count after a Sunday: `GET
  api.netlify.com/api/v1/sites/<site id>/usage` with the CLI's token.
- **`app/app.js`** boots by loading league + rosters, then polls
  `liveScoring` (and, less often, `nflSchedule`) on that budget. Before the season, liveScoring's
  "not available until the season starts" puts the page in the
  **pre-season phase**: alphabetical franchises with roster counts, a
  countdown hero to the week's first kickoff, a single Roster tab. In season
  it builds franchises from liveScoring (score, `playersYetToPlay`, starters
  by `status`, per-player `gameSecondsRemaining` for the clock) and
  announces a touchdown when ESPN's play says a starter scored (see
  "Every touchdown ... is worth 6").
  **The record chip is the season's unofficial all-play** (2026-09-08):
  the week's record from the rank on top of every finished week's, so a
  10-0 Week 1 reads 20-0 or 19-1 as Week 2 moves. `loadSeason` fetches
  the proxy's `seasonScores` with the week's first poll, when the week
  rolls and every half hour (stat corrections), and `Playoffs.allPlay`
  over the weeks before this one gives `seasonRec` (ties counted as
  ties, shown as a third number); `derive()` adds the week. Week 1, the
  fixture and a failed fetch show the week alone (`t.week` keeps the
  week's own record for whoever wants it). Playoff weeks keep the seed
  chip. **Between weeks the board is the season's table** (2026-09-16):
  a tie on the week's points falls to the season's win pct, then points
  for, then name, and until a franchise has begun (`started`) the chip
  adds nothing for the week and no lead-change takeover fires; before
  this, every 0.00 row kept MFL's array order and took a record from it.
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
  and team page, and on the board as the row's **mark** (2026-09-24, as
  mfl-manager's standings: `franchiseMark`, a 44px disc beside the rank;
  a franchise with no icon shows its initials on its own hue,
  `oklch(0.8 0.12 <hue>)` from `markHue`, the same hue the manager gives
  it; a Pro Bowl side shows its flag). Plain `<img>` from MFL's host; a
  failed load removes itself (on the board, it falls back to the
  initials).
- **The Week 1 opener measured MFL's liveScoring export refreshing on a
  fixed ~200s cycle** (2026-09-09, `spike/log-cadence.mjs` at 30s: every
  gap between changes was 183s or 214s, zero 429s). MFL's number cannot be
  fresher than that, which is why the proxy asks MFL every 30s and no
  faster (the cadence the spike ran clean); Sleeper's lines and ESPN's
  situation move within seconds of a play, and those are what the 15s
  poll is for. Sunday's eight-game window is the measurement the
  spike was designed around; see spike/README.md for the bars.
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
  divider between them (Champion / Runner-up once final; the champion's
  row wears a 2px gold ring, `.row.champ`, on laptop along the tab's
  three closed edges and its bridge, 2026-09-15). The Bowl's
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
  **One local preview for all of it** (2026-09-25): `node
  spike/preview.mjs` (`.claude/launch.json`: `app-preview`) starts two dev
  servers on the 2025 archive, PORT (every week final) and PORT+1 (Weeks
  15-18 mid-game, staged by `fake-round.mjs` on first run and gathered
  into `spike/data/preview-live/`, since the fake files are named by
  week), and `http://localhost:8770/preview` (`spike/preview.html`,
  served by `dev.mjs` only, so Netlify never publishes it) links every
  round, the Bowl and the Pro Bowl both ways, the regular season, Quinn,
  the touchdown cards and the Witching Hour, with Dark/Light and a
  holiday applied to every link. `?theme=dark` now overrides a stored
  Light for that load, as `?theme=light` always did.
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
  `gameSecondsRemaining`. The week's all-play record is then pure
  arithmetic on the sorted list (the season's, shown on the chip, adds
  the finished weeks from `seasonScores`). There is nothing to re-derive
  and no lineup fetch to schedule.
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
  defensive and fumble return, and the team-defense TD all pay `*6`).
  **Only ESPN's play raises the touchdown card** (2026-09-17, Shakeel's
  call after two nights of doubled cards): a play in a live game ending
  in TOUCHDOWN (`playTouchdowns`, on every situation arrival) raises it
  within a poll of the whistle, for the ball carrier (the league starter
  the play names last, on either side) and, on a pass with no turnover,
  the passer too, with the play's value under the league's rules as the
  points (the yards it names through `playPoints`, so a 12-yard run reads
  +7.60, a 9-yard pass +6.36 for the passer; a return or a defensive
  score reads the flat 6). A play marked NULLIFIED, REVERSED, NO PLAY or
  a two-point try raises nothing, and the first play after a load or a
  two-minute gap is not judged on arrival (`playSeen`), since it may be
  old. **That hold is no longer a drop** (2026-09-20): until then the
  unjudged play went into `ids` and was never looked at again, so a
  touchdown still on the field fifteen seconds later never raised its
  card — which is the case a phone meets every time, since the tab stops
  polling while the screen is off and the one play it swallows on being
  shown again is the touchdown the viewer has just watched (Bhayshul
  Tuten and Trey McBride, both missed on Week 3 Sunday; a page load
  swallowed one the same way, the first arrival having no previous one to
  measure against). The play is held instead (`judged`), and the next
  arrival that still finds it on the field weighs it (`judgePlay`, split
  out of the loop) — within `TD_HOLD_MS` (90s) of the first sighting and
  never while the game is at a break (`atABreak`, ESPN's `detail`:
  halftime, end of quarter, delay), so nothing genuinely old comes
  through. Measured the same day: of 40 touchdowns across the slate the
  median play stood 81s as ESPN's newest, and only one stood under 30s,
  so a held play is nearly always still on the field one poll later.
  **A play raises its card once**: `applySituationBody` drops an
  answer the proxy fetched earlier than the one on the page (`data.at`,
  `situationFetchedAt`; the function's cache is per instance and the
  edge's per URL, so a tick could carry an older situation and put a
  game's previous play back, and Goff's touchdown after it read as new);
  `playSeen` remembers every play id a game has shown (`ids`), not only
  the last; a touchdown play re-posted under a new id with the same text
  is the same play (`tdPlayTexts`); and a player's card holds off another
  for `TD_COOLDOWN_MS` (2 min: nobody scores twice that fast).
  **What was cut, and why.** From 2026-09-08 Sleeper's stat line (the
  touchdown count rising) and MFL's 6-point jump between polls raised
  cards too, matched against each other and the play by per-player
  counts and three-minute windows (`noteJump`, `confirmTouchdowns`,
  `settleTouchdowns`, `tdShown`/`tdPlays`/`tdConfirmed`/`tdPending`).
  Every pairing that fell outside its window raised the same touchdown
  twice: a jump raised as the fallback and the line a second later
  (Kyren Williams, 09-10), a line counting the touchdown before ESPN's
  play arrived (Josh Allen's scramble, 09-17), a jump arriving after its
  window. The jump alone cannot tell a touchdown from any other 6-point
  jump anyway (a 45-yard run, a 60-yard catch or field goal, two plays in
  one poll). The cost: a touchdown ESPN's scoreboard never shows as a
  game's last play (two plays inside one 15s poll) gets no card, and
  with ESPN down there are none. The board's points never came from any
  of them. **Overturned on review**
  (2026-09-15, Shakeel's pick over waiting for the try): the card reads
  the ruling on the field, so when the booth reverses a touchdown the
  page raises the same card muted (`.td-over`: no rays or flash, the
  portrait in grey, "Overturned" over "No touchdown on review", the
  play's points struck through) for every card the play raised, and
  lifts the player's cooldown so his next one counts (`overturn`). ESPN
  revises the play's own text in place ("... TOUCHDOWN. The Replay
  Official reviewed the ... ruling, and the play was REVERSED. J.Warren
  left end to MIA 1 for 11 yards"), which `playSeen` notices by the text
  changing under the same id; a reversal posted as its own entry within
  `TD_WINDOW_MS`, naming one of the scorers and not a try, counts too. A
  reversed play's row and strip show the corrected result marked
  "Reversed ·" (`playText`). Rehearsed on `app-2025-w15-live` by feeding
  `applySituationBody` staged plays (both sides of a game carry the same
  play and id): the line alone (nothing), the play (one card), a flap
  back and a re-post under a new id (nothing), a later touchdown (a
  card), a reversal in place (the muted card). **A play's text carries
  the try after it** ("... TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. ...",
  seen on a 2024 game through the logger), so a two-point try only rules
  the play out when it comes before the touchdown.
  `spike/log-feeds.mjs` still logs each feed's first sighting of every
  touchdown against the play's wall clock (spike/README.md, Spike 3).
  The TD chip on a roster row still counts from the stat line; that is
  context, not a card.
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

**The redesign (branch `redesign`, from 2026-09-24)** brings the page into
MFL Manager's "Night Game" dark / "Paper Stadium" light system, following
`design/redesign/README.md` step by step (its "Working order"). Step 1 is
in: the token blocks at the top of `styles.css` are
`design/redesign/tokens.css` with MFL Live's own `--wash` kept (hairlines
a touch stronger, simpler shadows, white on the coin-flip pill, a darker
muted grey in light, `--radius-row` 14, `--radius-pill` 10; new names
`--grad`, `--accent-text`/`--accent-line`, `--violet*`, `--dim`,
`--chrome*`, `--foot-mark`, `--radius-cta`, `--gutter`, `--gold-ink`,
`--sheet`), and `--hero-bg` is `--grad`, so the dark hero now runs teal to
blue to violet instead of fading to the surface. The notes below describe
the page before the redesign unless they say otherwise; each step updates
the ones it changes.

**The team page is a box score** (2026-09-25, Shakeel's pick from four
directions on a Design canvas: "Night Game" board + "Broadcast" team
page, photos on by default). `rosterHtml` renders one table per stat
group (`BOX`: Passing, Rushing, Receiving for WR and TE, Kicking,
Defense for every IDP), a title in the group's colour over the column
labels; each row (`boxRow`, still a `.prow` button with its key, live
wash, red zone, gold top scorer, TD chip, badges and last play) has the
photo, the name, the game, Sleeper's line in columns and the page's
points. The roster is a size container (`container: roster`): under
540px a row is two lines (photo and points spanning both, the name over
the columns, the first name an initial), from 540px one line with a
Game column (`gameCell`: away over home, scores, the ball, RZ) and the
full first name. The photo-card row (`playerRow` without columns) is
kept for anything that asks for it. The laptop layout widened for it
(max 1440px, the pane `minmax(380px, 1.15fr)`, was 1280 and 520px), so
the pane takes the one-line cut from about 1280px. The pane also opens
with **NFL now** (`renderNflNow`, `#nfl-now`, laptop only): a score box
per game on the field, the ball, RZ and ESPN's clock, nothing while no
game is on. The team head's record adds the gap to the neighbour
(`gapNote`: "+51.87 on 2nd", "7.88 back of 1st"), regular season only.
**Brought to the mock the same day** (the canvas's "The pick" row):
the board gets the league kicker over WEEK ("INDOMEXPAK · 2026 · Week
3", `LEAGUE` from the league export), the capsules as three tiles, the
leader's rank as an "01" tile and its mark beside the name
(`.hero-line`). The phone team page is a scorebug (`.hero.sbug`: mark,
name, "1st · 22-8 · 2 to play" on the gradient, the points and the gap
beside it), "Box score" / "Bench" pills, each stat group its own card,
one line a row at every width with fixed column widths (`--bx-cols`) so
rows line up under the labels. On laptop the pane starts level with the
leader's card (`--pane-top`, set by `markActive`), on a dark body
(`--surface-sunken`), with a gradient band as tall as the card
(`--hero-h`; `renderTeamSum`: the top starter, on now, to play, final,
touchdowns, the gap, the bench) holding the tabs; the leader's tab joins
the band (`--join: var(--tab-a)`), a selected row is a mint-edged tab
into the dark, and NFL now sits above the pane beside the week head
(the day's slate when no game is on, three across, two rows).
Then (same day, on Shakeel's review of the preview): the masthead spans
both columns on laptop (the theme at the pane's right edge); the leader's
card does not lift while it is the pane's tab (the lift notched the seam
with the band) and keeps the league gradient (`--grad`) fading onto the
band, which runs blue to violet (`--band-join`, `--band-end`); the kicker
drops the year the league's name carries; and the page's ground is the
mock's: no sea-blue `--wash` down the top (holidays keep theirs), the
aurora's glows softer (teal high left, violet right and low left, no
bottom-right cloud, no diagonal band). This supersedes the aurora's
"Bowl's own strength" below for ordinary weeks.
And the top (same day): WEEK at 92px on a phone and up to 128px on a
laptop, "Updated" beside it there; the capsules are within 3.0, **coin
flips** (the critical gaps; "wins at stake" came off) and starters left;
the band carries the team's latest play (`.tb-play`, the red-zone one
first, with ESPN's down and spot) and, for any team but the leader, its
mark and name (`.tb-name`). **A picked row is no longer a tab into the
pane** (Shakeel's call): it wears the league gradient like the leader's
card, no bridge, every corner round; only the leader's card still joins
the band. The laptop notes on tabs and `--join` further down describe
the older pane.
**Off the field the Top scorer card moves up** (same day): on a laptop,
with no game live (`gamesOn()` false), the spotlight element itself moves
into NFL now's slot above the pane (`placeSpot`, `#spot-slot`), so the
day's top scorer or the MVP sits beside WEEK; it moves back under the
leader's card when a game kicks off. A phone never moves it.
**The leader's name comes into the band once its card scrolls away**
(same day): while the leader is picked the band folds its name away (the
card beside it names the team); `syncHeroAway`, one rAF per scroll burst,
sets `.hero-away` on the pane once the card's bottom is above the band's,
and the name slides in, and out again when the card is back.
In the Fantasy Bowl and the Pro Bowl the band always names the picked
team (`.face-off`): their card is a face-off naming both sides, not the
picked one.
**On a phone (and tablet) the Top scorer card sits right under the WEEK
title**, above the capsules (same day; CSS `order` in `.col-board`, no
markup change).
**Narrow phones** (same day, a ~345px screen): up to 400px the scorebug
stacks (the name across the gradient at full width, the points and gap
on a strip under it), and a box-score card under 330px wide turns each
row into two lines (photo, name and game on top, the stat columns under
them); a meta item never breaks inside itself.

- **Blue under the mint** (2026-09-11, from `poc`): the dark canvas is
  blue-black (`#060a11`, also the manifest's splash and the `theme-color`
  meta's fallback), the surfaces blue-grey, the wash a sea blue, and the
  hero and the pane sweep from the mint's teal into a deep sea blue (the
  hero reaches oklch hue 252 past its middle and fades to the surface;
  `--tab-b` is the blue, `--tab-a` the teal still, so the laptop tab's
  seam is a teal-and-blue mix, sRGB hex at both ends as before). Light
  cools the canvas to a blue-white and runs the hero teal to cobalt.
  **Gold never sits on the blue**: `.hero.winner` reads `--hero-bg-gold`,
  the teal-to-surface hero the gold sat on before. On laptop the picked
  winner hero is still the tab, so its right edge meets the pane's mix;
  only the phone's winner hero is fully green. Why: the green ground
  under the gold read as the Packers. Four palettes and four third
  colours were tried on `poc` that day (a cobalt with crimson, brass,
  volt and fuchsia; the Bears' navy and orange; a red on the blue) and
  mint is the keeper; the orange close gap beside the mint still reads a
  little Dolphins, and a rose close gap is the fix if it ever matters.
- **An aurora behind the regular season** (2026-09-11, from `poc`):
  `#sky-bg`, the Bowl's flourish for every other week: the same four
  soft clouds and slow wave in a fixed layer under the board, two teal
  (the mint's family, `--sky-teal`) and two violet (`--sky-violet`, a
  step past the ground's blue), so the page runs mint, teal, blue,
  violet. Violet is the one hue on the board with no job (not live, not
  urgent, not gold; only the K chip, small), which is why it can drift
  behind everything and say nothing; a rose was tried and read as the
  urgency scale, a burnt orange as the close gap. **The Bowl's gold
  replaces it, never sits on it**: the same line that turns `#bowl-bg`
  on turns `#sky-bg` off, so Week 17 still arrives as a change. At the
  Bowl's own strength (Shakeel's call on seeing it; half was invisible
  at laptop size), no blur filter. **Still, since 2026-09-13**: the
  clouds drifted and the wave slid for two days, and it unsettled the
  rest of the page (on `poc` the Witching Hour's text sometimes failed
  to paint in full over four screen-sized layers moving under it), so
  the aurora is a fixed gradient now, the same clouds and wave where
  they stood, no animation and no `will-change`. Only the Bowl's gold
  flourish still drifts.
- **Holidays** (2026-09-12): Thanksgiving and Christmas have games this
  season, and the page wears each day's colours. `holidayOn()` in
  `app.js` resolves the NFL's date in Eastern (November's fourth
  Thursday, December 25th; a Karachi manager watches the Thanksgiving
  games on Friday morning) and stamps `data-holiday` on the root, at
  load, every minute and when the tab is shown, so a page left open
  through midnight changes with the day. The token layer at the end of
  `styles.css` reads it over BOTH themes (`:root[data-holiday=..]` and
  `:root[data-holiday=..][data-theme="light"]`; the root attribute
  outranks the bare theme rules on specificity, so the block can sit
  last), so the Dark/Light toggle still works and each gets a holiday
  cut: canvas, wash, surfaces, inks, accent (mint's jobs go to the
  holiday's own), hero gradient, `--tab-a`/`--tab-b` (sRGB hex still),
  `--hero-tab-start`, the aurora's two clouds (`--sky-teal` and
  `--sky-violet` take the holiday's pair), and since the redesign
  (2026-09-24) its own `--grad`, `--accent-text` and `--accent-line`,
  so components built on them wear the holiday too (`--grad` is the
  holiday hero run to a deeper third stop in dark, the light hero itself
  in light). Urgency keeps its scale.
  **Thanksgiving** is pumpkin and amber over a warm brown ground, the
  hero pumpkin into a deep cranberry-brown, with the close gap moved to
  a cranberry (the stock orange sat on the amber accent and vanished).
  **Christmas** is holly green and crimson over an evergreen ground, the
  hero and the pane running green into red, and the Week winner's gold
  on green. `?holiday=thanksgiving|christmas` forces one for checking;
  `syncHoliday` calls `syncTheme` so the status bar follows the
  holiday's canvas, and puts the holiday's emoji beside the WEEK title
  (`#week-holiday`: a turkey, a snowman) on the Bowl trophy's own
  swing, the same `.trophy` class, outside the h1 for the same reason.
  On `poc` the demo bar's Holiday tags force one.
  **Christmas also snows** (`#snow`, `snowOn`): a light fall over the
  page, a fixed layer above the board and under the team page and the
  cards (z 40), 48 small flakes the script builds while the holiday is
  on and empties otherwise, each on its own lane, size, weight, fall
  time (9-20s) and sway, with negative delays so the sky is full when it
  first shows; the fall on the flake and the sway on the dot inside it,
  transform and opacity only, no filter. White in dark, a pale blue-grey
  in light (`--snow`) so it shows on the white cards. Hidden under
  reduced motion.
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
- **Barlow Condensed** for display and **Barlow** for data and reading
  (2026-09-24, the redesign; Archivo and Nunito until then). Barlow
  Condensed is loaded in two cuts only, upright 700 and italic 800, so a
  900 or a 400 asked of it draws the nearest of those; keep the two-cut
  load (a third weight is a third download on a phone). Rules still
  written for the old faces (`italic 900`, `800` on data) resolve to
  those cuts until each surface is restyled. **Every figure is
  tabular**: `*, ::before, ::after { font-variant-numeric: tabular-nums
  !important }`. The `font:` shorthand resets `font-variant-numeric` and
  `font-feature-settings` to normal, so the old `tabular-nums` on the
  root never reached a number styled with it; Nunito hid that, but
  Barlow's default figures are proportional and a rolling score shook
  between 46.6px and 57.6px wide. Don't drop the `!important`.
  The **WEEK title** wears a slow colour drift: a gradient of the text
  colour with a band of the accent gliding through it, painted through
  the glyphs (`background-clip: text`, the spotlight's `fflr-wave`, 12s
  alternate). Both stops are tokens, so dark gets white with mint and
  light gets near-black with deep teal, each at its own contrast. Held
  static mid-title under reduced motion.
- **Loading interstitial** (`#loader`, shown by default in the markup so
  nothing paints before it). **On `redesign` it is mfl-manager's splash,
  "for now"** (2026-09-24, Shakeel's call): **MFL LIVE** in the display
  face, outlined, filling left to right with the league gradient (mint
  to violet; deep teal to indigo in light) as the answers land (`spFrame`
  creeps toward 70% on time alone, `splashStep(0.55)` once the league and
  rosters are in, full at `hideLoading`), the status as its title
  (`showLoading(msg)` still sets it) over a one-line note; once the fill
  has caught up the ground parts down the middle like a curtain
  (`.sp-curtain`) and `hideLoading(then)` runs the cascade as it opens
  (never later than 1.5s after the call; at once in a background tab).
  `MIN_LOAD_MS` is 1200 (the cartoon needed 2.8s to play through). The
  cartoon below is kept, files and all, to come back: `git show
  0253a3d:app/index.html` and `:app/styles.css` have its markup and
  rules, and `app.js` its 2.8s. **Until then**: a looping cartoon of three players behind a
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
- **Installed as an app** (2026-09-11): `app/manifest.webmanifest`
  (standalone, `background_color` and `theme_color` on the dark canvas)
  and two 512px icons `cutout.py` writes beside the favicons: `icon-512.png`,
  the plain disc, which Android's splash draws large on the canvas so it
  hands off to the loader with no colour jump (before the manifest the
  splash was white with the 192px favicon small in the middle); and
  `icon-maskable-512.png`, the disc at 74% on the ring's own navy, so the
  launcher's mask shows a navy tile with the white badge. Android's splash
  layout is fixed (icon centred, the name at the bottom in the system
  font), so only the ground, the icon and its size are ours. The
  `theme-color` meta paints the status bar and `syncTheme` moves it onto
  the theme's `--canvas`; the splash itself is always dark. An installed
  copy keeps the old manifest until the platform refreshes it, so re-add
  the shortcut to see a change.
- The header is the mark and the wordmark: **MFL LIVE**, with LIVE in the live red
  and a pulsing dot after it, always (it is the name, not a status: it
  used to drop the dot before the season and once a week was official,
  changed 2026-09-05). There is no separate status line. **On `redesign`
  it stays main's header** (2026-09-24): the manager's floating chrome
  (sticky, across both columns) was built and set aside the same day on
  Shakeel's call, so the header is back in the board column, scrolling
  with the page, the league's mark at 40px and MFL LIVE in the heavy
  italic (20px: Barlow Condensed's italic is narrower than Archivo's 18px
  was), and the DARK/LIGHT pill round as before (999px, not the
  redesign's 10px pills). What the manager's chrome left behind is
  **"Manager ↗"** (`.mast-link`, a pill in the theme control's shape and
  voice beside it) to <https://mfl-manager-2.up.railway.app>, the
  manager's preview; the manager's own "Live scoring" pill points back
  here; swap the address when the manager has a production one. Both
  compact under 430px and fit on one line at 360px.
- **Hero names fit their column** (`fitName()` in `app.js`, 2026-09-07): a
  single word wider than the name column ("WhiskeyDitka" at 30px on a
  375px phone) used to run under the score. The script steps the name
  down to a 28px floor (24px until the redesign); if the word still cannot sit beside the score, the
  `.hero-mid` goes `.stack` (name across the hero, record and score on one
  line under it), and only past that may the word break (`.wrap-any`).
  Measured on render, after `openTeam()` shows the page (the page is
  `display: none` during `renderTeam()`, so an earlier measurement is 0)
  and on resize. Multi-word names still wrap at full size. Same code in
  `mockup/app.js` on `poc`. **The redesign's hero type** (2026-09-24):
  the name in the italic 800 at `clamp(40px, 11cqi, 72px)`, the score in
  Barlow Condensed 700 at `clamp(56px, 13cqi, 96px)`, the strip's gap at
  28px, the kicker in Barlow 700 11px `.14em`, the status pill in Barlow
  capitals; the Bowl's and the Pro Bowl's face-off names at `clamp(26px,
  6.5cqi, 44px)` and scores at `clamp(44px, 11cqi, 80px)`. `cqi` because
  `.hero` is a size container: on a laptop the hero is the board column,
  not the window, and the handoff's `vw` sizes overran it.
- **The picked team lifts off the board** (2026-09-08): tapping a row
  sets `picked` and `markActive()` marks it `.row.sel`: a perspective
  lift toward the viewer (`perspective(900px) translateZ(51px)`, 6%
  bigger, a touch of overshoot), its own `--shadow-lift`, a z-index over
  its neighbours, and **every corner rounded again** (a fused row has
  squared the edges facing a hot gap; lifted, it has left the cluster, so
  square corners on one side read as a glitch). On laptop it grows about
  its right edge so the tab's seam with the pane and the bridge hold, at
  5% (all of the growth goes leftward, and at 1280px 6% met the viewport
  edge; the laptop shell keeps 40px side padding for it, since `.app`
  clips at the viewport); the hero gets a lighter lift when the leader is
  picked. On a phone the lift comes off when the team page closes (`closeTeam`
  clears `picked`; until 2026-09-10 it stayed as a trace of where you had
  been, and read as a row stuck half-open). A
  FLIP move rides `--dy` inside the same transform, not an inline
  `transform`, so a lifted row keeps its lift while it slides to a new
  rank. (A player row came forward the same way while its breakdown was open
  under it; since 2026-09-10 a tap raises the player card instead, see
  "Roster rows".) **The lift shadows are pseudo-elements fading in**
  (`.row::before`, `.hero-wrap::before`, each element `isolation:
  isolate` so the z -1 pseudo stays in its own stack): a transitioning `box-shadow` repainted its blur every
  frame and stuttered on phones; the easing is a plain decelerate
  (`cubic-bezier(.2, .8, .2, 1)`, .45s, the panel's height tween in
  step), no overshoot. **On laptop the leader's hero is the load's own
  zoom**: `boot()` opens it unpicked (`openTeam(id, false)`) and
  `pickOnLoad()` lifts it once the cascade ends, since the cascade
  animates the same transform and a lift set earlier snapped in when
  the cascade's class came off. Reduced motion lands every lift at once.
- **The leader card sits flat on phones** (2026-09-12): for two days it
  leaned toward the viewer (perspective with a degree or two of rotateX
  and rotateY, a 1.2deg italic skewX, and a thick two-step edge on its
  right and bottom from offset box-shadows) under 1024px; Shakeel had it
  taken off, so the hero is the same flat card on every screen, and the
  pick lift is the plain rise. The hero
  strip's tier chip shows only for a coin flip or a close gap ("Settled"
  and "Not started" said nothing), and the "11 franchises" count under
  the capsules is gone (`.standings-head` stays, empty, as a cascade
  target).
- In dark the hero has **no border and no inset highlight** (`--hero-border`,
  `--hero-shadow`): its gradient fades to near-canvas, so either reads as a
  stray outline. Light keeps both.
- **Accent is mint** and carries "live / on now", the selected segment and the
  leader's badge -- never urgency. Urgency is a separate warm scale:
  `--gap-critical` (< 0.25, coin flip) -> `--gap-live` (< 3.0, close; was
  2.5 until 2026-09-09) -> `--gap-settled`. Rows adjacent to a hot gap
  **fuse into one card** (per-edge radius, shadow dropped); the rank
  takes the hotter of its two gaps. **Board rows are the manager's
  standings rows** (2026-09-24): the rank in display numerals ("02"), the
  franchise's mark, the name in 24px display capitals (20px on a phone,
  wrapping, never an ellipsis), the record chip and In/Out chips in the
  display face on 6px corners, the status in Barlow capitals, the score
  at 32px, a hairline round the card (an inset shadow, dropped on fused
  rows) and no chevron. A settled rank is the plain numeral; a close or
  coin-flip gap fills its rounded tile in the tier's colour, so the
  tiers stay as loud as the circle was. **The divider's pill is the number
  alone, and a close gap pulses** (2026-09-09): the "Coin flip" word came
  off the pill, and instead a ring breathes out of it (`.gap.live
  .pill::after`, transform and opacity only; faster and red for a coin
  flip). **A close gap between two franchises that are done holds still**
  (2026-09-14; `done`: begun, nobody on the field, nobody yet to play;
  `.gap.still` drops the ring): it keeps its colour and still counts
  for the capsules, since it is still a close gap, but the pulse says
  "this could move" and nothing on either side can. **A gap between two franchises that have not begun is idle**
  (`gapTier`, `started`: nothing scored, nobody on the field, no starter
  kicked off): a plain divider with its 0.00, no pulse, no fusing, no
  rank colour, and it counts for no capsule; the hero's tier chip reads
  "Not started". Early in a week most of the board is 0.00 against 0.00,
  and a red "Coin flip" under every one of them said nothing. The tiers
  are computed once per render into `gapTiers` and read everywhere.
- **Position chips** use `--pos-qb/rb/wr/te/k/lb`; every defensive position
  maps to `--pos-lb`, matching the league's "3 IDP, any combination" rule.
- **A franchise's status names who is on the field** (2026-09-09): its
  live starters by last name in lineup order, two of them and a count for
  the rest, "Mahomes, Kelce +3 · on now" (`onNowNames`, `lastName` drops
  Jr./III suffixes); the red-zone pill takes the place of "on now" as
  before. "11 to play · on now" said nothing about which starters were
  playing. "N to play" still shows while none of them is on, and "all
  played" once every game is. **"On now" is checked before the count**
  (2026-09-14): MFL's `playersYetToPlay` counts starters whose game has
  not kicked off, so it is 0 while a franchise's last starters are
  playing, and on the Week 1 Monday night every franchise with a DEN or
  KCC starter read "all played". **A starter ruled doubtful, out or
  inactive is not on now** (2026-09-17, `sidelined` / `onField`): Sleeper's
  injury status of Doubtful, Out, IR, PUP, Sus or NA takes him out of the
  names, the "on now" and the RZ count, though his game is on; his row,
  clock and points are untouched. The statuses come from
  `fetchBoardStatus`, one batched `get_player` query for every live
  starter every three minutes while games are on (into `rosterStatus`,
  keeping the open team's news dates), so a mid-game ruling shows within
  a few minutes of Sleeper posting it.
- **Roster rows** are grouped by position in lineup order (QB, RB, WR,
  TE, K, IDP), and **within a position the order is fixed for the week**
  (name, then id; 2026-09-08). It used to be points, so two backs swapped
  rows whenever one overtook the other, and tied rows (0.00 before
  kickoff) fell back to MFL's array order, which is not stable between
  polls. Each group is opened by a shallow separator: a label in the
  position's colour (Barlow Condensed 14px since 2026-09-24) and a
  hairline to the right. **Each row is the manager's photo row**
  (2026-09-24, the redesign; mfl-manager's "the player row, redesigned"):
  a card of its own on `--surface-raised`, radius 18, the headshot as a
  60x68 photo on the club's two colours (`--tc1`/`--tc2` set on the row
  from `TEAM_COLORS` by `teamVars`; a radial of the second over a dark
  linear of the first) clipped in `.pphoto` so the TD chip and the club
  mark (a white disc, bottom-left) sit on its edges, the position chip
  over the name in 24px display capitals with the first name quieter
  (`nameHtml`, `.fn`), TEAM · clock and the stat line under it in Barlow
  capitals (wrapping, never an ellipsis), the points at 30px. A phone and
  the laptop pane take the manager's smaller cut (52x60, 20px, 24px), so
  the pane no longer fits twelve starters and scrolls with its fade. The
  roster is a flex column and its children are `flex: none`: in the
  pane's fixed-height scroll box the rows otherwise shrank and the stat
  line hung out of the card. When the pane's
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
  **Each row opens the player card** (2026-09-10; from 09-08 to 09-10 a
  breakdown expanded under the row instead): the row is a button (tap,
  Enter or Space; `role="button"`) and raises `#pcard` over the page, the
  shape of the draft assistant's player card. A hero band in the team's
  colours (`TEAM_COLORS`, the touchdown card's table; the club mark
  ghosted behind the headshot; dark in both themes, as Sleeper's own
  card is) carries the name, the franchise and week as a kicker, the
  position and, when Sleeper has one, an **injury chip** (`get_player`
  on `sleeper.app/graphql`: status and body part, Out/IR red,
  Questionable/Doubtful orange), then two vitals: the points (rolling,
  on the row's own tween key: the card is among `liveNumberEls`) and the
  game, which is **the game strip itself**, restyled for the dark band
  (a "Game" text vital and a "This game" section and a Lineup vital were
  cut the same day as redundant). Under it, one column: the stat tiles
  (`tilesHtml()`, `statTiles()`: the position's core counts always,
  zeros muted, the rest once they count, a rate where the volume
  supports one; "No stats yet" / "Game not started" / "No stats until
  kickoff" when there is no line) and then **the latest news** (`get_player_news`, the
  same RotoWire, FantasyPros and RotoBaller items Sleeper's app shows;
  the six newest, each with title, source, age, description, analysis
  and a link to the source, since that attribution is the condition of
  using the feed). Both Sleeper calls go straight from the browser (the
  endpoint answers with `access-control-allow-origin: *`), once per
  open, remembered three minutes (`profiles`), never on the poll; a
  failure reads "Couldn't load the news" with a news search link. On
  the Week 1 opener the in-game items (questionable to return, ruled
  out) landed 25 to 80 minutes after kickoff, so the card explains a
  quiet stat line within the half hour, not the minute. **RotoBaller's
  `published` is Eastern wall-clock written as UTC** (its "exits the
  game" item read an hour before kickoff; RotoWire's came four hours
  after), so `newsItem` shifts it by Eastern's offset at that instant
  (DST through Intl) and the list sorts on the corrected time. A poll's
  re-render refills the hero and the game from the current roster
  (`refreshPlayerCard`, called by `renderTeam`, reading `teamView`, the
  open team's last render) and leaves the news alone; the card is keyed
  by the player's tween key (`pcKey`). **A bottom sheet on every
  screen** (2026-09-11): from 600px up it is cut after Sleeper's own
  desktop player card, three quarters of the window wide and 84vh
  tall, centred in the viewport (it sweeps up from below the bottom
  edge, `translateY(calc(50vh + 50%))`; flush to the bottom for a day):
  the band with a 150px portrait
  over the club mark ghosted large, the name at 44px (66px, upright
  Barlow Condensed, since 2026-09-24: the manager's "second look" taken
  back so the two ports match again, with its game strip a size up in
  the display face), a white **team
  pill** (mark and code, `.pc-team`) and the position chip in the sub
  line, the vitals in large figures (the game strip as wide as its
  content, not the row), and **the close button in the
  band's top-right corner on every screen** (a name tab on a dark strip
  along the top, "J. Gibbs" with the button beside it, lasted a day: it
  put the button somewhere else than on the phone; the team's colours
  still sit on the sheet, `--pc-ground` / `--pc-accent`), then the body
  in two columns under **display headings on ruled rows** ("This game"
  / "Game log" / "News"): **this game as a box score** (2026-09-11;
  a grid of rounded tiles before, which read as boring: `cardStatsHtml`,
  `CARD_GROUPS`) and under it the game log
  left (the tiles stay, the log scrolls on its own), the news right
  scrolling on its own behind a hairline with its heading sticky; the
  four sections are flat siblings placed by the grid, so the phone can
  stack them; **the news copy is pure white in dark and pure black in
  light** (`--news-ink`, for reading; the muted greys were hard going)
  at 15px, the analysis at 14px; each story titled at 18px
  over a bordered **date pill**, "Sep 2, 6:56 PM via RotoWire"
  (`whenLabel`, the reader's clock; the row badge's tooltip keeps
  `timeAgo`). A centred 600px card before; a two-column cut at that
  width had lasted a day, the stats beside a lot of nothing, and at
  this width they have company. Under 600px the phone's sheet, full
  width and 90dvh, one column, the band staying put and the body
  scrolling, and **the news and the game log behind a pair of tabs**
  (`.pc-tabs`, News first, each label in the section heading's own
  type with the open one bright over an accent rule, pinned under the
  band while the body scrolls, which needs the body to carry no top
  padding (the tiles section carries it instead: a sticky element stops
  at its parent's content edge, and a line of text showed in the gap
  above the tabs) and the body never scrolls sideways (`overflow-x:
  hidden`); the sections' own headings hidden; the
  news open on every card, `pcPanel` reset by `openPlayer` (for a day the
  choice carried across cards); the copy a step up again here, 16px
  body, 15px analysis, 18px titles; there the
  log and the news need `min-height: auto`: at the laptop's 0 the
  grid's auto rows collapsed and split the body's height between them,
  and the log painted over the news). **The game log** (`gameLogHtml`)
  is every week of the season in Sleeper's manner: the opponent and
  the NFL result (W/L and score, W in mint, L in the coin-flip red)
  from ESPN's team schedule (`teamSchedule`, `site.api.espn.com/...
  /teams/<abbr>/schedule?season=`, CORS open, one call per team held
  ten minutes, the bye from its `byeWeek`), the player's line for the
  week from Sleeper's per-player season (`api.sleeper.com/stats/nfl/
  player/<id>?...&grouping=week`, CORS open, in `profileOf` as `log`),
  the points under the league's rules (`Scoring.scoreLine`, the same
  number the page shows on a game day; `mockup/scoring.js` is a copy
  so `poc` can) and the snap share (`off_snp` / `tm_off_snp`, the
  defensive pair for IDP), then the position's groups (RB rushing and
  receiving, QB passing and rushing, WR/TE receiving and rushing, K
  kicking, IDP defense) as a table with group headings over the
  columns, the current week's row raised, a week with a game and no
  line dashed, the bye named; without the schedule the weeks Sleeper
  has, with no result. **On a phone the log is a list, not the table**
  (2026-09-11): a week to a row with the opponent, the result and the
  points across it and the roster's stat line (`statLine`) under them,
  "Did not play" for a final game with no line; `gameLogHtml` renders
  both and CSS shows one per width (the table scrolled sideways on a
  phone, and the body with it, which read as broken). Team codes are mapped both ways (`ESPN_ABBR`,
  `TO_MFL`: Sleeper's and ESPN's SF/NE/GB/KC/TB/NO/LV/JAX and ESPN's
  WSH against MFL's). `SEASON` comes from the proxy's answers (every
  one names it; the fixture sets 2025). The table scrolls sideways in
  its own wrap with the week column sticky, which is how it fits a
  phone. It lands after the sheet like the news and sweeps in the same
  way. Context beside the number, like the news. **The box score** is
  the line's stats in the position's groups as rows (Rushing /
  Receiving, Passing / Rushing, Kicking, Tackles / Plays), a label at
  the left and the stats across (the group label above them on a
  phone), each a number over its label over a **bar scaled to the
  player's season high** from the same game log (`pcLog`, the season's
  other weeks; a full bar is a season best, a strict one tagged
  "· best", a mint marker on a phone): the bars are empty until the log
  lands (no other weeks, no bar: with the high falling back to the
  stat's own value every bar opened full and then "grew", 2026-09-11)
  and grow in then, once per card (`pcBarsGrown`; `fillBars` lays the
  empty bars out before widening them, so the transition is certain,
  and only that render's `.sbox.grow` carries a transition), and on a
  poll's refresh they land where they are. Which stats show is the old tiles' rule, the
  position's core always with zeros muted, the rest once they count.
  Week 1 has no season to scale against, so the bars stay empty. **The
  section shows only once the player's game has begun** (`gameBegun`:
  `gameState`'s `started`, or with no schedule entry a line or a clock;
  never pre-season): before kickoff it said "Game not started" under
  its heading, which was nothing to look at, so it is hidden
  (`.pc-game.off`) and a poll's refresh turns it on as the game kicks
  off. On `poc` a game has begun when it is on the field or has a line. **The card
  opens in two acts**:
  the sheet sweeps up from the bottom edge with the player's data
  (`translateY(100%)`, .52s; before, the laptop card rose a little and
  faded in), sweeps back down to close (.24s), and
  once it has landed (`PC_IN_MS`) the news sweeps in from the left
  (`sweepIn`, a clip-path wipe with a nudge, `NEWS_WIPE_MS`): the
  stories themselves when Sleeper has already answered, the three ghost
  stories (`NEWS_SKELETON`, a highlight shimmering left to right along
  them, a bar of accent sweeping under the News heading while
  `.pc-news.loading`) otherwise, and the stories then sweep over the
  ghosts when they land (`showNews`: the ghosts cloned into a
  `.pc-news-ghost` overlay wiped out on the same front, nudged off ahead
  of it), never before the ghosts have finished arriving. The list
  waits clipped to nothing (`.pending`) until its sweep, so nothing
  paints before its cue; the body has no entrance of its own. It leaves
  the way it came. Reduced motion lands each act at once. **The phone's
  slide is the sheet's transform alone** (2026-09-10, it
  stuttered and jumped): the scrim's blur is off, the sheet rides its
  own layer, and **the phone sheet is a
  fixed height** (90dvh): a content-sized sheet slid up by its own
  height and then grew when the news landed, and holding the news back
  until it had landed only turned the jump into a snap; both sheets
  are a fixed height now, so nothing grows. The row has no
  chevron (removed the same day; the tap is the affordance), and a row
  whose team has no schedule entry shows no game label ("Not started"
  crowded the phone row). The scrim, the close button or Escape puts it away with focus back on
  the row, and `closeTeam` closes it too. **On a phone a finger dragging
  down closes it** (2026-09-10): from the band (a grab handle at the top
  of the sheet says so; `touch-action: none` there so every move is ours
  to cancel) or from the body while it is scrolled to the top, the sheet
  follows the finger and the scrim dims in step (the drag scrubs a paused
  Web Animation on each, since the entrance's fill would override an
  inline transform); let go past a third of the sheet or with a flick
  (`SWIPE_CLOSE`, `SWIPE_FLICK`) and it slides the rest of the way and
  closes (a timer backs the finish: a backgrounded tab never finishes an
  animation); short of that it springs back. A drag that starts upward
  or in a scrolled body is a scroll and is left alone. Still context
  beside MFL's number: nothing on the card feeds a score. **Rows wear
  badges by the name** (`rowBadges`): Sleeper's injury status (Q and D
  orange, OUT, IR, PUP, SUS, NA red, the body part in the title) and a
  newspaper while there is news from the last day (`NEWS_FRESH_MS`).
  They come from `rosterStatus`, filled by `fetchRosterStatus` when a
  team is rendered and every three minutes while it is: one batched
  GraphQL query with an alias per player for `get_player` and
  `get_player_news(limit: 1)` (about a second and 2KB for twenty
  players), re-rendered through `rerenderSoon`. The card's injury chip
  reads the same map before its own fetch lands. **The game
  strip** heads the game (`gameStrip()`): away @ home with both scores once kicked off
  (from `nflSchedule`'s per-team `score`, kept on each `games` entry as
  `match`), the player's team bright, a football after the score of the
  side with `hasPossession`, RZ in the coin-flip red for `inRedZone`,
  and the state on the right: kickoff day and time before the game
  ("MIA at PIT"), the player's own clock from liveScoring while on, or
  Final. The fixture fallback has no schedule, so no strip.
  `spike/fake-round.mjs` stages the home side with the ball in both
  live games and in the red zone in the first, so `app-2025-w15-live`
  shows every RZ marker.
  **The red zone and the ball come from ESPN, not MFL** (2026-09-09,
  the Week 1 opener): MFL's `nflSchedule` carries `hasPossession` and
  `inRedZone` per team, but consecutive calls that night returned
  different snapshots (a team in the red zone at 6 points, then at 7
  with the other side in possession, then both sides in possession, all
  during halftime), so the flags cannot say who is in the red zone now.
  The proxy's **`situation`** type reads ESPN's public scoreboard
  (`site.api.espn.com/.../scoreboard`, no key, held 15s, 5s timeout;
  ESPN's abbreviations mapped to MFL codes in `ESPN_TO_MFL`) into one
  record per game keyed by both teams: state, period and clock, NFL
  scores, who has the ball, the ball spot ("SEA 24"), down and
  distance, the last play, and a red-zone flag the proxy derives from
  the spot (ESPN's own `isRedZone` is also up during the kickoff after a
  score, with nobody in possession): `yardLine` is yards from the home
  team's goal line, verified that night, so the home offense is in at 80
  and beyond, the visitors at 20 and under, and no possession means no
  red zone. It comes with every poll while games are on (a part of the
  tick, applied by `applySituationBody`; `fetchSituation` is the fallback
  beside the poll); `sitOf(tm)` hands it out
  while under two minutes old, after which the page falls back to MFL's
  flags. **A situation counts only for the game the schedule has for
  the team** (2026-09-16, `sameGame`; the proxy stamps each record with
  ESPN's `kickoff`, which matches MFL's to the second): ESPN's
  scoreboard is always the current week, and once it rolled to Week 2
  its "pre" games were laid over Week 1's finished clocks on a `?w=1`
  page, so the week read as started and not final, `doneTeams` came
  out empty, every starter fell back to Sleeper's estimate, and
  `gamesOn()` polled every 15s for it. A staged situation with no
  kickoff, or a team with no schedule entry, is taken as it comes. `inRedZone` is then "my team has the ball and ESPN says red
  zone"; the game strip takes the ball, RZ, NFL score and the clock from it
  and adds a line with the down, distance and spot (`.pg-spot`), and
  **the last play under that** (2026-09-15, `.pg-play`: ESPN's text,
  "(Shotgun) J.Gibbs right tackle to SEA 45 for 12 yards (D.Reed)." with
  the formation and the full stop dropped, `playText`). **A live roster
  row carries the last play when it names the player** (`.pplay`,
  `lastPlayOf`, in the accent under the stat line: his initial and last
  name as ESPN writes them, `playNames`, the tackler in the brackets
  included so an IDP's tackle reads on his row; a name never starts right
  after a period, since "A.St. Brown" also reads as S. Brown, 2026-09-17; on his own row a leading
  "J.Warren " comes off so the play reads as his; the whole play, however
  many lines, since 2026-09-17: it was cut at two lines on a phone and one
  in the laptop pane) and drops it when the next play names someone
  else. The board narrates. **A franchise's row and the leader's hero
  carry the play too** (2026-09-17, `feedPlays` / `playLine`, `.tfeed`
  under the "on now" names): the last play naming one of its live
  starters, the starter's last name in the accent before it, so a phone
  gets the real-time feel without opening a roster. On a phone the whole
  play shows (2026-09-17; it was cut at two lines and lost the yards);
  the laptop pane keeps two lines. Its text is trimmed either way (`shortPlay`; the roster row and the
  game strip keep ESPN's words): tacklers in brackets go unless one is
  the franchise's own, "pass short right to" is "pass to", and the ball
  spot before the yards goes ("to MIN 22 for 9 yards" is "for 9
  yards"), so it reads short. Plays from different
  games that land in one poll queue per franchise (`feeds`), each held
  `PLAY_DWELL_MS` (5s) before the next sweeps over it, three at most; a
  play naming two of its starters is one item with both names. A play
  stays up while it is its game's last play (`playStands`) and folds away
  after. The first opens its line and sweeps in left to right behind a
  soft accent gleam (`.tplay.new`), a replacement sweeps over it
  (`.swap`); `--el` carries a sweep through a re-render instead of
  replaying it, and a queue advancing between renders patches the line
  in place (`patchFeed`). Plays are keyed by ESPN's id and text
  (`playIdOf`), so a play revised on review comes round again. **Every
  player's clock, "live" and "final" follow the situation too**
  (`sitSecs`, first in `secsOf`; `overlaySituations` lays it over the
  schedule's game clocks so the day's and week's final follow ESPN's
  whistle): liveScoring's per-player clock refreshes with the points on
  MFL's cycle and sat on "Q4 0:26" for ten minutes after the opener
  ended, until MFL marked the game final. Context only:
  nothing from ESPN touches a score, and `spike/` has nothing on it,
  because a fantasy point never depends on it.
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
  headshot (as on the spotlight and touchdown cards; on the photo row a
  white disc in its bottom-left corner), a mint **TD** chip on
  the headshot's top corner for anyone who has scored (counted from the
  stat line, so a simulated touchdown adds it live), a **gold sweep** on
  the team's top-scoring starter (the spotlight's wave in gold, plus a gold
  ring; wins over the live treatment), and
  a live treatment for players still on the field (mint headshot ring,
  soft mint wash fading across the row). On the photo row the rings
  (mint live, gold top, red red-zone) go round the photo.
- The team page is a full-screen route over the board (`position: fixed`),
  so the board keeps its scroll position. **The back button closes it on
  a phone** (2026-09-11): under 1024px the page pushes a history entry
  as it opens and the player card another (`navPush`, `teamPushed` /
  `cardPushed`; the URL never changes, so nothing reads a different
  week), and `popstate` closes the topmost, so the browser's back
  button, the system back gesture and the edge swipe all step back
  through card, page, board. A close from the page's own controls
  (Standings, the X, Escape, the swipe down) pops its entry silently
  (`navBack`, `navSkip` swallows the pop it fires), so the history never
  fills with stale entries; `closeTeam` pops the card's and the page's
  together. The laptop pane is a selection, not a navigation, and
  pushes nothing, the card there included. A state left over from a
  refresh is cleared at script load. **From 1024px up** the shell is a
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
  changes surface; **player keys carry the MFL id**, `playerKey`, since
  2026-09-09: they were the slot number, and MFL reorders its player array
  between polls, so a flash, roll or chip landed on whoever sat in that
  slot next, playing or not), team and player scores pop a floating delta chip, rows
  that change rank slide to their new slot (FLIP on the row elements, keyed
  by franchise id), and clusters re-fuse. **A roll survives a re-render**
  (2026-09-09, seen on the Week 1 opener): `snapshotShown` records what
  each key shows *and* the value it last settled on (a roll in flight
  keeps its target in `tweens`), so a render mid-roll, which is what the
  stat lines landing beside the poll did, no longer reads the half-rolled
  number as a change and rolls it again to the same total with a chip
  for the remainder. An unchanged key with a roll in flight carries on in
  the rebuilt element on its own curve; a changed one chips the delta from
  the settled value. One frame loop per key drives every surface showing
  it. The stats re-render itself now waits out the last render's flash
  and rolls (`renderedAt`, 1s) instead of landing over them. **Every
  live number is collected once** (`liveNumberEls`, 2026-09-14): the
  team page sits inside `#app`, so its numbers matched both selectors,
  and a render landing while a roll was in flight (the stat lines or the
  situation beside the poll) read the half-rolled text on the second
  pass as a new value against the roll's target and popped a chip for
  the difference, red on a gain, beside the true chip. Seen as "the
  chip is red when a player scores". **Open (2026-09-17): on a Brave
  home-screen app on Android a static score sometimes rolls back to its
  own value every 30s-1m**; Chrome's app and the Mac are fine. Not
  reproduced. Suspect: a roll's start is `performance.now()` but its
  frames read the rAF timestamp, and if those drift (a page frozen and
  resumed, which Brave's saved-tab apps do often) the roll never reaches
  `TWEEN_MS`, stays in `tweens`, and every render's "unchanged" branch
  rejoins it from its old `from`. Fix if it comes back: use
  `performance.now()` inside `frame`, rejoin only a roll still inside
  `TWEEN_MS`, and a timeout that lands the final value if frames never
  come. First rule out stale code (swipe the app away and reopen; a
  Brave app can run a days-old copy). The "Simulate live scoring" toggle under the
  footnote exercises this by bumping one starter at a time -- it is a mockup
  affordance, not a feed, and it keeps team total == starters sum.
- **Lead change** fires a takeover on the hero (mint strobe, lightning
  bolts, diagonal sweep, badge spin, name rise; ~1.6s) and the ex-leader
  fades into the list at #2. "Flip the lead" hands #2 just enough to pass
  #1 so the sequence can be seen on demand.
- **Touchdowns** raise a celebration card over everything: headshot with the NFL team
  logo badged on it, TOUCHDOWN slam, franchise, points. **The franchise
  reads at a glance** (2026-09-11; it was a 13px line): a micro "for"
  over the name at 20px in the display face, which rises in once the
  headline has slammed and the portrait popped (.5s), and an accent bar
  (the team's accent on a team-coloured card) that draws under it a beat
  later; on the Bears card both wait for the chant to finish (1.95s), so
  nothing competes with it. Same on `poc`. It
  stays 4s; further scores queue in arrival order ("+N more") and each gets
  its own card. Tap the scrim or Escape to skip. **Starters only:** a
  bench touchdown moves the row in the Bench tab and the "behind" total,
  never the franchise total, and gets no card (the gate is liveScoring's
  per-player `status: "starter"`; the simulator scores bench TDs now and
  then to exercise it). **The card wears the scorer's team colours**
  (2026-09-08): `TEAM_COLORS` in `app.js` gives every team a dark ground
  and a bright accent by MFL code (`--td-ground` / `--td-accent` on the
  modal, `.td-team`), and the card is ground with an accent glow, flash
  and rays, an accent-and-white portrait ring, accent points and bar;
  every alpha is a `color-mix` of the two, so any pair works. Grounds
  are the team's darker colour so white text reads; a dull brighter
  colour (Ravens gold, Giants red) is lifted a shade. Literal on purpose
  and identical in both themes; only the scrim differs, a darkened tint
  of the ground (76% in dark, 52% in light) so a red or blue ground dims
  the page rather than painting it. A free agent keeps the theme's own
  card. **The Bears sit a tier above every team** (`.td-chi`): BEAR
  DOWN! stomping in letter by letter, orange with a navy trim, and the
  whole screen joins in: an orange strobe over the page on entry, orange
  rays turning at page scale behind the card with a breathing orange
  halo under it (the scrim's pseudo-elements, opacity and transform
  only), the card rumbling as the letters land, its own rays brighter
  and faster, an orange glow on TOUCHDOWN, and a 5.5s hold
  (`TD_CHI_MS`) against 4s. Under reduced motion the page strobe is
  hidden, not frozen (a static one is a solid orange sheet). "Bears
  TD" on the demo bar triggers one; on `main` `?td=<team>` raises a card for that team's first
  starter once the board is up (any starter when the team has none),
  and `?theme=light` stamps the light theme on load, both for checking. In the mockup a TD is a
  simulated event (6 + yardage); with the feed, the trigger is ESPN's
  play naming a starter's touchdown (see "What is already settled").
- **Spotlight card** under the hero, a between-days card: once a day's
  games are all final it shows that day's highest-scoring *starter*
  (headshot, logo, stat line, franchise, points) and goes away when the
  next day's games kick off; once the week is final it turns gold as the
  MVP of the week and stays until the next week begins. While a day is in
  progress (the mockup's opening state) there is no card. **On `main`
  the days come from the schedule** (2026-09-08; before that the card
  only ever appeared once every game of the week was final, labelled
  Sunday): `dayTeams.days` groups the week's games by their NFL date
  (Eastern, through Intl, since a Sunday afternoon kickoff is already
  Monday in Karachi), a day has started when its first game has kicked
  off and is final when every game on it has ended (`dayStates`), and
  `spotlightEntries` lists every finished day's top starter, labelled
  with the weekday, while no day is in progress, and the MVP of the
  week after them once the week is final; the card lands on the newest
  and **a pill per entry flips through them** (2026-09-11; `spotIndex`,
  `.spot-tab`, `flipSpot`, only there with more than one entry): the
  shown day lit in the accent, the MVP's in gold with a star, the rest
  muted; short labels under 600px (Thu, Sun, Final), a swipe across the
  card (left for later, right for earlier) and the arrow keys flip too.
  A pair of small arrows around the day pill lasted the morning: too
  faint to find. **The kicker ("Top scorer", "MVP of the week") is the
  title's own italic 900 caps at 16px and the pills' text is the reading
  ink** (`--news-ink`, pure white in dark and pure black in light; the
  micro grey was hard to read on the card); the MVP's kicker stays gold.
  **Since the redesign (2026-09-24) the card is in the rows' capitals**:
  the kicker in the italic 800 at 24px (20px on a phone), the pills as
  the manager's week pills (32px, 9px corners, display capitals, a
  hairline outline, the shown one filled, the MVP's gold on `--gold-ink`),
  the scorer's photo on his club's colours with the club mark in its
  corner (the rows' `.pphoto`; the MVP's ringed gold), the name in 28px
  display capitals with the first name quieter, the position, team, stat
  line and "for <franchise>" in Barlow capitals, the points at 44px.
  On a phone the MVP kicker is wider than the pills leave room for, so
  the row wraps and the pills sit under it (`.spot-top` wraps). A flip re-renders with the body's own
  rise and no reveal, and gold only for the MVP entry; a new day's card
  lands on the newest again, and a poll's render leaves a flipped day
  where it is. The fixture's entries are Thursday's and Sunday's; on
  `poc` Thursday's, Sunday's and the MVP. **The Bears rule** (2026-09-14,
  Shakeel's call the night Josh Allen and Caleb Williams tied at 43.43):
  a tie for a card's top goes to the Bear (`isBear`, MFL code CHI), and
  a Bear over 40 points (`BEARS_MVP`) is the MVP of the week outright,
  whoever scored more; the day cards get the tie rule only. Rehearsed on
  `app-2025` `?w=12` by handing a Bear the top's points and then 40.5
  (until 2026-09-16 the archive's Sunday read unfinished there during a
  live game, ESPN's current situation laid over the 2025 clocks; a
  situation now counts only for the schedule's own game, see
  `sameGame`).
  **Quinn is the MVP of Week 2** (2026-09-18, Shakeel's surprise): 3rd
  and 1's son takes the Week 2 (2026) MVP slot once the week is final,
  whoever the NFL sent (`QUINN`, `quinnWeek` in `app.js`; his photo is
  `app/quinn.jpg`, the league mark his badge, 6 REC, 2 TD, 1 pick six,
  24.00 under the rules); the day cards stay real. `?mvp=quinn` shows him
  on any finished week. Rehearsed on `app-2025` `?w=12`.
  The week is final once
  every game is (`slate.weekFinal = slate.sunFinal`; MFL's "official"
  mark is not read, the same rule the playoffs use), which turns the
  card gold and the leader hero into the Week winner; both clear when
  MFL rolls liveScoring to the next week and the new schedule has
  nothing final. The fixture has no schedule, so it keeps the staged
  slate (`THU_NFL`, everything else Sunday). **The card's entrance** (2026-09-11, from `poc`): a day's
  last whistle used to pop it in; now the space opens first, slowly,
  from the top down (`revealSpotlight`: the card's height tweened from
  nothing over 1.6s, the rows below easing down), and only then does
  the scorer come into view a piece at a time (`.spot.reveal`, `--i`
  per piece, 140ms apart; the body's own rise is pinned off for that
  render, since it replayed as a second flash when the class came off).
  The MVP of the week gets the same: the full opening when it arrives
  from nothing (a Monday night, the day and the week final together),
  the reveal alone when a day's card turns gold in place. **It runs on the first visit after a day's end and on a load or a
  refresh** (2026-09-11): a card present when the page loads waits
  under the loader and opens once the board has cascaded in
  (`spotQueued`, `boardReady` at the cascade's end, so the cascade never
  counts it). A return to the tab leaves it be (2026-09-12; for a day a
  card showing when the tab came back after a minute away opened again,
  and the replay wore thin). A new
  day's card replacing another opens too; the MVP turning gold in place,
  or a corrected top scorer, gets the reveal alone. A poll's re-render
  leaves the card alone while the reveal runs (`spotRevealUntil`).
  Skipped under reduced motion. A soft colour wave drifts across its background (accent, gold
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
  load for checking; on `poc` the demo bar has a button. **Only Escape
  skips it** (2026-09-08): a tap anywhere used to end it, and a stray
  tap on a full-screen takeover is far likelier than a wish to skip it,
  so the overlay ignores clicks; the touchdown card keeps its
  tap-to-skip. Literal red in both themes; reduced motion holds the card
  alone for 3.5s.
- The **Demo bar** and simulator, the legend and the footnotes exist only
  on the `poc` branch. Its "View" tags (added 2026-09-05) switch the
  mockup into the postseason views described above (`mockup/playoffs.js`
  is a copy of `app/playoffs.js`; keep them the same), seeded from the
  real 2025 season and folded from the board's own points; see the `poc`
  branch's CLAUDE.md. On `main` they are removed, along with the subtitle
  line; in season the subtitle slot shows "Updated <time>", the time a
  number on the page last changed from either feed (`stampUpdated`;
  MFL's snapshot by `snapshotSig` in `refreshLive`, since the export
  regenerates on MFL's ~200s cycle and most polls bring the same body
  back, so a poll-time stamp read fresh while the scores stood still).
  **While a game is on it is an age that ticks** (2026-09-15, `#age`,
  `syncAge`, one 1s timer): "Updated 12s ago" counting up says the page
  is awake and how long the board has stood; a frozen board would
  visibly stop counting. Off the field it is the time again ("3h 12m
  ago" says nothing).
- **The footer is a disclaimer** (`.foot`, 2026-09-11, the one footnote on
  `main`): live scores are approximations, the best guess from real-time
  stats while games are on, and the day's finals are tallied from MFL as
  the source of truth, and if anything is off, blame Hoss, our commissioner
  (Shakeel's line, 2026-09-11). Last child of the layout shell: under the board on a
  phone, spanning both columns on laptop. Small, in the reading ink
  (`--news-ink`, white in dark and black in light), every week.

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
an hour) and to `STAT_KEYS`, and holds the ~10KB result 15s (30s until
2026-09-15); the page
asks every poll while games are on (15s, as a part of the tick), once a minute otherwise, and
hands each player its line as `st`, so rows, the spotlight and the TD chip
read real lines, and the touchdown card's confirmation reads the same
lines. The fetch runs
**beside the poll, never in its path** (`fetchStats`: 5s timeout on the
proxy's Sleeper call, 8s on the page's, fresh lines applied to the
current rosters and re-rendered when they land), so Sleeper can never
delay MFL's numbers. Lines older than five minutes while games are on
read **"stats delayed"** in the subhead and dim (`body.stats-stale`);
lines that never arrived read "stats unavailable". Sleeper down means the
last lines stay, never a missing score: MFL's points are untouched. The drift finding above is why they
stay context: a line beside MFL's number, never feeding it. Headshots are
static files off the live path; a headshot cannot contradict a score.

## Which number is the number (2026-09-10)

Shakeel's call for the test games (Thu Sep 10, Sun Sep 13, Mon Sep 14),
and the league is told the numbers are unofficial until MFL's land:
**during a game day a player's points are his Sleeper line under the
league's rules**, `app/scoring.js` (a copy of
`fantasy-draft-assistant/public/scoring.js`, the fflr rules over
Sleeper's stat vocabulary, plus `scoreLine()`: exact mode, special-teams
tackles folded into the solo count, the measured better match), within
a minute of the play. **Once the day's games are all done and MFL has
closed his game** (`onOfficial`: the team is in `doneTeams`, the day's
teams from `dayStates`, and MFL's own per-player clock `p.secs` is 0,
which lands minutes after the whistle with the final points in the same
snapshot) **MFL's official points take over and stay.** `ptsOf(p)` is
the player's number, a franchise's `live` is the sum over its starters,
so ranks, gaps, records, the hero, the rolls, the spotlight and the
record chip's week all follow it; `t.official` keeps MFL's franchise
total for whoever wants it. A player with no line yet, or no Sleeper
join, is on MFL's number throughout. Nothing on the page says which
feed a number came from: no "S"/"M" secondaries (removed the same day
after one evening), and the subtitle is plain "Updated <time>", the
last time a number on the page changed from either feed. The "What is
already settled" section still holds for the official number: the
switch at day's end is exactly the reconciliation it asks for, and the
residue at the switch (a tackle MFL credits differently) is the
stat-correction the league expects. The proxy's `STAT_KEYS` carry every
key the engine reads.

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

**MFL's Live Scoring page and its liveScoring export round at different
steps** (2026-09-14): the export's franchise `score` is the sum of the
per-player scores after each is rounded to two decimals, while the site's
Live Scoring page sums the unrounded values and rounds once. Rushing at a
point per 7.5 yards is the only fractional rate, so the two differ by a
cent for about half the franchises on any week (6 of 11 on Week 1). The
page follows the export, which is what settles the week; a cent against
MFL's page is this, not a scoring difference.

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
