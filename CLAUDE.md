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

The mockup adopts **Fantasy Architect's** design system
(<https://fantasy-architect.netlify.app/>) so the two apps read as siblings.
Tokens were lifted from that site's live CSS, not eyeballed:

- **Dark-first**, like Fantasy Architect: bare `:root` is the dark palette and
  `:root[data-theme="light"]` is the override. That is the inverse of the usual
  pattern -- do not "fix" it to follow `prefers-color-scheme`.
- **Archivo** for display, **Nunito** for body and data, via Google Fonts.
  Fantasy Architect's own typographic rule: Archivo 900 italic uppercase for
  headers, Archivo 700 roman for names inside lists, Nunito with
  `tabular-nums` for every number.
- **Position pills** reuse its `--qb/--rb/--wr/--te/--k/--idp` tokens. All
  defensive positions share `--idp`, which matches this league's "3 IDP, any
  combination" rule.
- `--danger` carries the contested-boundary treatment. `--danger-soft` and
  `--danger-line` are local additions; Fantasy Architect has no equivalents.

`mockup/build-data.mjs` regenerates both embedded blobs from the committed
fixture (`MFL_UA='imp19716' node mockup/build-data.mjs`). It asserts each team
has 12 starters whose points sum to the team total, so a bad join fails loudly
rather than shipping. Do not hand-edit the blobs.

## Player images and stats

MFL serves **neither** -- no image field anywhere in the players export, and
fantasy points only. (`TYPE=playerProfile` does return news headlines free,
which is unused so far.) Both come from Sleeper, reached through the same
`rotowire_id` join: **215/215** rostered players resolve, and 215/215 have a
headshot.

- Headshots: `sleepercdn.com/content/nfl/players/thumb/{sleeper_id}.jpg`
  (250x181). Team logos: `sleepercdn.com/images/team_logos/nfl/{team}.png`.
  **An unknown id returns 403, not 404** -- don't branch on 404.
- The mockup **inlines** them as data: URIs (~1MB) because the Artifact CSP
  blocks `sleepercdn.com`; a plain `<img src>` to the CDN renders nothing with
  no error. On Netlify there is no such constraint -- load them from the CDN.
- `sips` applies `-Z` **before** `-c` regardless of argument order, so cropping
  square and resizing must be two separate calls or the crop clamps to the
  already-shrunken image. Raw downloads are cached so re-processing never
  re-fetches 215 images.

**Images are off the live path; stat lines are on it.** The crosswalk is a
cache job and headshots are static files, so neither touches Sunday polling --
and a headshot cannot contradict a score. Live stat lines would need Sleeper
polled *during games* and carry the drift problem above. That asymmetry is why
headshots are in and stat lines are still out.

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

## What is deliberately absent

- **No application code.** Not until the Week 1 cadence run returns GO. A
  leaderboard built before that measurement is the sunk cost this whole
  evaluation exists to avoid.
- **This does not share the FFLR records GitHub Actions pipeline.** Different
  cadence (30s vs weekly), different blast radius (that job commits records
  that settle payouts), and a wrong storage model (it commits data to git).
  Copy `src/mfl/client.mjs` if useful; do not couple the deployments.
- **`spike/data/` is gitignored.** Those logs are measurements, not source.
- **`mockup/` is untracked**, along with `.claude/launch.json` (a static server
  for previewing the mockup). Both are deliberate, not oversight.
