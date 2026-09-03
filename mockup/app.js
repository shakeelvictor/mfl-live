// Illustrative mid-slate framing. The fixture is a finished week, so the
// clock, starters yet to play and "on now" are staged to show the board
// in progress. liveScoring supplies the real values (playersYetToPlay,
// gameSecondsRemaining) once the feed is wired.
const WEEK = 12;
const UPDATED = "4:12 PM";
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
  teams = ROSTERS
    .map((t) => ({
      ...t,
      live: r2(t.pts + (teamBump[t.id] || 0)),
      toPlay: slate.sunFinal ? 0 : (YET_TO_PLAY[t.team] ?? 0),
      onNow: t.starters.some(isLive),
    }))
    .sort((a, b) => b.live - a.live)
    .map((t, i, arr) => ({ ...t, rank: i + 1, record: `${arr.length - 1 - i}-${i}` }));
  gaps = teams.slice(0, -1).map((t, i) => r2(t.live - teams[i + 1].live));
}

const n = ROSTERS.length;
const byId = (id) => teams.find((t) => t.id === id);
const tier = (g) => (g < CRITICAL ? "critical" : g < LIVE ? "live" : "settled");
const hot = (g) => g !== undefined && tier(g) !== "settled";
const TIER_LABEL = { critical: "Coin flip", live: "Live", settled: "Settled" };

const statusOf = (t) => t.toPlay === 0
  ? "all played"
  : `${t.toPlay} to play${t.onNow ? " &middot; on now" : ""}`;

/* ---------------- static chrome ---------------- */

document.getElementById("week-title").textContent = `Week ${WEEK}`;
document.getElementById("subhead").innerHTML =
  `All-play &middot; every team plays every other team &middot; updated ${esc(UPDATED)}`;
document.getElementById("franchise-count").textContent = `${n} franchises`;
document.getElementById("legend").innerHTML =
  `<span class="critical">under ${CRITICAL.toFixed(2)} &mdash; coin flip</span>` +
  `<span class="live">under ${LIVE.toFixed(1)} &mdash; live</span>` +
  `<span>settled</span>`;

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
  const within = new Set(gaps.flatMap((g, i) => (g < WITHIN ? [i, i + 1] : []))).size;
  const atStake = gaps.filter((g) => g < WITHIN).length;
  const startersLeft = teams.reduce((s, t) => s + t.toPlay, 0);
  document.getElementById("capsules").innerHTML =
    `<span class="capsule"><b>${within}</b>within ${WITHIN.toFixed(1)}</span>` +
    `<span class="capsule"><b>${atStake}</b>wins at stake</span>` +
    `<span class="capsule"><b class="accent">${startersLeft}</b>starters left</span>`;
}

function renderHero(changed, takeover) {
  const lead = teams[0], chaser = teams[1], lt = tier(gaps[0]);
  heroBody.innerHTML =
    `<div class="hero-top">` +
      `<span class="micro hero-label"><span class="badge">1</span>${weekIsFinal() ? `Week ${WEEK} winner` : takeover ? "New leader" : `Leading Week ${WEEK}`}</span>` +
      `<span class="hero-status">${statusOf(lead)}</span>` +
    `</div>` +
    `<div class="hero-mid">` +
      `<div class="hero-id">` +
        `<span class="hero-name">${esc(lead.team)}</span>` +
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
        `<span class="rank ${rankTier}">${t.rank}</span>` +
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
  const shown = snapshotShown();
  const takeover = leaderId !== null && teams[0].id !== leaderId;
  leaderId = teams[0].id;
  renderCapsules();
  renderHero(changed, takeover);
  renderRows(changed);
  renderSpotlight();
  if (open !== null) renderTeam(changed);
  rollNumbers(shown);
  document.getElementById("brand-live").classList.toggle("final", weekIsFinal());
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
const isLive = (p) => !slate.sunFinal && LIVE_NFL.has(p.tm);
const clockFor = (p) => LIVE_NFL.get(p.tm);

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

const THU_NFL = new Set(["DET", "CLE"]);   // Thursday night: Browns at Lions
const spotEl = document.getElementById("spot");
let lastSpotKey = null;

function spotlightPick() {
  const all = teams.flatMap((t) => liveStarters(t, new Set()).map((p) => ({ ...p, franchise: t.team })));
  let pool, label, when;
  if (slate.nextWeek) return { top: null, key: "none" };            // new week, nothing final yet
  if (slate.weekFinal) { pool = all; label = "\u2605 MVP of the week"; when = `Week ${WEEK} final`; }
  else if (slate.sunFinal) { pool = all.filter((p) => !THU_NFL.has(p.tm)); label = "Top scorer"; when = "Sunday"; }
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
  const logo = LOGOS[top.tm] ? `<span class="logo"><img src="${LOGOS[top.tm]}" alt=""></span>` : `<span class="logo">${esc(top.tm)}</span>`;
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

const avatar = (p) => {
  const src = p.sid && HEADSHOTS[p.sid];
  if (src) return `<img class="avatar" src="${src}" alt="" decoding="async">`;
  return `<span class="avatar-fb" aria-hidden="true">${esc(initials(p.n))}</span>`;
};

const logoBadge = (tm) => LOGOS[tm] ? `<span class="plogo"><img src="${LOGOS[tm]}" alt=""></span>` : "";

// Touchdowns from the stat line (all kinds), so a simulated score adds the
// chip live. IDP scores use the mockup's own idp_td key.
const tdCount = (st) => (st ? (st.pass_td || 0) + (st.rush_td || 0) + (st.rec_td || 0) + (st.idp_td || 0) : 0);
const tdBadge = (st) => { const n = tdCount(st); return n ? `<span class="ptd">${n > 1 ? n + " " : ""}TD</span>` : ""; };

// top: the team's highest-scoring starter gets a gold ring (MVP echo).
const playerRow = (p, bench, top = false) =>
  `<div class="prow${bench ? " bench" : ""}${p.pts === 0 ? " zero" : ""}${isLive(p) ? " live" : ""}${top ? " top" : ""}">` +
    `<span class="pface">${avatar(p)}${logoBadge(p.tm)}${tdBadge(p.st)}</span>` +
    `<span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span>` +
    `<span class="pname"><b>${esc(p.n)}</b>` +
      `<span class="pmeta">${esc(p.tm)}<span aria-hidden="true">·</span>` +
        (isLive(p) ? `<span class="clock"><span class="dot"></span>${clockFor(p)}</span>` : `<span>Final</span>`) +
      `</span>` +
      `<span class="pstat">${esc(statLine(p.pos, p.st))}</span>` +
    `</span>` +
    `<span class="ppts${p.pts === 0 ? " zero" : ""}${p.flash ? " flash" : ""}"${p.key ? ` data-tween="p:${p.key}" data-delta` : ""}>${fmt(p.pts)}</span>` +
  `</div>`;

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

  document.getElementById("team-rank").textContent = t.rank;
  document.getElementById("team-week").textContent = `Week ${WEEK}`;
  document.getElementById("team-status").innerHTML = statusOf(t);
  document.getElementById("team-name").textContent = t.team;
  document.getElementById("team-rec").textContent = `${t.record} all-play`;
  const ptsEl = document.getElementById("team-pts");
  ptsEl.textContent = fmt(t.live);
  ptsEl.dataset.tween = `pts:${t.id}`;
  ptsEl.dataset.delta = "";
  ptsEl.classList.toggle("flash", changed.has(t.id));
  const stEl = document.getElementById("tab-starters-n");
  stEl.textContent = fmt(sum(starters));
  stEl.dataset.tween = `starters:${t.id}`;
  document.getElementById("tab-bench-n").textContent = `${fmt(sum(bench))} behind`;

  const list = tab === "bench" ? bench : starters;
  const topPts = Math.max(0, ...starters.map((p) => p.pts));
  const isTop = (p) => !bench.includes(p) && topPts > 0 && p.pts === topPts;
  tabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  rosterEl.innerHTML = list.length
    ? rosterHtml(list, tab === "bench", isTop)
    : `<p class="empty">No ${tab} on this roster.</p>`;
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
tabs.forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; renderTeam(); }));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (tdModal.dataset.open === "true") dismissTouchdown();
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

const teamLogo = (tm) => LOGOS[tm]
  ? `<span class="td-logo"><img src="${LOGOS[tm]}" alt=""></span>`
  : `<span class="td-logo">${esc(tm)}</span>`;

const bigShot = (p) => (p.sid && HEADSHOTS[p.sid])
  ? `<img class="td-shot" src="${HEADSHOTS[p.sid]}" alt="">`
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

/* ---------------- simulation (mockup only) ----------------
   Bumps one starter on a team that still has players to play, every few
   seconds, to exercise the live transitions: value flashes, rows sliding
   when ranks swap, clusters re-fusing. Not a feed. */

const simBtn = document.getElementById("sim");
let simTimer = null;

// Only players whose game is on the field can score. Kickers never
// score touchdowns, so they are left out of the TD pool.
const randomStarter = (forTd = false) => {
  const pool = teams.flatMap((t) => t.starters
    .map((p, k) => ({ t, k, p }))
    .filter(({ p }) => isLive(p) && !(forTd && p.pos === "K")));
  return pool[Math.floor(Math.random() * pool.length)];
};

// Six for the score plus a little yardage, announced as a touchdown.
function scoreTouchdown(t, k, changed) {
  const pts = r2(6 + Math.random() * 4);
  bump(t, k, pts);
  bumpStats(t, k, pts, true);
  announceTouchdown({ player: t.starters[k], franchise: t.team, pts, starter: true });
  changed.add(t.id).add(`${t.id}:${k}`);
}

// A bench touchdown: the row in the Bench tab moves, the total does not,
// and the announcement is refused by the rule above.
function scoreBenchTouchdown(t, k, changed) {
  const pts = r2(6 + Math.random() * 4);
  const key = `${t.id}:b${k}`;
  benchBump[key] = r2((benchBump[key] || 0) + pts);
  bumpStats(t, k, pts, true, true);
  announceTouchdown({ player: t.bench[k], franchise: t.team, pts, starter: false });
  changed.add(key);
}

const randomBench = () => {
  const pool = teams.flatMap((t) => t.bench.map((p, k) => ({ t, k, p })).filter(({ p }) => isLive(p) && p.pos !== "K"));
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
};

function stopSim() {
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
  simBtn.setAttribute("aria-pressed", "false");
}

function simTick() {
  if (slate.sunFinal) { stopSim(); return; }   // nothing is on the field
  const changed = new Set();
  const benchPick = Math.random() < 0.12 ? randomBench() : null;
  if (benchPick) {
    scoreBenchTouchdown(benchPick.t, benchPick.k, changed);
  } else if (Math.random() < 0.25) {
    const { t, k } = randomStarter(true);
    scoreTouchdown(t, k, changed);
    // Now and then two land in the same poll, to exercise the queue.
    if (Math.random() < 0.3) { const o = randomStarter(true); scoreTouchdown(o.t, o.k, changed); }
  } else {
    const { t, k } = randomStarter();
    const pts = r2(0.3 + Math.random() * 2.7);
    bump(t, k, pts);
    bumpStats(t, k, pts, false);
    changed.add(t.id).add(`${t.id}:${k}`);
  }
  derive();
  render(changed);
}

document.getElementById("end-day").addEventListener("click", () => {
  slate.sunFinal = true;
  stopSim();
  derive();
  render();
});
// Only the card lifecycle: the MVP card and the winner treatment go;
// scores stay as they are (a full rollover to a new week is not mocked).
document.getElementById("next-week").addEventListener("click", () => {
  slate.sunFinal = true;
  slate.weekFinal = true;
  slate.nextWeek = true;
  stopSim();
  derive();
  render();
});

document.getElementById("end-week").addEventListener("click", () => {
  slate.sunFinal = true;
  slate.weekFinal = true;
  stopSim();
  derive();
  render();
});

document.getElementById("td-chi").addEventListener("click", () => {
  if (slate.sunFinal) return;
  const bears = teams.flatMap((t) => t.starters.map((p, k) => ({ t, k, p })))
    .filter(({ p }) => p.tm === "CHI" && isLive(p) && p.pos !== "K");
  const pick = bears.length ? bears[Math.floor(Math.random() * bears.length)] : randomStarter(true);
  const changed = new Set();
  scoreTouchdown(pick.t, pick.k, changed);
  derive();
  render(changed);
});

document.getElementById("td").addEventListener("click", () => {
  if (slate.sunFinal) return;
  const changed = new Set();
  const { t, k } = randomStarter(true);
  scoreTouchdown(t, k, changed);
  derive();
  render(changed);
});

// Hands #2 exactly enough (plus a little) to pass #1, on one starter.
document.getElementById("flip").addEventListener("click", () => {
  const chaser = teams[1];
  const live = chaser.starters.map((p, k) => (isLive(p) ? k : -1)).filter((k) => k >= 0);
  const k = live.length ? live[Math.floor(Math.random() * live.length)] : Math.floor(Math.random() * chaser.starters.length);
  const pts = r2(gaps[0] + 0.5 + Math.random() * 2.5);
  bump(chaser, k, pts);
  bumpStats(chaser, k, pts, pts >= 6);
  derive();
  render(new Set([chaser.id, `${chaser.id}:${k}`]));
});

simBtn.addEventListener("click", () => {
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
  else { simTick(); simTimer = setInterval(simTick, 2500); }
  simBtn.setAttribute("aria-pressed", String(!!simTimer));
});

/* ---------------- demo bar toggle ----------------
   Hidden by default so a shared page opens clean; the choice is remembered
   per browser. */

const demoBar = document.getElementById("devbar");
const demoBtn = document.getElementById("demo-toggle");
const DEMO_KEY = "mfl-live-demo";

function showDemo(on) {
  demoBar.hidden = !on;
  demoBtn.setAttribute("aria-pressed", String(on));
  try { localStorage.setItem(DEMO_KEY, on ? "1" : "0"); } catch {}
}
demoBtn.addEventListener("click", () => showDemo(demoBar.hidden));
try { if (localStorage.getItem(DEMO_KEY) === "1") showDemo(true); } catch {}

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

derive();
render();
if (desktop.matches) openTeam(teams[0].id);

/* ---------------- loading + first-load cascade ----------------
   The mockup has nothing to fetch: the interstitial holds for a beat (fonts,
   image decode) and then hands off to the cascade. With the feed wired,
   showLoading() would stay up until the first liveScoring poll lands. */

const loader = document.getElementById("loader");
const loaderMsg = document.getElementById("loader-msg");
const MIN_LOAD_MS = 1100;

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
document.fonts.ready.then(() => {
  const wait = Math.max(0, MIN_LOAD_MS - (performance.now() - loadStart));
  setTimeout(() => { cascadeIn(); hideLoading(); }, wait);
});

// Crossing the breakpoint: the panel needs a team when it appears, and
// the overlay must not be left open when it goes back to being one.
desktop.addEventListener("change", (e) => {
  page.dataset.open = "false";
  document.body.classList.remove("team-open");
  if (e.matches) { if (open === null) open = teams[0].id; renderTeam(); }
  else open = null;
  markActive();
});
