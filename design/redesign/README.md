# Handoff: MFL Live redesign ("Night Game" dark / "Paper Stadium" light)

Bring MFL Live into the design system MFL Manager was rebuilt in (its
`redesign` branch, 2026-09-23/24), so the two apps read as one product.
Written 2026-09-24 from the manager as built, not from its original
handoff: the manager changed a good deal in review (Barlow Condensed
replaced Anton, the chrome follows the theme, a motion layer was added),
and this document records where it landed.

## Getting started

The branch exists: `redesign`, cut from `main` at `886de28`, with this
folder on it.

```bash
cd ~/projects/mfl-live
git checkout redesign
git push -u origin redesign      # first time only
```

Then open Claude Code in the repo and say something like:
*"Read design/redesign/README.md. Apply design/redesign/tokens.css and the
fonts first, then restyle app/ one surface at a time in the order under
'Working order'. Keep every behaviour in app.js exactly as it is."*

Production is untouched: Netlify publishes `main` only
(`allowed_branches`), so nothing on this branch reaches
<https://mfllive.netlify.app> until it merges. For a preview, see
"A preview site" below.

## What is in this folder

- `README.md`: this handoff.
- `tokens.css`: the redesign's colour, shape and type tokens under MFL
  Live's own names, both themes, ready to paste over the top of
  `app/styles.css`. It also says which of MFL Live's tokens to keep.
- `reference/manager/`: the finished MFL Manager redesign, captured
  2026-09-24 from its preview (Home at 1440px dark and light, 390px
  dark). **This is the target look.** The manager itself is the live
  reference: <https://mfl-manager-2.up.railway.app> (the `redesign`
  branch) and its source at `~/projects/mfl-manager` on `redesign`.
- `reference/live-now/`: MFL Live as it is today (the board at 1440px
  dark and light, 390px dark), for before-and-after.

There is no HTML prototype this time. The manager is the prototype: every
component below exists there, working, in both themes and at every width.
Where this document gives a number, it is the manager's
(`app/styles.css` on its `redesign` branch). Where it says "as the
manager's X", open that block and copy its rules.

## What changes, and what does not

**The palette barely changes.** MFL Live's palette is where the redesign's
came from (mint accent, blue-black ground, teal-to-violet, gold, the warm
urgency scale). Of the 65 colour and shape tokens both apps name, 15
change in dark and 5 in light: hairlines a touch stronger, simpler
shadows, white on the red coin-flip pill, a darker muted grey in light,
and two radii. `tokens.css` marks each change.

**What changes is the type, the shape and the components:**
- Archivo and Nunito give way to **Barlow Condensed** (display) and
  **Barlow** (data and reading).
- Headlines go to Barlow Condensed's heavy italic, uppercase and huge.
- Names and numbers that matter go to Barlow Condensed in capitals.
- Pills go from fully round to rounded rectangles (10px).
- The masthead becomes a floating chrome bar.
- Buttons all speak in one voice (display face, capitals, .04em).
- Player rows become the manager's photo rows.

**What does not change. These are MFL Live's rules and the redesign keeps them:**
- **The gap is the loudest thing on the board.** In all-play the points
  between two ranks are worth a full win. The gap pills, the fused
  clusters, the tiered rank circles and the pulse all stay, and stay
  loud. The new type must not out-shout them.
- **Mint means live / on now / selected, never urgency.** Urgency is the
  warm scale (`--gap-critical` < 0.25, `--gap-live` < 3.0,
  `--gap-settled`), unchanged.
- **Gold never sits on the blue** (`--hero-bg-gold`). It still reads as
  the Packers.
- **Dark-first:** bare `:root` is dark, `[data-theme="light"]` the
  override, and the page never follows `prefers-color-scheme`.
- Every behaviour in `app.js`: polling, rolls, FLIP, the touchdown rules,
  the playoff fold, the Pro Bowl, the holidays, the Bears. This is a
  restyle.
- **The phone is the main screen.** MFL Live is watched on a phone during
  games, one screen, polled every 15 seconds. The manager's scroll
  showpieces (the hero video, the parallax, the marquee) are not for it.
  See "Motion".

## Type

Fonts (in `index.html`, replacing the Archivo + Nunito link):

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,700;1,800&family=Barlow:wght@400;500;600;700&display=swap">
```

Barlow Condensed is loaded in two cuts only: **upright 700** and **italic
800**. A `400` asked of it draws the 700, which is how the manager writes
it (`font: 400 24px/1 var(--font-display)`). Keep the two-cut load; a
third weight is a third download on a phone.

| Role | Today (Archivo / Nunito) | Redesign |
|---|---|---|
| The WEEK title, round names, the Bowl title | Archivo italic 900 | Barlow Condensed **italic 800**, uppercase, `clamp(56px, 11vw, 168px)/.86`, letter-spacing -.01em |
| The leader's name in the hero | Archivo italic 900 | Barlow Condensed italic 800, uppercase, `clamp(40px, 6vw, 72px)` (`fitName` keeps its floor, raise it to 28px) |
| Section and card heads ("Top scorer", "This game", "News") | Archivo italic 900 16px | Barlow Condensed 700, uppercase, 28px (the manager's `.card-head h2`) |
| Franchise names in the board | Archivo 700 17px | Barlow Condensed 700, uppercase, 24px (20px under 760px), `letter-spacing: .02em`, wraps and never ellipsizes (the manager's `.standings .name`) |
| Player names in rows | Archivo 700 15px | Barlow Condensed 700, uppercase, 24px, **first name quieter** (`--text-secondary`), so it reads "Caleb **Williams**" |
| Scores (board, hero, rows) | Nunito 800 | Barlow Condensed 700: hero `clamp(56px, 8vw, 96px)`, board 32px, row 30px |
| Gap pill numbers | Nunito 800 | Barlow Condensed 700 15px, .04em |
| Kickers and micro labels | Nunito 800 caps | Barlow 700, 11–12px, uppercase, `.12–.14em` |
| Sub lines ("ATL · Q4 15:00 · 21 CAR") | Nunito 600 | Barlow 600 12px, uppercase, `.06em` (the manager's `.prow.rich .sub`) |
| Reading copy (news, disclaimers) | Nunito | Barlow 400–500, 15–16px, `--news-ink` for news |
| Buttons, tabs, pills, segmented controls | mixed | Barlow Condensed, uppercase, `.04em`, 13–17px ("buttons, one voice" in the manager's styles.css) |

**Italic overhang.** An italic spills past its box on the right. Any
lettered title that paints through its glyphs (the WEEK drift, the Bowl's
iridescence) needs `padding-right: .12em; margin-right: -.12em` on the
painted element, or `background-clip: text` shaves its last letter.

**Tabular numbers.** Every live number rolls (`data-tween`). Keep
`font-variant-numeric: tabular-nums` on the root, and check it holds in
Barlow Condensed before anything else: roll a score at 32px and watch
that the digits do not change width. If they do, add
`font-feature-settings: "tnum"` to the number styles.

## Tokens

Paste `tokens.css` as described in its header. New names MFL Live has
not had:
- `--grad`: the league gradient.
- `--accent-text` and `--accent-line`.
- `--violet*`.
- `--dim`.
- `--chrome*`: the masthead.
- `--foot-mark`.
- `--radius-cta`.
- `--gutter`.
- `--gold-ink`.
- `--sheet`.

**The gradient means "the one that matters".** In the manager it marks
your row, the deadline card and the card bands. In MFL Live it is the
leader's hero (`--hero-bg` now reads `--grad`) and the player card's band
ground for a free agent, and nothing else. Once it is on everything, it
means nothing.

**Holidays.** The four holiday blocks at the end of `styles.css` set the
shared names already, `--hero-bg` included, so the hero keeps its holiday
colours. They need three new names each, or new components stay mint:
`--grad`, `--accent-text` and `--accent-line`. Derive each from the
holiday's own accent and hero.

## Components (shared with the manager)

### The masthead
A floating chrome bar, sticky 12px from the top, as the manager's
`.masthead`/`.chrome`:
- `background: var(--chrome)`, `border: 1px solid var(--chrome-edge)`,
  radius 14, `box-shadow: var(--chrome-shadow)`. Dark on dark, white on
  light.
- From 1024px it spans the window, 12px off each edge, over both columns.
- **Left:** the mark (`logo.png`, 32px, radius 8), then **MFL** in
  Barlow Condensed 26px and **LIVE** beside it in the live red with the
  pulsing dot. The manager writes MFL **MANAGER** the same way with
  MANAGER in mint. LIVE keeps its red: it is the name, and red is the
  manager's colour for its Live scoring link too.
- **Right:**
  - A link to the manager, "Manager ↗", styled as the manager's
    `a.glass.link`. The manager already links here from its "Live scoring"
    pill, so the two apps point at each other.
  - The DARK / LIGHT control, as the manager's theme segment: two 36px
    buttons inside the chrome, the chosen one on `--accent` /
    `--accent-ink`.
- **Phone (under 768px):** the mark and wordmark at the left, the theme
  control at the right. There is no nav to fold away: MFL Live is one
  page.

### Buttons, pills and tabs
- One voice: Barlow Condensed, uppercase, `.04em`.
- `.btn` is 40px tall, radius `--radius-cta` (10 dark, 999 light), with a
  hairline `--border-strong`. The primary is `--accent` / `--accent-ink`.
- Selectable pills (the round strip, the spotlight's day pills, the
  Starters/Bench tabs) are as the manager's `.weeks button`: 36px, radius
  9, `--border-strong` outline. The current one is on `--accent` /
  `--accent-ink`; the gold MVP pill keeps `--gold` / `--gold-ink`.

### Cards
- `--surface`, `1px solid var(--border)`, radius 24, padding 24.
- The head is a 28px display title in capitals, with its controls to the
  right (the manager's `.card-head`).
- Hover lifts the hairline to `--border-strong`. No shadow transitions: a
  lift's shadow is a pseudo-element fading in, as MFL Live already does.

### The player row
The manager's redesigned row (its styles.css, "the player row, redesigned
(2026-09-23)"), mapped onto MFL Live's `.prow`:
- **Photo (left):** 60×68, radius 14, the headshot on the club's two
  colours. The colours are `--tc1`/`--tc2` from `TEAM_COLORS`, the
  touchdown card's table MFL Live already has: a radial of the second
  colour over a dark linear of the first. The club mark sits as a 20px
  white disc in the bottom-left. The mint TD chip stays on the top
  corner.
- **Words (middle):** the position chip on top (Barlow Condensed 13px,
  `.06em`, radius 6, the position's colour on its soft). The name under
  it (24px capitals, first name quieter). Then the sub line in Barlow
  capitals: team, clock, stat line. The clock turns `--accent-text` and
  bold while his game is on.
- **Number (right):** the points in Barlow Condensed 30px.
- A live row keeps its accent wash. A sidelined starter (Doubtful, Out,
  IR…) keeps his row and points.
- **Group separators:** the position's micro label in its colour
  (Barlow Condensed 14px, `.08em`) and a hairline, as today.
- **Phone:** the manager's phone cut of the same row (its "A phone, the
  two-column lists…" block): the same card, smaller, one grid.

### The footer
The manager's footer:
- The wordmark huge at the left: **MFL LIVE**, Barlow Condensed italic
  800, `clamp(40px, 8vw, 110px)/.85`, in `--foot-mark` with a 1.5px mint
  `-webkit-text-stroke` in both themes.
- MFL Live's disclaimer beside it, in Barlow 13px `--text-muted`.

## Screens

### The week head (`.week`: kicker, WEEK title, countdown, subhead)
- **Layout:** as the manager's `page-head`.
- **Kicker:** "INDOMEXPAK · 2026 · Week 3", or "Playoffs · Week 15",
  "Back to now" and so on. Barlow 700 12px, `.14em`, in `--accent-text`.
  White in dark stays a rule for the Bowl weeks.
- **Title:** **WEEK 3** in the italic 800 at the page-title size. It
  keeps MFL Live's colour drift, painted through the glyphs; that drift is
  where the manager's title sheen came from. Mind the overhang padding.
- **Trophy and holiday emoji:** they stay outside the h1, as now.
- **Subhead:** "Updated 19s ago", Barlow 500 14px, `--text-secondary`.
- **Pre-season countdown:** the manager's countdown type. Barlow
  Condensed 700 at 40–52px, "2D 14H 22M", the pulsing dot before it.

### The capsules ("2 within 3.0", "1 wins at stake", "126 starters left")
- The manager's stat strip, compact: each is a number in Barlow Condensed
  700 at 28–32px over a label in Barlow 700 11px, `.12em` capitals.
- They sit side by side on every width; on a phone that is three across,
  so the labels stay short.
- The number keeps its tier colour: red for the coin flips, orange for
  the close gaps, mint for starters left. The tile is `--surface` with a
  hairline, radius 14.

### The leader hero (`#hero`)
- **Ground:** `--grad`, radius 24, padding 24–28, no border in dark.
- **Top:** the rank badge, the kicker "LEADING WEEK 3" (Barlow 700 11px,
  `.14em`, `--hero-muted`), and the status pill ("Robinson · on now") on
  `--hero-pill`.
- **Middle:** the name in the italic 800 at the hero-name size, with the
  record under it ("22-8 all-play", Barlow 600 14px). The score is at the
  right in Barlow Condensed 700 at `clamp(56px, 8vw, 96px)`.
  `fitName`'s stack and wrap rules still apply at the new sizes.
- **Strip:** "Leads Lil' Sosos by" with the number in Barlow Condensed
  28px, on `--hero-strip`, radius 14.
- **Keep:**
  - The lead-change takeover (strobe, bolts, sweep, badge spin, name
    rise).
  - The pick lift.
  - The laptop tab seam into the pane (`--tab-a`/`--tab-b`).
- **Week winner:** `--hero-bg-gold` and the gold ring.
- **The Bowl's face-off and the Pro Bowl's:** the same type scale, both
  sides. The leading score keeps the iridescent sweep; the flags stay
  inline SVG.

### The spotlight (`#spot`: the day's top scorer, the MVP)
- **Layout:** the manager's top-scorer card, laid flat for a single
  entry. A photo on the club's colours at the left (the MVP's in a gold
  ring on the gradient, as the manager's MVP card), then the kicker ("TOP
  SCORER · SUNDAY", or "MVP OF THE WEEK" in gold), the name in 24–28px
  capitals, the franchise and the stat line, and the points large at the
  right.
- **Day pills:** as the manager's week pills; the MVP's is gold with its
  star.
- **Keep:**
  - The two-stage reveal (the space opens, then the pieces).
  - The swipe and arrow keys.
  - The Bears rule and Quinn.

### The board (`.board`, `#rows`)
The manager's standings row, adapted:
- **Row:**
  - `--surface`, a hairline, radius 16, padding 18px 20px.
  - Rank at the left in its tiered circle. The number is Barlow Condensed
    16px, and the circle takes the hotter gap's colour, as today.
  - The name in 24px capitals.
  - Under it, the record chip and the status: the chip in Barlow
    Condensed 16px on `--surface-raised`, radius 6; the status in Barlow
    600 12px `.06em` capitals ("● GOLDEN, FRANKLIN · ON NOW", mint while
    on).
  - The score at the right in Barlow Condensed 700 at 32px.
- **Chevron:** drop the ›. The manager's rows have none and the tap is
  the affordance.
- **Gap dividers:** the number alone in a pill, Barlow Condensed 700
  15px, radius 10 (the new `--radius-pill`). If the rounded rectangle
  loses the "pill on a line" read, keep this one pill at 999 and say so
  in CLAUDE.md. Keep the tier colours, the fusing, the pulse ring and the
  still and idle rules.
- **Selected:** the lift as now.
- **Playoffs:**
  - The cut line is the divider under the last advancing rank.
  - Rows under it are `.out` with a hollow rank.
  - In / Out / Advances / Eliminated / Champion / Runner-up are chips in
    the manager's chip shape (Barlow Condensed 12px, radius 6).
  - The champion keeps its 2px gold ring.
- **Pro Bowl:** each side is a row, its managers fused under it.

### The team page / pane (`#team`)
- **Head:**
  - The kicker "RANK 1 · WEEK 3" (the micro kicker).
  - The name in the italic 800, `clamp(40px, 5vw, 64px)`, then the
    record and the points.
  - At the right, the franchise's MFL icon in a 4px gradient ring, as the
    manager's `.ph-logo`. With no icon, its initials on the franchise's
    own hue (`oklch(0.8 0.12 <hue>)`, initials in Barlow Condensed 13px
    `#060a11`, as the manager's standings marks).
- **Tabs:** Starters and Bench as the manager's page tabs (pills in one
  voice, the open one on `--accent`), each with its number: "STARTERS
  37.17", "BENCH 0.00 BEHIND".
- **Rows:** the player row above, grouped by position. Keep the swing-in.
- **Laptop:** the pane and its tab keep their structure.
- **Phone:** the page slides over the board as now, with the back button
  in the chrome style.

### The player card (`#pcard`)
**MFL Live's card is the source; the manager ports it** (the manager's
CLAUDE.md: "Fix it there first and port again"). The token and font
swap restyle most of it for free. Two of the manager's own tweaks
belong here, so the ports go back to being identical:
- the name at 66px from a laptop's width (MFL Live's is 44px);
- the game strip a size up in the display face.

Both are in the manager's styles.css under "2026-09-23, the second look".
Then drop those two overrides from the manager.

Leave the manager-only additions in the manager (add/bid, trade, the
forecast line, the zoom from the click point).

### The touchdown card (`#td-modal`)
- **TOUCHDOWN** in the italic 800. Barlow Condensed is narrower than
  Archivo, so set it about 15% larger to keep its width.
- "for" over the franchise: the franchise in Barlow Condensed 700 at
  24px capitals.
- The points in Barlow Condensed 700.
- The team colours, rays, flash, the Bears' **BEAR DOWN!** and the
  overturned card are all unchanged, only retyped.

### The Witching Hour (`#witch`)
Retype its lines in the italic 800 and the micro kicker. Leave its
scene and timing alone.

### The loader (`#loader`)
- **Keep the cartoon** (`loader.webp`, your own animation). Nothing in the
  manager replaces it, and it is MFL Live's character.
- Restyle the **MFL LIVE** wordmark under it as the manager's splash
  wordmark: Barlow Condensed italic 800 in outline, filling left to right
  with the league's colours. The manager's `spFrame` creeps on time and
  jumps a step per answer; here the first liveScoring poll is the answer.
- The status line is Barlow 600 13px `--text-secondary`.
- `MIN_LOAD_MS` stays.

### Backgrounds
- **The aurora (`#sky-bg`)** stays: it is the manager's teal and violet
  sky in cloud form.
- **Holidays:** the Bowl's gold flourish, the snow and the holiday
  palettes stay. The holidays need the three new tokens.

## Motion

MFL Live's motion carries information: a score rolled, a rank moved, a
lead changed, a touchdown. **Keep all of it.** Do not bring over the
manager's scroll-driven motion (parallax, marquee, odometer hero, card
rise-on-scroll, pointer tilt). MFL Live is one screen, watched, not
scrolled through, and on a phone mid-game every repaint counts.

Borrow only:
- **The page title's entrance** (the manager's `letterTitle`, a letter
  rise and one sheen pass), once per load on the WEEK title. Name the h1
  by `aria-label`.
- **The standings' sweep flash**, a band of light across the card and
  then its name (the manager's `mo-flash`, 2026-09-24). Use it as the
  board rows' arrival in `cascadeIn()`, in place of the plain rise, if it
  reads well at 55ms steps.

The manager's rules, which MFL Live already mostly follows:
- Animate `transform`/`opacity` (or `translate`/`scale` where entrances
  stack).
- No `backdrop-filter` on anything fixed and full-width.
- No transitioning `box-shadow`.
- Everything off under `prefers-reduced-motion`.

## Responsive

Check at **390px** (the main screen), 768, 1024, 1280 and 1440, in both
themes.

- **Phone:**
  - The masthead is the mark plus the theme control.
  - The week head at the small end of its clamps.
  - The capsules three across.
  - The hero stacked where `fitName` says.
  - The board one column, names wrapping to two lines, never an
    ellipsis.
  - The team page full-screen.
- **Laptop:** the board and the pane side by side, as now, under the
  full-width chrome.
- **Very wide screens:** the manager zooms the whole page past 1680px
  (2026-09-24, its CLAUDE.md "Past 1680px"). If MFL Live gets the same,
  note that Chrome multiplies `vw`/`vh` by the zoom, and MFL Live uses
  both (the 84vh sheet, the `calc(50vh + 50%)` sweep). Take it after
  everything else.

## A preview site

Production (`mfllive`) publishes `main` only with previews off, so the
branch needs its own site, the way `mfllive-poc` has one:
- A new Netlify site (for example `mfllive-redesign`) linked to this
  repo, publishing `app/`, locked to `redesign`.
- **Its own registered MFL client** (`MFL_UA`). Register one with MFL as
  was done for the manager's preview (`mflmanager219716`), so its calls
  count against its own allowance and never throttle production's.
- It runs the same function, so it counts against the same Netlify
  team's function invocations. The free plan allows 125,000, and Week 1
  cost 9,705 with one viewer. A preview one or two people open costs
  little, but watch the usage page on a Sunday.

## Keeping the two apps in step

`tokens.css` is a snapshot of the manager's tokens. Once both apps have
settled, make one file the source:
- Take the shared tokens and the one-voice button rules into a file
  owned by mfl-manager (for example `design/system.css`).
- Copy it here the way the player card and `scoring.js` travel today.
- Add a test in each repo that fails when the copies differ.

Until then, a change to a shared token is made in both.

## Rehearsing every state

Everything here must be checked in its states, not only today's board.
The dev configurations and switches MFL Live already has:

- `app-fake-live`: the in-season board from the 2025 W12 fixture.
- `app-2025` with `?w=12`, `?w=15`, `?w=16`, `?w=17`, `?w=18`: a normal
  week, each playoff round, the Bowl and the Pro Bowl, finished.
- `app-2025-w15-live`, `app-2025-w18-live`: a round and the Pro Bowl
  mid-week.
- `?td=CHI` (the Bears), `?td=<team>` (any other card).
- `?holiday=thanksgiving|christmas`, `?theme=light`, `?mvp=quinn`,
  `?source=fixture`.
- Pre-season: the countdown and the alphabetical board.

## Working order

1. **Tokens and fonts.** `tokens.css` over the top of `styles.css`, the
   font link, the holiday blocks' three new names. Check the tabular
   figures (see "Type").
2. **The masthead** and the one-voice buttons, pills and tabs.
3. **The week head and the capsules.**
4. **The leader hero**, then the Bowl and Pro Bowl face-offs.
5. **The board rows and gap dividers**, then the playoff states.
6. **The team page:** head, tabs, then the player row.
7. **The spotlight.**
8. **The player card:** take the manager's two tweaks back, then check
   the manager's port.
9. **The touchdown card, the Witching Hour and the loader's wordmark.**
10. **The footer.**
11. **Motion extras** (the title entrance, the sweep flash), if wanted.

After each step, compare against `reference/manager/` and the live
manager at 390px and 1440px in both themes, and run the rehearsals that
step touches.

## Open decisions (yours to make as you go)

- **The loader:** keep the cartoon with the new wordmark (recommended),
  or replace it with the manager's splash outright.
- **The aurora's strength:** MFL Live's clouds are stronger than the
  manager's two glows. Keep them (MFL Live's character), or match the
  manager.
- **The gap pill's shape:** a 10px radius like every other pill, or keep
  it round because it sits on a line.
- **Cross-links:** "Manager ↗" in MFL Live's chrome, to match the
  manager's "Live scoring" pill.
- **The board's chevron:** drop it (recommended, matches the manager).
