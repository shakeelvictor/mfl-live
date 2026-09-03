# Handoff: FFLR Live — leaderboard + team page redesign

## Overview
Visual redesign of FFLR Live, the all-play live-scoring board for MFL league 19716. Two screens: the **Leaderboard** (week header, capsule stats, leader hero card, ranked standings with gap dividers) and the **Team page** (full-screen, hero header, Starters/Bench segmented control, player rows). Dark is default; light is a token override.

The design premise: in all-play, the **point gap between adjacent ranks** is worth a full win. Gaps are the loudest element on screen, scores are second.

## About the design files
`FFLR Live v2.dc.html` is a **design reference built in HTML** (a streaming design-component format; `support.js` is its runtime). It is a prototype showing intended look and behavior, **not production code to copy in**. Recreate it in the mfl-live codebase using whatever stack you choose there (the repo has no app code yet; the brief assumed React + Tailwind). All styling in the prototype is inline `style=""` reading CSS custom properties, so every value is greppable.

Extracted for direct reuse:
- `tokens.css` — the complete `:root` / `[data-theme="light"]` token layer. Port as-is.
- `mock-data.js` — `MOCK_DATA` (Week 12, 11 franchises, Uncle Rico roster). Shape mirrors what `liveScoring&DETAILS=1` supplies; swap for the API.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and interactions are final intent. Recreate pixel-close. Two things are placeholders: player headshots (initials circle — replace with Sleeper headshots per `CLAUDE.md`) and the "on now" status (illustrative mid-slate framing).

## Design system
Dark-first: bare `:root` is dark, `[data-theme="light"]` overrides. Set `data-theme` on the app root; do not follow `prefers-color-scheme` (matches the repo convention).

**Fonts** (Google Fonts): Archivo 600/700 + 900 italic; Nunito 400/600/700/800.
- Display headers: Archivo 900 italic, uppercase, negative tracking (`WEEK 12` 56px/0.9, -0.03em; team name in hero 28–30px/1, -0.02em).
- Names in lists: Archivo 700, 15px/1.15, -0.01em, single-line ellipsis.
- Everything numeric and all body/micro text: Nunito with `font-variant-numeric: tabular-nums` set on the root.
- Micro-labels: Nunito 800, 10px, letter-spacing 0.14–0.18em, uppercase, `--text-muted` (or `--hero-muted` on hero).

**Semantic tokens** (see `tokens.css` for values): `--canvas`, `--wash`, `--surface`, `--surface-raised`, `--surface-sunken`, `--surface-glass`, `--border`, `--border-strong`, `--shadow-card`, `--shadow-sheet`, `--scrim`, `--text-primary/secondary/muted/faint`, `--accent`, `--accent-ink`, `--accent-soft`, `--hero-bg`, `--hero-text`, `--hero-muted`, `--gap-critical(-soft/-ink)`, `--gap-live(-soft/-ink)`, `--gap-settled`, `--pos-qb/rb/wr/te/k/lb` + `-soft`, `--radius-card: 24px`, `--radius-row: 18px`, `--radius-pill: 999px`.

Token scale reasoning:
- Accent is mint (`#4fe3c1` dark / `#0e9c83` light). It carries "live/on now", the selected segment, and the leader's rank badge — never urgency.
- Urgency is a separate warm scale: `--gap-critical` red (coin flip) → `--gap-live` orange (at risk) → `--gap-settled` neutral hairline. Red and mint are ~150° apart in hue so neither reads as the other.
- Each urgency color ships with a `-soft` (12–14% alpha fill) and `-ink` (text-on-solid) so components never mix hex.
- Light theme deepens the accent and reds for contrast on white and swaps borders for diffuse shadows (`--shadow-card`).

## Screens

### 1. Leaderboard
Container: `max-width: 700px`, centered, padding `16px 16px 48px`, vertical flex `gap: 20px`. Root background `--canvas`; a 560px-tall `linear-gradient(180deg, var(--wash), transparent)` overlay is absolutely positioned at the top (pointer-events none). Designed at 390px, holds to 700px.

**Header** — flex, space-between.
- Left: 40px circle `--accent` with "FL" (Archivo 900 italic 15px, `--accent-ink`), then a two-line stack: "FFLR LIVE" (Archivo 900 italic 16px, 0.02em) and "● LIVE · 4:12 PM" (Nunito 800 10px, 0.14em, `--gap-critical`; the 6px dot pulses).
- Right: theme segmented control — 40px tall pill, padding 4px, `--surface-glass` bg, 1px `--border-strong`, `backdrop-filter: blur(10px)`. Two buttons "DARK"/"LIGHT" (Nunito 800 11px, 0.08em, padding 0 13px, pill). Active: `--accent` bg + `--accent-ink`; inactive: transparent + `--text-muted`. 250ms color transition.

**Week title** — "WEEK 12" (Archivo 900 italic 56px/0.9, -0.03em), then subtitle "All-play · every team plays every other team · updated 4:12 PM" (Nunito 14px/1.4, `--text-secondary`).

**WeekSummary** — wrapping row of capsules, gap 8px. Each: 38px tall pill, padding `0 14px 0 12px`, `--surface` bg, 1px `--border`, `--shadow-card`, Nunito 700 12px `--text-secondary`, leading number Nunito 800 16px. Numbers: within 3.0 and wins at stake in `--gap-critical`, starters left in `--accent`. **Derived, never hardcoded**: within = distinct teams touching a gap < 3.0; wins at stake = count of gaps < 3.0; starters left = Σ toPlay.

**Hero (current #1)** — card `--radius-card`, `--hero-bg`, `--hero-text`, `--shadow-card`, padding 18px, flex column gap 14px, tap opens that team.
- Top row: 26px `--accent` circle with "1" (Archivo 900 italic 12px) + "LEADING WEEK 12" micro-label in `--hero-muted`; right: status pill (`rgba(255,255,255,.14)`, Nunito 700 11px, padding 6px 11px).
- Middle: team name (Archivo 900 italic uppercase 28px/1) with "10-0 all-play" (Nunito 700 12px `--hero-muted`) beneath; right-aligned points Nunito 800 40px/1, -0.03em.
- Bottom strip: `rgba(255,255,255,.10)` 16px-radius box, padding 10px 12px; tier pill (SETTLED/LIVE/COIN FLIP — bg `--gap-*`, ink `--gap-*-ink`; settled uses white 14% + `--hero-text`), "Leads **Reggaeton Forever** by", right-aligned gap Nunito 800 18px.

**Standings header** — "Standings" (Archivo 700 20px) left, "11 franchises" (Nunito 700 12px `--text-muted`) right, padding 0 6px.

**LeaderboardRow** — a `<button>`, grid `36px 1fr 82px 14px`, gap 12px, padding `12px 14px 12px 12px`, bg `--surface`, text `--text-primary`, hover `filter: brightness(1.06)`.
- Rank: 36px circle, Nunito 800 13px. Default `--surface-raised` / `--text-secondary`. If the row touches a **critical** gap: `--gap-critical` bg + `--gap-critical-ink`. If it touches a **live** gap: `--gap-live-soft` + `--gap-live`.
- Name: Archivo 700 15px. Below it, gap 4px: record capsule (padding 3px 7px, `--surface-raised`, Nunito 800 10.5px `--text-secondary`) then status text (Nunito 600 11.5px, `--text-muted`; when on now, `--accent` with a pulsing 6px accent dot).
- Points: Nunito 800 20px, -0.02em, right-aligned. Chevron "›" Nunito 20px `--text-faint`.
- **Cluster fusing**: rows adjacent to a hot gap (critical or live) fuse into one card. Corner radii are computed per edge: `--radius-row` on an edge that borders a settled gap, `0` on an edge that borders a hot gap. Fused rows drop `--shadow-card` (shadow `none`); standalone rows keep it.

**GapDivider** — grid `1fr auto 1fr`, gap 10px, hairline spans left/right of a center pill. Gap value formatted to 2 decimals.
- Settled (≥ 2.5): padding `6px 22px`, transparent bg, hairlines `--gap-settled`, pill `--surface` bg + 1px `--border-strong`, `--text-muted`, Nunito 800 12px, padding 4px 10px. Reads as a connector floating between two separate cards.
- Live (< 2.5): padding `2px 14px`, bg `--surface` (inside the fused card), hairlines `--gap-live`, pill `--gap-live-soft` bg + `--gap-live` text, padding 5px 11px.
- Critical (< 0.25): padding `4px 14px`, bg `--surface`, hairlines `--gap-critical`, pill solid `--gap-critical` + `--gap-critical-ink`, padding 7px 13px, value followed by "COIN FLIP" (Nunito 800 10px, 0.16em).
- Thresholds are configurable (prototype tweaks `gapCriticalThreshold` 0.25, `gapLiveThreshold` 2.5). Legend labels read the same values.

**Legend** — three 30px pills, Nunito 800 11px: "under 0.25 — coin flip" (`--gap-critical-soft`/`--gap-critical`), "under 2.5 — live" (`--gap-live-soft`/`--gap-live`), "settled" (`--surface` + `--border-strong`, `--text-muted`).

**Footnote** — Nunito 13px/1.55 `--text-muted`: "Tap any team for its lineup. Every rank boundary you cross is a full win or loss, which is why the gaps are the loudest thing here — not the scores."

### 2. Team page (full-screen route over the board)
Same shell: `--canvas`, wash gradient, 700px container, padding 16px, gap 18px. Enters with 200ms fade + 320ms `translateY(32px→0)` `cubic-bezier(.2,.8,.2,1)`.

**Header** — left: back pill "‹ Standings" (40px, `--surface-glass`, 1px `--border-strong`, blur, Nunito 800 12px). Right: LIVE pill (same glass treatment, `--gap-critical` text + pulsing dot).

**Team hero** — same card treatment as the leader hero. Top row: 26px accent circle with the rank number + "WEEK 12" micro-label; status pill right. Middle: team name (Archivo 900 italic uppercase 30px) with "7-3 all-play" beneath; points Nunito 800 40px right.

**Segmented control** — pill, padding 4px, `--surface` bg, 1px `--border`, `--shadow-card`. Two 40px tabs: "Starters 144.86" and "Bench 26.47 behind" (Nunito 800 12px; the number at 75% opacity). Active: `--accent` / `--accent-ink`; inactive: transparent / `--text-muted`.

**Roster card** — `--surface`, `--radius-card`, 1px `--border`, `--shadow-card`, padding 8px.

**PlayerRow** — grid `40px 40px 1fr auto`, gap 10px, padding 9px 8px, radius `--radius-row`, hover `--surface-raised`.
- Headshot placeholder: 40px circle, `--surface-raised`, 1px `--border-strong`, initials Nunito 800 11px `--text-muted`. Replace with Sleeper headshot.
- Position chip: 24px-tall pill, full column width, Nunito 800 10.5px 0.08em, color `--pos-<pos>`, bg `--pos-<pos>-soft`. All IDP positions use `--pos-lb` (league has 3 IDP any-combination; alias to `--idp` if you prefer the Fantasy Architect name).
- Name Archivo 700 15px + NFL team Nunito 700 11px 0.08em `--text-muted`.
- Points Nunito 800 17px, -0.01em. `0.00` renders in `--text-muted`.
- Bench rows: opacity 0.75; bench rows with 0.00: opacity 0.42.

Teams without a roster in mock data show a `--surface` card with a centered muted note.

## Interactions & behavior
- Tap any row or the hero → open that team's page (starters tab). "‹ Standings" returns. Board scroll position should be preserved (prototype overlays with `position: fixed`).
- Theme toggle switches `data-theme` on the root; all surfaces transition 300ms.
- Live values (score, gap, status, headline stats) are separate components with `transition: color .4s`. On change, the value flashes: `@keyframes fflr-flash { from { color: var(--accent) } to { color: inherit } }` 900ms ease-out. A coin-flip pill also flashes when either adjacent score changes.
- Re-sort on score change; rank/record recompute (record = `(n-1-i)-(i)` on the sorted list). Rank circle and cluster fusing recompute from the new gaps; radius transitions 300ms.
- Pulse: `@keyframes fflr-pulse { 50% { opacity: .45; transform: scale(.8) } }` 1.6s infinite on live dots.
- Prototype tweak `simulateLive` randomly bumps "on now" teams every 3s to exercise these transitions — dev-only.

## State
- `theme: 'dark' | 'light'`
- `openTeamId: number | null`, `tab: 'starters' | 'bench'`
- Derived per render: sorted teams with `rank`, `record`, `live` points; `gaps[]`; `tier(gap)`; headline stats; hero (teams[0], gaps[0]).
- Data: `liveScoring&DETAILS=1` every 30s → franchise totals, per-player points, `status: "starter"`, `playersYetToPlay`. Trim franchise names, check `body.error`, canonicalize before diffing (see repo `CLAUDE.md`).

## Component boundaries
`Header`, `WeekSummary`, `LeaderHero`, `LeaderboardRow`, `GapDivider`, `Legend`, `TeamPage` (`TeamHero`, `SegmentedControl`, `PlayerRow`), plus `LiveValue` (the flashing number wrapper).

## Assets
None bundled. Fonts from Google Fonts. Headshots/team logos per `CLAUDE.md` (Sleeper CDN, `rotowire_id` join). Logo mark is a typographic "FL" circle.

## Screenshots
`screenshots/` — 01 leaderboard dark, 02 leaderboard light, 03 team page starters (light), 04 team page bench (light), 05 team page starters (dark). Reference renders of the HTML at desktop width; the layout is identical at 390px minus horizontal room.

## Files
- `FFLR Live v2.dc.html` — the design reference (open in a browser alongside `support.js`).
- `tokens.css` — token layer to port.
- `mock-data.js` — `MOCK_DATA`.
