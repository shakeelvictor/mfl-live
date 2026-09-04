/* ---------------- data source ----------------
   Live: the league itself, through /api/mfl (server/mfl.mjs): franchises,
   rosters, a player map with Sleeper ids, the NFL schedule and, once the
   season starts, liveScoring polled every 30s. Fixture: the embedded 2025
   Week 12 data in data.js -- the POC's world, and the fallback when the
   feed cannot be reached (the artifact, offline). ?source=fixture forces
   it; the bundle sets window.MFL_FIXTURE. */

const QUERY = new URLSearchParams(location.search);
let FIXTURE = QUERY.get("source") === "fixture" || window.MFL_FIXTURE === true;

let rosters = [];              // [{ id, team, pts, toPlay, starters, bench }]
let headshotSrc = () => null;  // (player) -> img src, or null for the initials fallback
let logoSrc = () => null;      // (NFL team code) -> img src, or null
let WEEK = 12;
let UPDATED = "4:12 PM";
let phase = "live";            // "live" | "preseason" (liveScoring not available yet)
let kickoff = null;            // Date of the week's first game (live source)
let games = new Map();         // NFL team -> { kickoff: Date, secs } from nflSchedule (live source)
let dayTeams = { early: new Set() };   // NFL teams whose game is on the week's first day

// Illustrative mid-slate framing for the FIXTURE: it is a finished week, so
// the clock, starters yet to play and "on now" are staged to show the board
// in progress. The live source has the real values.
const YET_TO_PLAY = {
  "I'm Just Here to Network": 0, "Reggaeton Forever": 1, "Ryaan": 2,
  "Uncle Rico": 0, "Vip": 1, "WhiskeyDitka": 2, "Lil' Sosos": 1,
  "2-minute Drill": 3, "High Flyers": 2, "The Don is Yinz King": 1,
  "3rd and 1": 4,
};
// "on now" is derived from the staged live game below (LIVE_NFL).

// Gap urgency thresholds. The legend reads these same values.
const CRITICAL = 0.25;  // a boundary this thin is a coin flip
const LIVE = 2.5;       // still genuinely in play
const WITHIN = 3.0;     // the headline "within" band

const r2 = (x) => Math.round(x * 100) / 100;
const fmt = (x) => x.toFixed(2);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "&#39;");
const sum = (list) => list.reduce((t, p) => t + p.pts, 0);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

/* ---------------- live state ----------------
   Points added on top of the fixture, by team and by starter. A bump is
   always applied to one starter AND its team together, so a team's total
   keeps equalling its starters' sum -- the invariant build-data.mjs
   asserts. With the feed wired, this is where a fresh liveScoring poll
   would land instead. */

const teamBump = {};    // team id -> points added
const playerBump = {};  // `${teamId}:${starterIndex}` -> points added
const benchBump = {};   // `${teamId}:b${benchIndex}` -> points added; never reaches the team total

function bump(t, k, pts) {
  teamBump[t.id] = r2((teamBump[t.id] || 0) + pts);
  const key = `${t.id}:${k}`;
  playerBump[key] = r2((playerBump[key] || 0) + pts);
}

let teams = [];   // sorted, with rank/record/live
let gaps = [];    // gaps[i] is the gap below row i (between rank i+1 and rank i+2)

// All-play record is pure arithmetic on the sorted list. Everything the
// page shows -- ranks, records, gaps, tiers, headline stats -- comes from
// ROSTERS, never from a constant that could disagree with its own rows.
function derive() {
  teams = rosters
    .map((t) => ({
      ...t,
      live: r2(t.pts + (teamBump[t.id] || 0)),
      toPlay: slate.sunFinal ? 0 : (FIXTURE ? (YET_TO_PLAY[t.team] ?? 0) : (t.toPlay ?? 0)),
      onNow: t.starters.some(isLive),
    }))
    // Pre-season nobody has a score, so the list is alphabetical, not ranked.
    .sort((a, b) => (phase === "preseason" ? a.team.localeCompare(b.team) : b.live - a.live))
    .map((t, i, arr) => ({ ...t, rank: i + 1, record: `${arr.length - 1 - i}-${i}` }));
  gaps = teams.slice(0, -1).map((t, i) => r2(t.live - teams[i + 1].live));
  n = teams.length;
}

let n = 0;
const byId = (id) => teams.find((t) => t.id === id);
const tier = (g) => (g < CRITICAL ? "critical" : g < LIVE ? "live" : "settled");
const hot = (g) => g !== undefined && tier(g) !== "settled";
const TIER_LABEL = { critical: "Coin flip", live: "Live", settled: "Settled" };

const statusOf = (t) => phase === "preseason"
  ? `${t.bench.length} on roster`
  : t.toPlay === 0
    ? "all played"
    : `${t.toPlay} to play${t.onNow ? " &middot; on now" : ""}`;

const fmtDay = (d) => d ? d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
const fmtTime = (d) => d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
const fmtKick = (d) => d ? `${fmtDay(d)} ${fmtTime(d)}` : "";

// "6d 19h 27m 23s" until kickoff; ticks once a second while pre-season.
// Days drop off at zero; hours, minutes and seconds always show.
function countdownText() {
  if (!kickoff) return "";
  let left = Math.max(0, Math.floor((kickoff - Date.now()) / 1000));
  const d = Math.floor(left / 86400); left -= d * 86400;
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), sec = left % 60;
  const p = (x) => String(x).padStart(2, "0");
  return `${d ? d + "d " : ""}${p(h)}h ${p(m)}m ${p(sec)}s`;
}
setInterval(() => {
  const el = document.getElementById("countdown");
  if (el) el.textContent = countdownText();
}, 1000);

// A franchise's own icon, when one is set in MFL.
const franchiseIcon = (t, cls = "ficon") => t.icon ? `<img class="${cls}" src="${t.icon}" alt="" loading="lazy" onerror="this.remove()">` : "";

/* ---------------- chrome ---------------- */

function renderChrome() {
  document.getElementById("week-title").textContent = `Week ${WEEK}`;
  const kick = document.getElementById("kick");
  kick.hidden = phase !== "preseason" || !kickoff;
  document.getElementById("countdown").textContent = countdownText();
  document.getElementById("hero-wrap").hidden = phase === "preseason";
  const sub = document.getElementById("subhead");
  sub.hidden = phase === "preseason";
  sub.innerHTML = `Updated ${esc(UPDATED)}`;
  document.getElementById("franchise-count").textContent = `${n} franchises`;
}

/* ---------------- render ----------------
   `changed` holds the team ids and `${teamId}:${starterIndex}` keys that
   moved on this update; their values flash once. Rows are rebuilt from
   scratch, then any row that changed position slides from where it was
   to where it is now (FLIP). */

const hero = document.getElementById("hero");
const heroBody = document.getElementById("hero-body");
let leaderId = null;       // who held #1 at the last render
let takeoverTimer = null;
const rowsEl = document.getElementById("rows");
const fl = (changed, key) => (changed.has(key) ? " flash" : "");

function renderCapsules() {
  const caps = document.getElementById("capsules");
  caps.hidden = phase === "preseason";
  if (caps.hidden) return;
  const within = new Set(gaps.flatMap((g, i) => (g < WITHIN ? [i, i + 1] : []))).size;
  const atStake = gaps.filter((g) => g < WITHIN).length;
  const startersLeft = teams.reduce((s, t) => s + t.toPlay, 0);
  document.getElementById("capsules").innerHTML =
    `<span class="capsule"><b>${within}</b>within ${WITHIN.toFixed(1)}</span>` +
    `<span class="capsule"><b>${atStake}</b>wins at stake</span>` +
    `<span class="capsule"><b class="accent">${startersLeft}</b>starters left</span>`;
}

function renderHero(changed, takeover) {
  if (phase === "preseason") return;   // hidden by renderChrome; the countdown pill stands in
  const lead = teams[0], chaser = teams[1], lt = tier(gaps[0]);
  heroBody.innerHTML =
    `<div class="hero-top">` +
      `<span class="micro hero-label"><span class="badge">1</span>${weekIsFinal() ? `Week ${WEEK} winner` : takeover ? "New leader" : `Leading Week ${WEEK}`}</span>` +
      `<span class="hero-status">${statusOf(lead)}</span>` +
    `</div>` +
    `<div class="hero-mid">` +
      `<div class="hero-id">` +
        `<span class="hero-name">${franchiseIcon(lead, "hero-icon")}${esc(lead.team)}</span>` +
        `<span class="hero-rec">${lead.record} all-play</span>` +
      `</div>` +
      `<span class="hero-pts${fl(changed, lead.id)}" data-tween="pts:${lead.id}" data-delta>${fmt(lead.live)}</span>` +
    `</div>` +
    `<div class="hero-strip">` +
      `<span class="tier ${lt}">${TIER_LABEL[lt]}</span>` +
      `<span class="leads">Leads <b>${esc(chaser.team)}</b> by</span>` +
      `<span class="hero-gap${changed.has(lead.id) || changed.has(chaser.id) ? " flash" : ""}" data-tween="gap:${lead.id}:${chaser.id}">${fmt(gaps[0])}</span>` +
    `</div>`;
  hero.classList.toggle("winner", weekIsFinal());
  document.getElementById("hero-wrap").classList.toggle("winner", weekIsFinal());
  hero.setAttribute("aria-label",
    `${lead.team} leads Week ${WEEK} with ${fmt(lead.live)} points, ${fmt(gaps[0])} ahead of ${chaser.team}. Open lineup.`);

  if (takeover && !reducedMotion.matches) {
    hero.classList.remove("takeover");
    void hero.offsetWidth;   // restart if the last one is still running
    hero.classList.add("takeover");
    clearTimeout(takeoverTimer);
    takeoverTimer = setTimeout(() => hero.classList.remove("takeover"), 1600);
  }
}

function renderRows(changed) {
  // First: where is every row now, by team id.
  const before = new Map();
  for (const el of rowsEl.querySelectorAll(".row")) {
    before.set(el.dataset.id, el.getBoundingClientRect().top);
  }

  // Pre-season: every franchise, alphabetical, no ranks, gaps or points.
  if (phase === "preseason") {
    rowsEl.innerHTML = teams.map((t) =>
      `<button class="row pre" type="button" data-id="${t.id}"` +
      ` aria-label="${esc(t.team)}. Open roster.">` +
        `<span class="rank${t.icon ? " has-icon" : ""}">${t.icon ? franchiseIcon(t, "rank-icon") : esc(t.team.trim()[0] || "?")}</span>` +
        `<span class="who"><span class="name">${esc(t.team)}</span></span>` +
        `<span class="pts">&mdash;</span>` +
        `<span class="chev" aria-hidden="true">&rsaquo;</span>` +
      `</button>`).join("");
    markActive();
    return;
  }

  // The leader lives in the hero, which already shows its lead over #2, so
  // the list starts at rank 2. The first listed row never fuses upward:
  // there is no card above it to fuse with, even when that gap is hot (the
  // hero strip carries that tier instead).
  rowsEl.innerHTML = teams.map((t, i) => {
    if (i === 0) return "";
    const above = gaps[i - 1], below = gaps[i];
    const fuseTop = i > 1 && hot(above), fuseBottom = hot(below);

    // Rank circle takes the hotter of the two gaps the row touches.
    const tiers = [above, below].filter((g) => g !== undefined).map(tier);
    const rankTier = tiers.includes("critical") ? "critical" : tiers.includes("live") ? "live" : "";

    const rowCls = ["row",
      fuseTop ? "fuse-top" : "", fuseBottom ? "fuse-bottom" : "",
      fuseTop || fuseBottom ? "fused" : ""].filter(Boolean).join(" ");

    const row =
      `<button class="${rowCls}" type="button" data-id="${t.id}"` +
      ` aria-label="Rank ${t.rank}, ${esc(t.team)}, ${t.record}, ${fmt(t.live)} points. Open lineup.">` +
        `<span class="rank ${rankTier}">${t.rank}${franchiseIcon(t, "rank-badge")}</span>` +
        `<span class="who">` +
          `<span class="name">${esc(t.team)}</span>` +
          `<span class="sub">` +
            `<span class="rec">${t.record}</span>` +
            `<span class="status${t.onNow ? " on" : ""}">` +
              (t.onNow ? `<span class="dot"></span>` : "") + statusOf(t) +
            `</span>` +
          `</span>` +
        `</span>` +
        `<span class="pts${fl(changed, t.id)}" data-tween="pts:${t.id}" data-delta>${fmt(t.live)}</span>` +
        `<span class="chev" aria-hidden="true">&rsaquo;</span>` +
      `</button>`;

    if (below === undefined) return row;
    const gt = tier(below);
    // A coin-flip pill flashes when either score beside it moved.
    const pillFlash = gt === "critical" && (changed.has(t.id) || changed.has(teams[i + 1].id));
    return row +
      `<div class="gap ${gt}" aria-label="Gap ${fmt(below)}${gt === "critical" ? ", coin flip" : ""}">` +
        `<span class="line"></span>` +
        `<span class="pill${pillFlash ? " flash" : ""}"><span data-tween="gap:${t.id}:${teams[i + 1].id}">${fmt(below)}</span>` +
          (gt === "critical" ? `<span class="flip">Coin flip</span>` : "") +
        `</span>` +
        `<span class="line"></span>` +
      `</div>`;
  }).join("");

  markActive();

  // Last + Invert + Play: rows that moved start at their old offset and
  // slide to rest. Moving rows float above the dividers while in flight.
  if (!before.size || reducedMotion.matches) return;
  for (const el of rowsEl.querySelectorAll(".row")) {
    const was = before.get(el.dataset.id);
    if (was === undefined) { el.classList.add("enter"); continue; }
    const dy = was - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    el.classList.add("moving");
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = "transform .55s cubic-bezier(.2, .8, .2, 1)";
      el.style.transform = "";
    }));
    el.addEventListener("transitionend", () => {
      el.classList.remove("moving");
      el.style.transition = "";
    }, { once: true });
  }
}

/* ---------------- rolling numbers ----------------
   Every live number carries data-tween="<key>". Before a render we note
   what each key currently SHOWS (mid-roll included), and after the
   rebuild any key whose value moved rolls from that to the new value
   instead of snapping. Elements with data-delta also pop a "+1.20" chip.
   Keys are shared between surfaces on purpose: a franchise's score in
   the hero, its row and the team page are all "pts:<id>", so a value
   carries over when it changes surface (a takeover moves the ex-leader
   from the hero into the list). */

const tweens = new Map();   // key -> rAF handle
const TWEEN_MS = 700;

// Only surfaces that are actually showing; a closed team page holds
// stale numbers for whoever was opened last.
const liveNumberEls = () => [
  ...document.querySelectorAll("#app [data-tween]"),
  ...(open !== null ? page.querySelectorAll("[data-tween]") : []),
];

function snapshotShown() {
  const shown = new Map();
  for (const el of liveNumberEls()) shown.set(el.dataset.tween, parseFloat(el.textContent));
  return shown;
}

function rollNumbers(shown) {
  for (const h of tweens.values()) cancelAnimationFrame(h);
  tweens.clear();
  for (const el of liveNumberEls()) {
    const key = el.dataset.tween;
    const from = shown.get(key), to = parseFloat(el.textContent);
    if (from === undefined || !Number.isFinite(from) || Math.abs(to - from) < 0.005) continue;

    if ("delta" in el.dataset) {
      const d = r2(to - from);
      const chip = document.createElement("span");
      chip.className = "delta" + (d < 0 ? " neg" : "");
      chip.textContent = (d > 0 ? "+" : "\u2212") + fmt(Math.abs(d));
      chip.addEventListener("animationend", () => chip.remove(), { once: true });
      el.appendChild(chip);
    }
    if (reducedMotion.matches) continue;

    const text = el.firstChild;   // the number's text node; the chip sits after it
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / TWEEN_MS);
      const e = 1 - Math.pow(1 - p, 3);
      text.nodeValue = fmt(from + (to - from) * e);
      if (p < 1) tweens.set(key, requestAnimationFrame(step));
      else tweens.delete(key);
    };
    text.nodeValue = fmt(from);
    tweens.set(key, requestAnimationFrame(step));
  }
}

function render(changed = new Set()) {
  renderChrome();
  const shown = snapshotShown();
  // Pre-season rows are alphabetical, so nobody "leads": the first live
  // board is a debut, not a lead change, and fires no takeover.
  const takeover = leaderId !== null && teams[0].id !== leaderId;
  leaderId = phase === "live" ? teams[0].id : null;
  renderCapsules();
  renderHero(changed, takeover);
  renderRows(changed);
  renderSpotlight();
  if (open !== null) renderTeam(changed);
  rollNumbers(shown);
  document.getElementById("brand-live").classList.toggle("final", weekIsFinal() || phase === "preseason");
}

/* ---------------- stat lines ----------------
   Real Week 12 lines from Sleeper, embedded per player as `st`. They are
   context beside MFL's number and never feed it: recomputing points from
   stats is disqualified (CLAUDE.md). The simulator edits a live player's
   line so it keeps pace with the bump it just gave them. */

// Illustrative slate: two late games still on the field at 4:12 PM.
// Everyone else is Final. ON_NOW is derived from it, so a franchise reads
// "on now" exactly when it has a starter in this game.
// Where the week stands. Ending the day makes every game final; ending
// the week is MFL marking it official (stats corrections done).
const slate = { sunFinal: false, weekFinal: false, nextWeek: false };
// The week's "final" treatment lasts until the next week begins.
const weekIsFinal = () => slate.weekFinal && !slate.nextWeek;

const LIVE_NFL = new Map([
  ["JAC", "Q3 8:12"], ["KCC", "Q3 8:12"],   // Jaguars at Chiefs
  ["CHI", "Q4 2:31"], ["MIN", "Q4 2:31"],   // Bears at Vikings
]);
// Live source: a player's game clock comes from liveScoring (per player) or,
// failing that, the schedule (per NFL team). 3600 = not started, 0 = final.
const secsOf = (p) => (p.secs ?? games.get(p.tm)?.secs ?? null);
const clockText = (secs) => {
  const q = 4 - Math.floor((secs - 1) / 900), left = ((secs - 1) % 900) + 1;
  return `Q${q} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
};
const isLive = (p) => !slate.sunFinal && (FIXTURE
  ? LIVE_NFL.has(p.tm)
  : (secsOf(p) != null && secsOf(p) > 0 && secsOf(p) < 3600));
const clockFor = (p) => (FIXTURE ? LIVE_NFL.get(p.tm) : clockText(secsOf(p)));
// What a row shows when the player is not on the field.
const gameLabel = (p) => {
  if (FIXTURE) return "Final";
  const secs = secsOf(p);
  if (secs == null) return "\u2014";
  if (secs <= 0) return "Final";
  const g = games.get(p.tm);
  return g ? `${g.kickoff.toLocaleDateString([], { weekday: "short" })} ${fmtTime(g.kickoff)}` : "Not started";
};

const liveStats = {};   // `${teamId}:${index}` (bench: `b${index}`) -> mutated copy of st
const slotKey = (t, k, bench) => `${t.id}:${bench ? "b" : ""}${k}`;
const slotPlayer = (t, k, bench) => (bench ? t.bench : t.starters)[k];
const statsFor = (t, k, bench = false) => liveStats[slotKey(t, k, bench)] || slotPlayer(t, k, bench).st || {};

const ri = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const inc = (st, key, by = 1) => { st[key] = (st[key] || 0) + by; };

// Keep the line consistent with the bump: a TD adds the score and a
// plausible play; a small bump adds yardage (or a tackle) in proportion.
function bumpStats(t, k, pts, td, bench = false) {
  const key = slotKey(t, k, bench);
  const st = liveStats[key] || (liveStats[key] = { ...(slotPlayer(t, k, bench).st || {}) });
  const pos = slotPlayer(t, k, bench).pos;
  if (pos === "QB") {
    inc(st, "pass_cmp"); inc(st, "pass_att"); inc(st, "pass_yd", td ? ri(8, 35) : Math.round(pts * 25));
    if (td) inc(st, "pass_td");
  } else if (pos === "RB") {
    inc(st, "rush_att"); inc(st, "rush_yd", td ? ri(1, 25) : Math.round(pts * 10));
    if (td) inc(st, "rush_td");
  } else if (pos === "WR" || pos === "TE") {
    inc(st, "rec"); inc(st, "rec_tgt"); inc(st, "rec_yd", td ? ri(5, 40) : Math.round(pts * 10));
    if (td) inc(st, "rec_td");
  } else if (pos === "K") {
    if (pts >= 3) { inc(st, "fgm"); inc(st, "fga"); } else { inc(st, "xpm"); inc(st, "xpa"); }
  } else {
    inc(st, "idp_tkl"); inc(st, "idp_tkl_solo");
    if (td) { inc(st, "idp_int"); inc(st, "idp_td"); }
  }
}

const j = (parts) => parts.filter(Boolean).join(" \u00b7 ");
function statLine(pos, st) {
  if (!st || !Object.keys(st).length) return "";
  if (pos === "QB") return j([
    st.pass_att ? `${st.pass_cmp || 0}/${st.pass_att} · ${st.pass_yd || 0} YDS` : "",
    st.pass_td ? `${st.pass_td} TD` : "", st.pass_int ? `${st.pass_int} INT` : "",
    st.rush_yd ? `${st.rush_yd} RUSH` : "", st.rush_td ? `${st.rush_td} RUSH TD` : "",
  ]);
  if (pos === "RB") return j([
    st.rush_att ? `${st.rush_att} CAR · ${st.rush_yd || 0} YDS` : "", st.rush_td ? `${st.rush_td} TD` : "",
    st.rec ? `${st.rec} REC · ${st.rec_yd || 0} YDS` : "", st.rec_td ? `${st.rec_td} REC TD` : "",
    st.fum_lost ? `${st.fum_lost} FUM` : "",
  ]);
  if (pos === "WR" || pos === "TE") return j([
    st.rec_tgt || st.rec ? `${st.rec || 0}/${st.rec_tgt || st.rec || 0} REC · ${st.rec_yd || 0} YDS` : "",
    st.rec_td ? `${st.rec_td} TD` : "", st.rush_yd ? `${st.rush_yd} RUSH` : "", st.rush_td ? `${st.rush_td} RUSH TD` : "",
    st.fum_lost ? `${st.fum_lost} FUM` : "",
  ]);
  if (pos === "K") return j([
    st.fga ? `${st.fgm || 0}/${st.fga} FG` : "", st.xpa ? `${st.xpm || 0}/${st.xpa} XP` : "",
  ]);
  return j([
    st.idp_tkl ? `${st.idp_tkl} TKL${st.idp_tkl_solo ? ` (${st.idp_tkl_solo} solo)` : ""}` : "",
    st.idp_tkl_loss ? `${st.idp_tkl_loss} TFL` : "", st.idp_sack ? `${st.idp_sack} SCK` : "",
    st.idp_int ? `${st.idp_int} INT` : "", st.idp_ff ? `${st.idp_ff} FF` : "",
    st.idp_fum_rec ? `${st.idp_fum_rec} FR` : "", st.idp_pass_def ? `${st.idp_pass_def} PD` : "",
    st.idp_td ? `${st.idp_td} TD` : "",
  ]);
}

/* ---------------- spotlight ----------------
   A between-days card. After a day's games are all final, the day's
   highest-scoring STARTER (bench points do not count for anyone) gets a
   card under the hero; it goes away when the next day's games kick off.
   Once the week is official it becomes the MVP of the week, which stays
   until the next week begins. While a day is in progress there is no
   card. Which day a player's game belongs to is staged here; with the
   feed it comes from the schedule. */

const THU_NFL = new Set(["DET", "CLE"]);   // fixture: Thursday night, Browns at Lions
const isEarlyDay = (p) => (FIXTURE ? THU_NFL : dayTeams.early).has(p.tm);
const spotEl = document.getElementById("spot");
let lastSpotKey = null;

function spotlightPick() {
  const all = teams.flatMap((t) => liveStarters(t, new Set()).map((p) => ({ ...p, franchise: t.team })));
  let pool, label, when;
  if (slate.nextWeek) return { top: null, key: "none" };            // new week, nothing final yet
  if (slate.weekFinal) { pool = all; label = "\u2605 MVP of the week"; when = `Week ${WEEK} final`; }
  else if (slate.sunFinal) { pool = all.filter((p) => !isEarlyDay(p)); label = "Top scorer"; when = "Sunday"; }
  else return { top: null, key: "none" };                             // Sunday is in progress
  const top = pool.reduce((a, p) => (p.pts > a.pts ? p : a), pool[0]);
  return { top, label, when, mvp: slate.weekFinal, key: `${when}:${top?.key}` };
}

function renderSpotlight() {
  const { top, label, when, mvp, key } = spotlightPick();
  if (!top) { spotEl.hidden = true; lastSpotKey = key; return; }
  spotEl.hidden = false;
  const changed = lastSpotKey !== null && key !== lastSpotKey;
  const phaseChanged = changed && key.split(":")[0] !== lastSpotKey.split(":")[0];
  lastSpotKey = key;
  spotEl.classList.toggle("mvp", mvp);
  const logo = logoSrc(top.tm) ? `<span class="logo"><img src="${logoSrc(top.tm)}" alt=""></span>` : `<span class="logo">${esc(top.tm)}</span>`;
  spotEl.innerHTML =
    (phaseChanged && mvp && !reducedMotion.matches ? `<span class="spot-flash" aria-hidden="true"></span>` : "") +
    `<div class="spot-top"><span class="micro spot-label">${label}</span><span class="spot-when">${esc(when)}</span></div>` +
    `<div class="spot-body"${changed ? "" : ` style="animation:none"`}>` +
      `<span class="spot-face">${avatar(top)}${logo}</span>` +
      `<span class="spot-who">` +
        `<span class="spot-name">${esc(top.n)}</span>` +
        `<span class="spot-meta"><span class="pos ${posClass(top.pos)}">${esc(top.pos)}</span><span>${esc(top.tm)}</span></span>` +
        `<span class="spot-stat">${esc(statLine(top.pos, top.st))}</span>` +
        `<span class="spot-for">for <b>${esc(top.franchise)}</b></span>` +
      `</span>` +
      `<span class="spot-pts" data-tween="p:${top.key}">${fmt(top.pts)}</span>` +
    `</div>`;
}

/* ---------------- team page ---------------- */

const POS_CLASS = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K" };
const posClass = (pos) => "pos-" + (POS_CLASS[pos] || "IDP");

// Lineup order -- reads like a lineup card, not a points ranking.
const POS_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DE: 5, DT: 5, LB: 6, CB: 7, S: 7 };
const byLineup = (a, b) =>
  (POS_ORDER[a.pos] ?? 9) - (POS_ORDER[b.pos] ?? 9) || b.pts - a.pts;
// Position groups in the Team view, in lineup order: one labelled hairline
// opens each. Every defender is IDP, the league's one defensive slot type.
const posGroup = (pos) => (POS_CLASS[pos] ? pos : "IDP");
const rosterHtml = (list, bench, isTop) => {
  let last = null;
  return [...list].sort(byLineup).map((p) => {
    const g = posGroup(p.pos);
    const sep = g === last ? "" : `<div class="pgroup" data-g="${g}" role="presentation"><span>${g}</span></div>`;
    last = g;
    return sep + playerRow(p, bench, !bench && isTop(p));
  }).join("");
};

const initials = (name) => name.split(/[\s-]+/).filter(Boolean)
  .map((w) => w[0]).slice(0, 2).join("").toUpperCase();

// A CDN headshot that fails (403 for an unknown id) swaps to the initials.
const avatar = (p) => {
  const src = headshotSrc(p);
  if (src) return `<img class="avatar" src="${src}" alt="" decoding="async" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'), { className: 'avatar-fb', textContent: this.dataset.fb }))" data-fb="${esc(initials(p.n))}">`;
  return `<span class="avatar-fb" aria-hidden="true">${esc(initials(p.n))}</span>`;
};

const logoBadge = (tm) => logoSrc(tm) ? `<span class="plogo"><img src="${logoSrc(tm)}" alt="" loading="lazy"></span>` : "";

// Touchdowns from the stat line (all kinds), so a simulated score adds the
// chip live. IDP scores use the mockup's own idp_td key.
const tdCount = (st) => (st ? (st.pass_td || 0) + (st.rush_td || 0) + (st.rec_td || 0) + (st.idp_td || 0) : 0);
const tdBadge = (st) => { const n = tdCount(st); return n ? `<span class="ptd">${n > 1 ? n + " " : ""}TD</span>` : ""; };

// top: the team's highest-scoring starter gets a gold ring (MVP echo).
const playerRow = (p, bench, top = false) => {
  const dim = bench && phase !== "preseason";   // pre-season the roster is nobody's bench
  return `<div class="prow${dim ? " bench" : ""}${dim && p.pts === 0 ? " zero" : ""}${isLive(p) ? " live" : ""}${top ? " top" : ""}">` +
    `<span class="pface">${avatar(p)}${logoBadge(p.tm)}${tdBadge(p.st)}</span>` +
    `<span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span>` +
    `<span class="pname"><b>${esc(p.n)}</b>` +
      `<span class="pmeta">${esc(p.tm)}<span aria-hidden="true">·</span>` +
        (isLive(p) ? `<span class="clock"><span class="dot"></span>${clockFor(p)}</span>` : `<span>${esc(gameLabel(p))}</span>`) +
      `</span>` +
      `<span class="pstat">${esc(statLine(p.pos, p.st))}</span>` +
    `</span>` +
    `<span class="ppts${p.pts === 0 ? " zero" : ""}${p.flash ? " flash" : ""}"${p.key ? ` data-tween="p:${p.key}" data-delta` : ""}>${phase === "preseason" ? "&mdash;" : fmt(p.pts)}</span>` +
  `</div>`;
};

const page = document.getElementById("team");
const rosterEl = document.getElementById("roster");
const tabs = [...page.querySelectorAll(".tab")];
let open = null;       // team id
let tab = "starters";
let lastFocus = null;

// Starters with any live bumps applied, in fixture order.
const liveStarters = (t, changed) => t.starters.map((p, k) => {
  const key = `${t.id}:${k}`;
  return { ...p, key, pts: r2(p.pts + (playerBump[key] || 0)), flash: changed.has(key), st: statsFor(t, k) };
});

const liveBench = (t, changed) => t.bench.map((p, k) => {
  const key = `${t.id}:b${k}`;
  return { ...p, key, pts: r2(p.pts + (benchBump[key] || 0)), flash: changed.has(key), st: statsFor(t, k, true) };
});

function renderTeam(changed = new Set()) {
  const t = byId(open);
  const starters = liveStarters(t, changed);
  const bench = liveBench(t, changed);

  const pre = phase === "preseason";
  document.getElementById("team-rank").textContent = pre ? t.team.trim()[0] || "?" : t.rank;
  document.getElementById("team-week").textContent = `Week ${WEEK}`;
  const statusEl = document.getElementById("team-status");
  statusEl.hidden = pre;
  statusEl.innerHTML = statusOf(t);
  document.getElementById("team-name").innerHTML = `${franchiseIcon(t, "hero-icon")}${esc(t.team)}`;
  document.getElementById("team-rec").textContent = pre
    ? (starters.length ? `pre-season \u00b7 ${starters.length} starters set` : "pre-season \u00b7 lineup due at kickoff")
    : `${t.record} all-play`;
  const ptsEl = document.getElementById("team-pts");
  ptsEl.textContent = pre ? "\u2014" : fmt(t.live);
  ptsEl.dataset.tween = `pts:${t.id}`;
  ptsEl.dataset.delta = "";
  ptsEl.classList.toggle("flash", changed.has(t.id));
  const stEl = document.getElementById("tab-starters-n");
  stEl.textContent = pre ? String(starters.length) : fmt(sum(starters));   // counts, not points, before the season
  stEl.dataset.tween = `starters:${t.id}`;

  // No lineup yet (pre-season, or before a franchise submits one): a single
  // Roster tab lists everyone instead of an empty Starters tab.
  const noLineup = starters.length === 0;
  document.querySelector('.tab[data-tab="starters"]').hidden = noLineup;
  const benchTab = document.querySelector('.tab[data-tab="bench"]');
  benchTab.firstChild.nodeValue = noLineup ? "Roster " : "Bench ";
  document.getElementById("tab-bench-n").textContent = noLineup ? `${bench.length} players` : pre ? String(bench.length) : `${fmt(sum(bench))} behind`;
  // Shown, not stored: the chosen tab survives until a lineup exists, so
  // the pane lands on Starters when the board goes live (or a lineup is set).
  const view = noLineup ? "bench" : tab;

  const list = view === "bench" ? bench : starters;
  const topPts = Math.max(0, ...starters.map((p) => p.pts));
  const isTop = (p) => !bench.includes(p) && topPts > 0 && p.pts === topPts;
  tabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === view)));
  rosterEl.innerHTML = list.length
    ? rosterHtml(list, view === "bench", isTop)
    : `<p class="empty">No ${view} on this roster.</p>`;
}

// Laptop and up: the team panel is always in view, so "opening" a team is
// selecting it. The selected row becomes a tab into the panel.
const desktop = matchMedia("(min-width: 1024px)");

// The pane's background is a top-to-bottom gradient; the tab needs the
// pane's colour at its own height, so each active element is told how far
// down the pane it sits (--tab-t) and the CSS mixes the matching colour.
function markActive() {
  const pane = page.getBoundingClientRect();
  const place = (el, on) => {
    el.classList.toggle("active", on);
    if (!on || !pane.height) return;
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (r.top + r.height / 2 - pane.top) / pane.height));
    el.style.setProperty("--tab-t", `${(t * 100).toFixed(2)}%`);
  };
  for (const el of rowsEl.querySelectorAll(".row")) place(el, desktop.matches && el.dataset.id === open);
  place(document.getElementById("hero-wrap"), desktop.matches && teams[0]?.id === open);
}
addEventListener("resize", () => { if (desktop.matches) markActive(); });

function openTeam(id) {
  open = id; tab = "starters";
  renderTeam();
  markActive();
  if (desktop.matches) return;   // the panel is already showing it

  lastFocus = document.activeElement;
  page.dataset.open = "true";
  page.scrollTop = 0;
  document.body.classList.add("team-open");   // board keeps its scroll position
  document.getElementById("back").focus();
}

function closeTeam() {
  if (desktop.matches) return;   // nothing to close; the panel stays
  if (page.dataset.open !== "true") return;
  page.dataset.open = "closing";   // fades out, then unmounts below
  document.body.classList.remove("team-open");
  open = null;
  if (lastFocus) lastFocus.focus();

  // animationend does not fire under prefers-reduced-motion, so a timer
  // backs it up; whichever lands first unmounts the page.
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    page.removeEventListener("animationend", finish);
    if (page.dataset.open === "closing") page.dataset.open = "false";
  };
  page.addEventListener("animationend", finish);
  setTimeout(finish, 300);
}

rowsEl.addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (row) openTeam(row.dataset.id);
});
hero.addEventListener("click", () => openTeam(teams[0].id));
document.getElementById("back").addEventListener("click", closeTeam);
// The lone Roster tab (no lineup yet) is not a choice: remember only a
// real Starters/Bench pick, so the flip to live still lands on Starters.
tabs.forEach((b) => b.addEventListener("click", () => { if (!b.hidden && !tabs.some((o) => o.hidden)) tab = b.dataset.tab; renderTeam(); }));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (witch.dataset.open === "true") endWitchingHour();
  else if (tdModal.dataset.open === "true") dismissTouchdown();
  else if (page.dataset.open === "true") closeTeam();
});

/* ---------------- touchdown announcements ----------------
   One card at a time, TD_MS each, queued in arrival order so two scores
   in the same poll both get their moment. In the mockup a touchdown is a
   simulated event (below). With the feed wired, MFL exposes only fantasy
   points, so the trigger would be a single starter jumping by a
   touchdown's worth of points between polls. */

const TD_MS = 4000;
const tdModal = document.getElementById("td-modal");
const tdCard = document.getElementById("td-card");
const tdQueue = [];
let tdTimer = null;
let tdShowing = false;

const teamLogo = (tm) => logoSrc(tm)
  ? `<span class="td-logo"><img src="${logoSrc(tm)}" alt=""></span>`
  : `<span class="td-logo">${esc(tm)}</span>`;

const bigShot = (p) => headshotSrc(p)
  ? `<img class="td-shot" src="${headshotSrc(p)}" alt="">`
  : `<span class="td-shot">${esc(initials(p.n))}</span>`;

// One span per letter so each can stomp in on its own beat.
const chant = (text) => `<span class="td-chant" aria-hidden="true">` +
  [...text].map((ch, i) => ch === " " ? `<span class="sp" style="--i:${i}"></span>` : `<span style="--i:${i}">${esc(ch)}</span>`).join("") +
  `</span>`;

function renderTdMore() {
  const el = document.getElementById("td-more");
  if (!el) return;
  el.hidden = tdQueue.length === 0;
  el.textContent = `+${tdQueue.length} more`;
}

function showNextTouchdown() {
  const ev = tdQueue.shift();
  if (!ev) { tdShowing = false; tdModal.dataset.open = "false"; return; }
  tdShowing = true;
  const p = ev.player;
  tdCard.style.setProperty("--td-ms", `${TD_MS}ms`);
  tdModal.classList.toggle("td-chi", p.tm === "CHI");
  tdCard.innerHTML =
    `<span class="td-rays" aria-hidden="true"></span>` +
    `<span class="td-flash" aria-hidden="true"></span>` +
    `<span class="td-more" id="td-more" hidden></span>` +
    `<span class="td-word">Touchdown</span>` +
    (p.tm === "CHI" ? chant("Bear down!") : "") +
    `<span class="td-face">${bigShot(p)}${teamLogo(p.tm)}</span>` +
    `<span class="td-name">${esc(p.n)}</span>` +
    `<span class="td-meta"><span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span><span>${esc(p.tm)}</span></span>` +
    `<span class="td-for">for <b>${esc(ev.franchise)}</b></span>` +
    `<span class="td-pts">+${fmt(ev.pts)}</span>` +
    `<span class="td-bar" aria-hidden="true"></span>`;
  renderTdMore();
  tdModal.dataset.open = "true";
  clearTimeout(tdTimer);
  tdTimer = setTimeout(dismissTouchdown, TD_MS);
}

// Ends the current card early or on time; the next queued one follows
// after the exit animation so each score reads as its own card.
function dismissTouchdown() {
  clearTimeout(tdTimer);
  if (tdModal.dataset.open !== "true") return;
  tdModal.dataset.open = "closing";
  setTimeout(showNextTouchdown, 240);
}

// Rule: only a starter's touchdown gets a card. Bench points never reach
// the franchise total, so a bench score is just a row in the Bench tab.
// With the feed, this is liveScoring's per-player `status: "starter"`.
function announceTouchdown(ev) {
  if (!ev.starter) return;
  tdQueue.push(ev);
  if (tdShowing) renderTdMore(); else showNextTouchdown();
}

document.getElementById("td-scrim").addEventListener("click", dismissTouchdown);

/* ---------------- The Witching Hour ----------------
   NFL RedZone's 2:30 PM Central moment: the early games reach their
   fourth quarters at once, and Scott Hanson calls it. Every Sunday at
   that time the board gives way to a ten-second full-screen take on the
   RedZone graphic, in three cuts (a tilted close-up with the hands
   racing, the clock upright as they settle on 2:30, then WITCHING HOUR
   stacked over the clock on a neon-lit wall), then fades back. A click or Escape skips it. */

const WITCH_MS = 10000;
const WITCH_CUTS = [2500, 5000];   // when cuts 2 and 3 begin
const WITCH_EXIT_MS = 1100;        // the exit: title flies at the camera, halves sweep open
const WITCH_TZ = "America/Chicago", WITCH_HOUR = 14, WITCH_MINUTE = 30;
const witch = document.getElementById("witch");
const witchScene = document.getElementById("witch-scene");
const witchTimers = [];

// One clock, drawn three times (one per cut); the gradient id is suffixed
// because a gradient defined inside a hidden cut does not paint.
function witchClock(k) {
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const major = i % 5 === 0;
    return `<line x1="200" y1="${major ? 22 : 26}" x2="200" y2="${major ? 42 : 36}" transform="rotate(${i * 6} 200 200)" class="w-tick${major ? " w-major" : ""}"/>`;
  }).join("");
  const nums = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1, a = (n * 30 - 90) * Math.PI / 180, r = 146;
    return `<text x="${(200 + r * Math.cos(a)).toFixed(1)}" y="${(200 + r * Math.sin(a)).toFixed(1)}" class="w-num">${n}</text>`;
  }).join("");
  return `<div class="w-clock"><svg viewBox="0 0 400 400" aria-hidden="true">` +
    `<defs><radialGradient id="w-face-${k}" cx="40%" cy="34%" r="76%">` +
      `<stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#f2eced"/><stop offset="1" stop-color="#d6cbcd"/></radialGradient></defs>` +
    `<circle class="w-rim" cx="200" cy="200" r="190"/>` +
    `<circle cx="200" cy="200" r="186" fill="url(#w-face-${k})"/>` +
    `<g>${ticks}</g>${nums}` +
    `<g class="w-hand w-hour"><path d="M200 214 L192 200 L200 104 L208 200 Z"/></g>` +
    `<g class="w-hand w-min"><path d="M200 218 L194 200 L200 44 L206 200 Z"/></g>` +
    `<line class="w-sec" x1="200" y1="232" x2="200" y2="40"/>` +
    `<circle cx="200" cy="200" r="7" fill="#141012"/><circle cx="200" cy="200" r="3" fill="#e5321c"/>` +
    `</svg></div>`;
}

function witchMarkup() {
  // The wall behind every cut: neon bars down both sides, a few short
  // horizontals, each flickering on its own offset.
  const neon = [
    ["left:4.5%", -0.3], ["left:8.5%", -1.1], ["right:4.5%", -0.7], ["right:8.5%", -1.5],
    ["left:0;width:9%;top:32%", -0.5, "h"], ["left:0;width:9%;top:58%", -1.3, "h"],
    ["right:0;width:9%;top:26%", -0.9, "h"], ["right:0;width:9%;top:64%", -0.2, "h"],
  ].map(([pos, d, h]) => `<span class="w-neon${h ? " h" : ""}" style="${pos};animation-delay:${d}s"></span>`).join("");
  const wall = `<span class="w-wall"></span>${neon}`;
  const film = `<span class="w-scan"></span><span class="w-grain"></span><span class="w-vignette"></span>`;
  // Letters stomp in one by one, WITCHING then HOUR.
  const word = (w, cls) => `<span class="${cls}">${[...w].map((c, i) => `<span style="--i:${i}">${c}</span>`).join("")}</span>`;
  // Cut 3 is drawn twice, clipped to the top and bottom halves of the
  // screen, so the exit can sweep the two halves apart.
  const card = (k) => `${wall}<span class="w-flash"></span><div class="w-stage">` +
    `<div class="w-title">${word("Witching", "w-l1")}${word("Hour", "w-l2")}</div>${witchClock(k)}</div>${film}`;
  return `<div class="w-shot w-shot-1">${wall}<div class="w-cam">${witchClock(1)}</div>${film}</div>` +
    `<div class="w-shot w-shot-2">${wall}<div class="w-cam">${witchClock(2)}</div>${film}</div>` +
    `<div class="w-shot w-shot-3"><div class="w-half w-top">${card(3)}</div><div class="w-half w-bot">${card(4)}</div></div>`;
}

function playWitchingHour() {
  if (witch.dataset.open === "true") return;
  const still = reducedMotion.matches;          // the card alone, held briefly
  const ms = still ? 3500 : WITCH_MS;
  witchScene.innerHTML = witchMarkup();
  witch.dataset.shot = still ? "3" : "1";
  witch.dataset.open = "true";
  witchTimers.forEach(clearTimeout); witchTimers.length = 0;
  if (!still) {
    witchTimers.push(setTimeout(() => { witch.dataset.shot = "2"; }, WITCH_CUTS[0]));
    witchTimers.push(setTimeout(() => { witch.dataset.shot = "3"; }, WITCH_CUTS[1]));
  }
  witchTimers.push(setTimeout(endWitchingHour, ms - WITCH_EXIT_MS));   // the exit is the last stretch
}
function endWitchingHour() {
  witchTimers.forEach(clearTimeout); witchTimers.length = 0;
  if (witch.dataset.open !== "true") return;
  witch.dataset.open = "closing";
  // Tracked, so a replay during the exit is not wiped by the old exit's end.
  witchTimers.push(setTimeout(() => { witch.dataset.open = "false"; witchScene.innerHTML = ""; }, WITCH_EXIT_MS));
}
witch.addEventListener("click", endWitchingHour);
// No demo bar on main: ?witch=1 plays it once the board is up, for checking.

// Scheduling. Sunday 2:30 PM in Chicago's zone, whatever the viewer's
// clock says; the instant is found by reading a guess back through
// Intl and correcting for the offset (twice covers a DST edge). Fires
// once per Sunday per browser; a hidden tab plays it when shown again,
// as long as that is within the hour.
const zoneParts = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-US", {
  timeZone: WITCH_TZ, hourCycle: "h23", weekday: "short",
  year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
}).formatToParts(d).map((x) => [x.type, x.value]));
function zonedInstant(y, m, d, h, mi) {
  const want = Date.UTC(y, m - 1, d, h, mi);
  let t = want;
  for (let k = 0; k < 2; k++) {
    const p = zoneParts(new Date(t));
    t += want - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  }
  return t;
}
function nextWitchingHour(now = Date.now()) {
  for (let k = 0; k < 8; k++) {
    const p = zoneParts(new Date(now + k * 864e5));
    if (p.weekday !== "Sun") continue;
    const t = zonedInstant(+p.year, +p.month, +p.day, WITCH_HOUR, WITCH_MINUTE);
    if (t > now - 90e3) return t;   // a page opened just after 2:30 still gets it
  }
  return null;
}
function scheduleWitchingHour() {
  const t = nextWitchingHour();
  if (t == null) return;
  const key = "mfl-live-witch", stamp = String(t);
  const fire = () => {
    try { if (localStorage.getItem(key) === stamp) return; localStorage.setItem(key, stamp); } catch {}
    if (!document.hidden) { playWitchingHour(); return; }
    const onShow = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", onShow);
      if (Date.now() - t < 3600e3) playWitchingHour();
    };
    document.addEventListener("visibilitychange", onShow);
  };
  setTimeout(() => { fire(); setTimeout(scheduleWitchingHour, 120e3); }, Math.min(Math.max(0, t - Date.now()), 2 ** 31 - 1));
}
scheduleWitchingHour();

/* ---------------- theme ----------------
   Dark-first: no stamp means dark, and the light palette is an explicit
   opt-in via data-theme on the root. The choice is remembered per browser
   (index.html stamps it before first paint); nothing stored means dark. */

const THEME_KEY = "mfl-live-theme";

const root = document.documentElement;
const segBtns = [...document.querySelectorAll(".seg-btn")];
const effective = () => (root.dataset.theme === "light" ? "light" : "dark");

function syncTheme() {
  const now = effective();
  segBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === now)));
}
segBtns.forEach((b) => b.addEventListener("click", () => {
  root.dataset.theme = b.dataset.theme;
  try { localStorage.setItem(THEME_KEY, b.dataset.theme); } catch {}
  syncTheme();
}));
syncTheme();

/* ---------------- loading the data ---------------- */

const toArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const SLEEPER_TEAM = { SFO: "sf", NEP: "ne", GBP: "gb", KCC: "kc", TBB: "tb", NOS: "no", LVR: "lv", JAC: "jax" };
const sleeperTeam = (tm) => SLEEPER_TEAM[tm] || String(tm).toLowerCase();

async function api(type, params = {}) {
  const u = new URL("api/mfl", location.href);
  u.searchParams.set("type", type);
  for (const [k, v] of Object.entries(params)) if (v !== "" && v != null) u.searchParams.set(k, v);
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) throw new Error(`${type}: HTTP ${res.status}`);
  return res.json();   // { ok: true, data } | { ok: false, error }
}

// The fixture: data.js is loaded only when needed (it is 2.2MB of base64).
// In the bundle it is inlined ahead of this script and MFL_FIXTURE is set.
function loadFixture() {
  FIXTURE = true;
  const apply = () => {
    rosters = ROSTERS;
    headshotSrc = (p) => (p.sid && HEADSHOTS[p.sid]) || null;
    logoSrc = (tm) => LOGOS[tm] || null;
    WEEK = 12; UPDATED = "4:12 PM"; phase = "live";
  };
  if (typeof ROSTERS !== "undefined") { apply(); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "data.js";
    s.onload = () => { apply(); resolve(); };
    s.onerror = () => reject(new Error("data.js failed to load"));
    document.head.append(s);
  });
}

let playerInfo = {};          // MFL player id -> { n, pos, tm, sid }
let names = new Map();        // franchise id -> name (trimmed by the server)
let icons = new Map();        // franchise id -> icon URL, when one is set in MFL
let opener = "";              // "NEP at SEA", the week's first game (live source)
let rosterIds = new Map();    // franchise id -> [player ids]
let lastScores = new Map();   // `${franchise}:${player}` -> score at the previous poll
let scheduleAt = 0;           // when the NFL schedule was last fetched
const SCHEDULE_EVERY = 5 * 60e3;

const mkPlayer = (id, pts = 0, secs = null) => {
  const i = playerInfo[id] || {};
  // MFL spells kickers "PK"; the page's positions (and the league's lineup
  // rule) say K. Every defensive position maps to the one IDP colour later.
  const pos = i.pos === "PK" ? "K" : (i.pos || "?");
  return { id, n: i.n || `#${id}`, pos, tm: i.tm || "", pts, sid: i.sid || null, st: {}, secs };
};

async function ensurePlayers(ids) {
  const missing = [...new Set(ids)].filter((id) => !playerInfo[id]);
  if (!missing.length) return;
  const pm = await api("playersMap", { PLAYERS: missing.join(",") });
  if (pm.ok) Object.assign(playerInfo, pm.data.players);
}

async function loadLeague() {
  showLoading("Connecting to the league\u2026");
  const [lg, rs] = await Promise.all([api("league"), api("rosters")]);
  for (const r of [lg, rs]) if (!r.ok) throw new Error(`${r.type}: ${r.error}`);
  const fr = toArray(lg.data.league?.franchises?.franchise);
  names = new Map(fr.map((f) => [f.id, f.name]));
  icons = new Map(fr.filter((f) => f.icon || f.logo).map((f) => [f.id, f.icon || f.logo]));
  rosterIds = new Map(toArray(rs.data.rosters?.franchise).map((f) => [f.id, toArray(f.player).map((p) => p.id)]));
  headshotSrc = (p) => (p.sid ? `https://sleepercdn.com/content/nfl/players/thumb/${p.sid}.jpg` : null);
  logoSrc = (tm) => (tm ? `https://sleepercdn.com/images/team_logos/nfl/${sleeperTeam(tm)}.png` : null);
  showLoading("Pulling the live feed\u2026");
  await refreshLive(true);
}

// One poll: schedule + liveScoring for the week. Returns the set of changed
// keys for the renderer (team ids and `${teamId}:${starterIndex}`), and
// announces any starter whose score jumped by a touchdown's worth.
async function refreshLive(first = false) {
  const w = QUERY.get("w") || "";
  // The schedule is fetched every few minutes, not every poll: kickoffs do
  // not move, and in season each player's own clock comes with liveScoring.
  const wantSchedule = first || !games.size || Date.now() - scheduleAt > SCHEDULE_EVERY;
  const [ls, sch] = await Promise.all([api("liveScoring", { W: w, DETAILS: "1" }), wantSchedule ? api("nflSchedule", { W: w }) : null]);

  if (sch) {
  scheduleAt = Date.now();
  games = new Map();
  let firstKick = null;
  for (const m of toArray(sch.ok ? sch.data.nflSchedule?.matchup : [])) {
    const k = new Date(Number(m.kickoff) * 1000);
    const secs = Number(m.gameSecondsRemaining);
    if (!firstKick || k < firstKick) {
      firstKick = k;
      const [a, b] = toArray(m.team);
      const away = a?.isHome === "1" ? b : a, home = a?.isHome === "1" ? a : b;
      opener = away && home ? `${away.id} at ${home.id}` : "";
    }
    for (const t of toArray(m.team)) games.set(t.id, { kickoff: k, secs: Number.isFinite(secs) ? secs : 3600 });
  }
  kickoff = firstKick;
  // The week's first game day (Thursday, usually) is its own spotlight day.
  const days = [...new Set([...games.values()].map((g) => g.kickoff.toDateString()))].sort((a, b) => new Date(a) - new Date(b));
  dayTeams.early = new Set(days.length > 1 ? [...games].filter(([, g]) => g.kickoff.toDateString() === days[0]).map(([tm]) => tm) : []);
  }

  const changed = new Set();
  if (!ls.ok) {
    // "Live scoring not available until the season starts" is a state, not
    // a failure. Anything else mid-season is transient: keep what we have.
    if (!/not available/i.test(ls.error)) { if (first) throw new Error(`liveScoring: ${ls.error}`); return changed; }
    phase = "preseason";
    WEEK = Number(w) || 1;
    // Lineups exist before live scoring does: weeklyResults carries each
    // franchise's submitted (or default) starters for the week.
    // Lineups are a nice-to-have on top of the league: never let them sink the load.
    const wr = await api("weeklyResults", { W: w || String(WEEK) }).catch((e) => ({ ok: false, error: String(e) }));
    const lineup = new Map(toArray(wr.ok ? wr.data.weeklyResults?.franchise : []).map((f) =>
      [f.id, new Set(toArray(f.player).filter((p) => p.status === "starter").map((p) => p.id))]));
    await ensurePlayers([...rosterIds.values()].flat());
    rosters = [...names].map(([id, team]) => {
      const ids = rosterIds.get(id) || [], st = lineup.get(id) || new Set();
      return {
        id, team, icon: icons.get(id) || null, pts: 0, toPlay: 0,
        starters: ids.filter((pid) => st.has(pid)).map((pid) => mkPlayer(pid)),
        bench: ids.filter((pid) => !st.has(pid)).map((pid) => mkPlayer(pid)),
      };
    });
    slate.sunFinal = false;
    return changed;
  }

  phase = "live";
  const L = ls.data.liveScoring;
  WEEK = Number(L.week) || WEEK;
  const franchises = toArray(L.franchise);
  await ensurePlayers([...rosterIds.values()].flat().concat(franchises.flatMap((f) => toArray(f.players?.player).map((p) => p.id))));

  const next = new Map();
  rosters = franchises.map((f) => {
    const ps = toArray(f.players?.player);
    const started = ps.filter((p) => p.status === "starter");
    const startedIds = new Set(started.map((p) => p.id));
    const row = (p) => mkPlayer(p.id, Number(p.score) || 0, Number.isFinite(Number(p.gameSecondsRemaining)) ? Number(p.gameSecondsRemaining) : null);
    const byId = new Map(ps.map((p) => [p.id, p]));
    const benchIds = [...new Set([...(rosterIds.get(f.id) || []), ...ps.map((p) => p.id)])].filter((id) => !startedIds.has(id));
    const team = {
      id: f.id, team: names.get(f.id) || f.id, icon: icons.get(f.id) || null,
      pts: Number(f.score) || 0, toPlay: Number(f.playersYetToPlay) || 0,
      starters: started.map(row),
      bench: benchIds.map((id) => (byId.get(id) ? row(byId.get(id)) : mkPlayer(id))),
    };
    team.starters.forEach((p, k) => {
      const key = `${f.id}:${p.id}`;
      const prev = lastScores.get(key);
      next.set(key, p.pts);
      if (prev != null && p.pts !== prev) {
        changed.add(f.id).add(`${f.id}:${k}`);
        // MFL gives points only, so a touchdown is a starter jumping by at
        // least six between polls (CLAUDE.md).
        if (p.pts - prev >= 6) announceTouchdown({ player: p, franchise: team.team, pts: r2(p.pts - prev), starter: true });
      }
    });
    return team;
  });
  lastScores = next;
  slate.sunFinal = games.size > 0 && [...games.values()].every((g) => g.secs <= 0);
  UPDATED = fmtTime(new Date());
  return changed;
}

/* Polling budget. MFL rate-limits and asks clients to back off, so:
   - in season, liveScoring every 30s (the proxy holds it 15s, so several
     open pages still cost MFL at most four calls a minute);
   - before the season, everything every 5 minutes -- the countdown ticks
     locally and lineups do not change by the second;
   - nothing at all while the tab is hidden; a poll runs as soon as it is
     shown again. */
const POLL_LIVE_MS = 30e3, POLL_PRESEASON_MS = 5 * 60e3;
let pollTimer = null, polling = false;

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollLive, phase === "live" ? POLL_LIVE_MS : POLL_PRESEASON_MS);
}

async function pollLive() {
  if (polling) return;
  if (document.hidden) { clearTimeout(pollTimer); return; }   // resumes on visibilitychange
  polling = true;
  try {
    const changed = await refreshLive();
    derive();
    render(changed);
  } catch (err) {
    console.warn("poll failed, keeping the last board:", err);
  } finally {
    polling = false;
    schedulePoll();
  }
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !FIXTURE) pollLive();
});

/* ---------------- loading + first-load cascade ----------------
   The mockup has nothing to fetch: the interstitial holds for a beat (fonts,
   image decode) and then hands off to the cascade. With the feed wired,
   showLoading() would stay up until the first liveScoring poll lands. */

const loader = document.getElementById("loader");
const loaderMsg = document.getElementById("loader-msg");
const MIN_LOAD_MS = 2800;   // long enough for the scene to play through once

function showLoading(msg) {
  if (msg) loaderMsg.textContent = msg;
  loader.hidden = false;
  loader.classList.remove("out");
}
function hideLoading() {
  loader.classList.add("out");
  setTimeout(() => { loader.hidden = true; }, 450);
}

// Top to bottom: every block on the board, then each standings row and
// divider in order, then the laptop pane.
function cascadeIn() {
  if (reducedMotion.matches) return;
  const app = document.getElementById("app");
  const targets = [
    ...[...document.querySelectorAll(".col-board > *")].flatMap((el) =>
      el.classList.contains("standings") ? [el.querySelector(".standings-head"), ...rowsEl.children] : [el]),
    page,
  ].filter((el) => el && !el.hidden);
  targets.forEach((el, i) => { el.classList.add("cascade"); el.style.setProperty("--i", i); });
  app.classList.add("intro");
  setTimeout(() => {
    app.classList.remove("intro");
    targets.forEach((el) => { el.classList.remove("cascade"); el.style.removeProperty("--i"); });
  }, targets.length * 55 + 700);
}

const loadStart = performance.now();

async function boot() {
  try {
    if (FIXTURE) await loadFixture(); else await loadLeague();
  } catch (err) {
    // No proxy (the artifact, offline, a bad deploy): the POC's fixture.
    console.warn("Live league unavailable, showing the fixture:", err);
    showLoading("Loading the fixture\u2026");
    await loadFixture();
  }
  derive();
  render();
  if (desktop.matches) openTeam(teams[0].id);
  await document.fonts.ready;
  const wait = Math.max(0, MIN_LOAD_MS - (performance.now() - loadStart));
  setTimeout(() => { cascadeIn(); hideLoading(); if (QUERY.has("witch")) playWitchingHour(); }, wait);
  if (!FIXTURE) schedulePoll();
}

// Crossing the breakpoint: the panel needs a team when it appears, and
// the overlay must not be left open when it goes back to being one.
desktop.addEventListener("change", (e) => {
  page.dataset.open = "false";
  document.body.classList.remove("team-open");
  // Before the first render there is no team to show; boot() opens one.
  if (e.matches) { if (open === null && teams.length) open = teams[0].id; if (open !== null) renderTeam(); }
  else open = null;
  markActive();
});

boot();
