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
let LEAGUE = "INDOMEXPAK";   // the league's name, from its export (the board's kicker)
let SEASON = 2026;   // the NFL season (the proxy names it on every answer)
let UPDATED = "4:12 PM";   // when a number on the page last changed: MFL's snapshot (scores, lineups) or Sleeper's lines
let updatedAt = 0;         // the same instant, for the age that ticks in the subhead while games are on
const stampUpdated = () => { UPDATED = fmtTime(new Date()); updatedAt = Date.now(); };
let snapshotSig = "";
let phase = "live";            // "live" | "preseason" (liveScoring not available yet)
let kickoff = null;            // Date of the week's first game (live source)
let games = new Map();         // NFL team -> { kickoff: Date, secs } from nflSchedule (live source)
let situations = new Map();    // NFL team -> its game's live situation from ESPN through the proxy (possession, red zone, ball spot); context only
let situationAt = 0;
let situationFetchedAt = 0;   // when the proxy fetched the situation on the page from ESPN (its `at`)
let dayTeams = { early: new Set(), days: [] };   // the week's game days from the schedule: [{ key, name, teams }] in kickoff order, in NFL (Eastern) dates; `early` is the first day's teams

// Playoffs (Weeks 15-17): the round's field, folded from the season's
// scores by app/playoffs.js. null in the regular season, before the season,
// and whenever the fold cannot complete (an earlier round's scores are
// missing), in which case the board falls back to every franchise as usual.
let post = null;
let seasonScores = null;   // [{ week, franchise: [{ id, score }] }] from the proxy
let seasonRec = null;      // id -> { w, l, t }: all-play through the week before this one (regular season), from seasonScores
let seasonRecWeek = 0, seasonAt = 0;
let byeTeams = [];         // resting this round (Round 1: the No. 1 seed)
let cutAt = -1;            // gaps[cutAt] is the cut line, under the last advancing rank
const ROUNDS = Playoffs.PLAYOFFS.rounds;
const nextRound = () => (post ? ROUNDS[ROUNDS.indexOf(post.round) + 1] || null : null);
// Week 18, Pakistan vs. the World: two sides, each the accumulation of its
// managers' contributions to one super lineup. null in every other week.
let duel = null;          // { sides: [{ id, name, franchises }], sideOf: franchise id -> side }
let duelMembers = [];     // the contributing franchises, with live totals, for their own pages
const EXHIBITION = Playoffs.EXHIBITION;
const STRIP = [...ROUNDS, { week: EXHIBITION.week, name: EXHIBITION.name }];   // the postseason, in order
// The sides' flags, drawn inline (emoji flags are letters on Windows).
// Pakistan: white hoist, green field, crescent and star. The World: the
// Stars and Stripes, thirteen stripes and fifty stars in nine rows.
const star = (cx, cy, r, extra = "") => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.382 : r;
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  return `<polygon points="${pts}" fill="#fff"${extra}/>`;
};
const FLAGS = {
  pk: () => `<svg viewBox="0 0 900 600" aria-hidden="true"><rect width="900" height="600" fill="#01411c"/><rect width="225" height="600" fill="#fff"/>` +
    `<circle cx="562" cy="300" r="150" fill="#fff"/><circle cx="602" cy="270" r="135" fill="#01411c"/>` +
    star(690, 195, 62, ` transform="rotate(-27 690 195)"`) + `</svg>`,
  us: () => {
    const stripes = Array.from({ length: 13 }, (_, i) => `<rect y="${i * 50}" width="1235" height="50" fill="${i % 2 ? "#fff" : "#b22234"}"/>`).join("");
    const stars = Array.from({ length: 9 }, (_, row) => Array.from({ length: row % 2 ? 5 : 6 }, (_, col) =>
      star(row % 2 ? 82 + col * 82 : 41 + col * 82, 35 + row * 35, 18)).join("")).join("");
    return `<svg viewBox="0 0 1235 650" aria-hidden="true">${stripes}<rect width="494" height="350" fill="#3c3b6e"/>${stars}</svg>`;
  },
};
const flagOf = (code) => (FLAGS[code] ? `<span class="duel-flag" aria-hidden="true">${FLAGS[code]()}</span>` : "");
// A round is decided once every game of its week is final. (MFL's own
// "official" mark comes later, after stat corrections; see CLAUDE.md.)
const roundFinal = () => (post !== null || duel !== null) && slate.sunFinal;

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
const LIVE = 3.0;       // close: within three points, the gap pulses (2026-09-09; was 2.5)
const WITHIN = 3.0;     // the headline "within" band

const r2 = (x) => Math.round(x * 100) / 100;
const fmt = (x) => x.toFixed(2);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "&#39;");
const sum = (list) => list.reduce((t, p) => t + p.pts, 0);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

let teams = [];   // sorted, with rank/record/live
let gaps = [];    // gaps[i] is the gap below row i (between rank i+1 and rank i+2)
let gapTiers = [];   // gapTiers[i] is that gap's tier: critical / live / settled, or idle while neither side has begun

// All-play record is pure arithmetic on the sorted list. Everything the
// page shows -- ranks, records, gaps, tiers, headline stats -- comes from
// ROSTERS, never from a constant that could disagree with its own rows.
// In a playoff round only the franchises playing it are ranked; the seed
// chip replaces the week's record, and a tie goes to the higher seed (the
// same order app/playoffs.js folds by, so the cut line is the fold's).
/* Which number is the number (2026-09-10, Shakeel's call for the test
   games). While a day's games are on, a player's points are his Sleeper
   line under the league's rules (app/scoring.js), within a minute of the
   play. Once the day's games are all done AND MFL has closed his game
   (its own per-player clock at 0, which lands minutes after the whistle,
   with the final points in the same snapshot), MFL's official points take
   over and stay. The switch is per player, so a franchise's total mixes a
   Thursday starter on MFL's number with Sunday starters on Sleeper's, and
   a residue at the switch (a tackle MFL credits differently) is the
   stat-correction the league expects. A player with no line yet, or no
   Sleeper join, is on MFL's number throughout. Ranks, gaps, records, the
   hero, the rolls and the spotlight all follow this number; nothing on
   the page says which feed it came from. */
const estOf = (p) => (p.st && Object.keys(p.st).length ? r2(Scoring.scoreLine(p.st)) : null);
let doneTeams = new Set();   // NFL teams whose game day is over (every game on it final); refreshed by derive()
const dayDoneTeams = () => new Set(dayStates().filter((d) => d.final).flatMap((d) => [...d.teams]));
const onOfficial = (p) => doneTeams.has(p.tm) && p.secs === 0;   // MFL has closed his game and the day is done
const ptsOf = (p) => (estOf(p) != null && !onOfficial(p) ? estOf(p) : p.pts);

function derive() {
  doneTeams = phase === "live" && !FIXTURE ? dayDoneTeams() : new Set();
  const withLive = (t) => ({
    ...t,
    live: r2(phase === "live" ? t.starters.reduce((a, p) => a + ptsOf(p), 0) : t.pts),
    official: t.pts,   // MFL's franchise total
    toPlay: slate.sunFinal ? 0 : (FIXTURE ? (YET_TO_PLAY[t.team] ?? 0) : (t.toPlay ?? 0)),
    onNow: t.starters.some(onField),
    seed: post ? post.seedOf.get(t.id) : null,
    season: post ? post.recordOf.get(t.id) : null,   // regular-season all-play record
  });
  // Pakistan vs. the World: the two sides are the teams. Each is the sum of
  // its members (score, starters left, on now) and its super lineup is every
  // starter they contributed, keyed as on the franchise's own page so a
  // score rolls on both.
  if (duel) {
    duelMembers = rosters.filter((t) => duel.sideOf.has(t.id)).map(withLive)
      .map((t) => ({ ...t, side: duel.sideOf.get(t.id) }));
    teams = duel.sides.map((s) => {
      const members = duelMembers.filter((t) => t.side === s).sort((a, b) => b.live - a.live || a.team.localeCompare(b.team));
      return {
        id: s.id, team: s.name, icon: null, isSide: true, members,
        pts: r2(members.reduce((a, t) => a + t.pts, 0)),
        live: r2(members.reduce((a, t) => a + t.live, 0)),
        official: r2(members.reduce((a, t) => a + t.pts, 0)),
        toPlay: members.reduce((a, t) => a + t.toPlay, 0),
        onNow: members.some((t) => t.onNow),
        starters: members.flatMap((t) => t.starters.map((p, k) => ({ ...p, key: playerKey(t, p, k), from: t.team }))),
        bench: [],
        record: `${members.length} managers`,
      };
    }).sort((a, b) => b.live - a.live || a.team.localeCompare(b.team))
      .map((t, i) => ({ ...t, rank: i + 1, through: null }));
    gaps = teams.slice(0, -1).map((t, i) => r2(t.live - teams[i + 1].live));
    gapTiers = gaps.map((g, i) => gapTier(g, teams[i], teams[i + 1]));
    n = teams.length; cutAt = -1; byeTeams = [];
    return;
  }
  duelMembers = [];
  // A tie on the week (every franchise at 0.00 between weeks) falls to the
  // season so far: win pct, then points for, then name, so the board reads
  // best record to worst until a game starts (2026-09-16; MFL's array order
  // before that).
  const sr = (t) => seasonRec?.get(t.id);
  const bySeason = (a, b) => (sr(b)?.pct ?? 0) - (sr(a)?.pct ?? 0) || (sr(b)?.pf ?? 0) - (sr(a)?.pf ?? 0) || a.team.localeCompare(b.team);
  const listed = (post ? rosters.filter((t) => post.alive.includes(t.id)) : rosters).map(withLive);
  const begun = listed.some(started);
  teams = listed
    // Pre-season nobody has a score, so the list is alphabetical, not ranked.
    .sort((a, b) => phase === "preseason" ? a.team.localeCompare(b.team)
      : post ? (b.live - a.live || a.seed - b.seed)
      : b.live - a.live || bySeason(a, b))
    .map((t, i, arr) => {
      // The week's all-play from the rank, on top of the season so far
      // (seasonRec, the weeks before this one): unofficial, live, and it
      // moves as the row does. Week 1, the fixture and a failed fetch show
      // the week alone. Before the week's first franchise begins the rank
      // is only the season's order, so the chip is the season alone.
      const w = begun ? arr.length - 1 - i : 0, l = begun ? i : 0, so = seasonRec?.get(t.id) || { w: 0, l: 0, t: 0 };
      return {
        ...t, rank: i + 1,
        record: post ? `#${t.seed} seed` : `${so.w + w}-${so.l + l}${so.t ? `-${so.t}` : ""}`,
        week: `${w}-${l}`,
        through: post ? i < arr.length - post.round.drop : null,
      };
    });
  gaps = teams.slice(0, -1).map((t, i) => r2(t.live - teams[i + 1].live));
    gapTiers = gaps.map((g, i) => gapTier(g, teams[i], teams[i + 1]));
  n = teams.length;
  cutAt = post ? n - post.round.drop - 1 : -1;
  byeTeams = post ? rosters.filter((t) => post.bye.includes(t.id)).map(withLive).map((t) => ({ ...t, bye: true, record: `#${t.seed} seed` })) : [];
}

let n = 0;
const byId = (id) => teams.find((t) => t.id === id) || byeTeams.find((t) => t.id === id) || duelMembers.find((t) => t.id === id);
const tier = (g) => (g < CRITICAL ? "critical" : g < LIVE ? "live" : "settled");
// A gap between two franchises that have not begun (nothing scored, nobody
// on the field, no starter kicked off) is idle, not a coin flip: early in
// a week most of the board is 0.00 against 0.00, and a red "Coin flip"
// under every one of them said nothing (2026-09-09). An idle gap keeps its
// number in a plain divider and counts for no capsule; the rank circle
// and fusing ignore it.
const started = (t) => t.live !== 0 || t.onNow || (t.starters.length > 0 && t.toPlay < t.starters.length);
const gapTier = (g, a, b) => (!started(a) && !started(b) ? "idle" : tier(g));
const hot = (tr) => tr === "critical" || tr === "live";
// A franchise is done when it has begun and has nobody left: nothing on the
// field, nothing yet to kick off. A close gap between two done franchises
// keeps its colour (it is still a close gap, and still counts for the
// capsules) but stops breathing: the pulse says "this could move", and
// nothing on either side can (2026-09-14). A stat correction is not live.
const done = (t) => started(t) && !t.onNow && t.toPlay === 0;
const TIER_LABEL = { critical: "Coin flip", live: "Close", settled: "Settled", idle: "Not started" };

// Who is on the field for a franchise: its live starters by last name, in
// lineup order, two of them and a count for the rest ("Mahomes, Kelce +3").
// Replaced "N to play · on now" on 2026-09-09: the count said nothing about
// which of the starters were playing.
const lastName = (n) => {
  const w = String(n).trim().split(/\s+/).filter((x) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(x));
  return w[w.length - 1] || String(n);
};
const onNowNames = (t) => {
  const live = t.starters.filter(onField).sort(byLineup);
  return live.slice(0, 2).map((p) => esc(lastName(p.n))).join(", ") + (live.length > 2 ? ` +${live.length - 2}` : "");
};

const statusOf = (t) => phase === "preseason"
  ? `${t.bench.length} on roster`
  : t.bye
    ? `Bye &middot; plays ${nextRound()?.ref || "next week"}`
  // No starters at all: MFL reports playersYetToPlay as 0 for a franchise
  // that never set a lineup, which is not "all played".
  : t.starters.length === 0
    ? (t.side ? "none in the lineup" : "no lineup set")
  // Who is on the field comes before the count: MFL's playersYetToPlay
  // counts starters whose game has not kicked off, so it is already 0
  // while a franchise's last starters are playing (2026-09-14, the Week 1
  // Monday night: every franchise read "all played" with DEN at KCC on).
  : t.onNow
    ? `${onNowNames(t)}${rzCount(t) ? ` &middot; <span class="rzn" title="${rzCount(t)} in the red zone">${rzCount(t)} RZ</span>` : " &middot; on now"}`
  : t.toPlay === 0
    ? "all played"
    : `${t.toPlay} to play`;

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
// A franchise's mark on the board (2026-09-24, as mfl-manager's standings):
// its MFL icon, or its initials on its own hue, the same hue the manager
// gives it (both key it off the franchise id). A failed icon falls back to
// the initials.
const markHue = (id) => ((parseInt(String(id).replace(/\D/g, ""), 10) || 0) * 137) % 360;
const franchiseMark = (t) => {
  const ini = esc(initials(t.team.trim() || "?"));
  return `<span class="fav" style="--fav:oklch(0.8 0.12 ${markHue(t.id)})" aria-hidden="true">` +
    (t.icon ? `<img src="${t.icon}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(this.dataset.fb))" data-fb="${ini}">` : ini) +
  `</span>`;
};

/* ---------------- chrome ---------------- */

function renderChrome() {
  // Playoffs: the round's name is the title, "Playoffs · Week 15" above it.
  const kicker = document.getElementById("kicker");
  // The regular season: the league, the season and the week over the title (the redesign's kicker).
  kicker.hidden = phase === "preseason" && !post && !duel;
  kicker.classList.toggle("league", !post && !duel);
  if (!post && !duel) kicker.textContent = `${LEAGUE} \u00b7 ${SEASON} \u00b7 Week ${WEEK}`;
  if (post || duel) {
    kicker.innerHTML = (duel ? `Week ${WEEK} &middot; Pakistan vs. the World` : `Playoffs &middot; Week ${WEEK}`) +
      // Looking back at a finished round (?w=15): a way back to the live one.
      (QUERY.has("w") ? ` &middot; <a href="${location.pathname}">Back to now</a>` : "");
  }
  const title = document.getElementById("week-title");
  title.textContent = duel ? EXHIBITION.name : post ? post.round.name : `Week ${WEEK}`;
  // The Fantasy Bowl: the title's drift turns gold and a trophy sits beside it.
  const bowlTitle = post !== null && Boolean(post.round.bowl);
  title.classList.toggle("bowl", bowlTitle);
  document.getElementById("week-trophy").hidden = !bowlTitle;
  document.getElementById("bowl-bg").classList.toggle("on", bowlTitle);   // the gold clouds behind the board
  document.getElementById("sky-bg").classList.toggle("on", !bowlTitle);   // the season's aurora otherwise: the gold replaces it, never sits on it
  document.getElementById("app").classList.toggle("bowl", bowlTitle);     // and the text above and below the title steps up a shade
  const kick = document.getElementById("kick");
  kick.hidden = phase !== "preseason" || !kickoff;
  document.getElementById("countdown").textContent = countdownText();
  document.getElementById("hero-wrap").hidden = phase === "preseason";
  const sub = document.getElementById("subhead");
  sub.hidden = phase === "preseason";
  const note = statsNote();
  sub.innerHTML = (duel ? `One super lineup a side, $${EXHIBITION.perHead} a head &middot; ` : post ? `${roundBlurb()} &middot; ` : "") + `Updated <span id="age">${esc(ageText())}</span>` +
    (note ? ` &middot; <span class="stale">${note}</span>` : "");
  document.body.classList.toggle("stats-stale", note !== "");
  syncAge();
  renderRounds();
}

// While games are on the subhead counts up from the last change (2026-09-15):
// "Updated 12s ago" ticking says the page is awake and how long the board
// has stood, where a clock time read the same at twelve seconds and at four
// minutes. Off the field it is the time again ("3h 12m ago" says nothing).
// One timer, one element; it stops when there is nothing to count.
let ageTimer = null;
const ageTicks = () => phase === "live" && !FIXTURE && updatedAt > 0 && gamesOn();
const ageText = () => {
  if (!ageTicks()) return UPDATED;
  const s = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s ago` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
};
function syncAge() {
  const el = document.getElementById("age");
  if (el) el.textContent = ageText();
  const teamAge = document.getElementById("team-age");
  if (teamAge) teamAge.textContent = phase === "preseason" ? "" : `Updated ${ageText()}`;
  const on = ageTicks();
  if (on && !ageTimer) ageTimer = setInterval(syncAge, 1000);
  if (!on && ageTimer) { clearInterval(ageTimer); ageTimer = null; }
}

// "Seeds 2–6 play, top 3 advance" / "4 play, top 2 advance" / the Bowl.
function roundBlurb() {
  if (post.round.bowl) return "Higher score takes the title";
  const seeds = teams.map((t) => t.seed);
  const who = byeTeams.length && seeds.length ? `Seeds ${Math.min(...seeds)}&ndash;${Math.max(...seeds)} play` : `${n} play`;
  return `${who}, top ${n - post.round.drop} advance`;
}

// The three rounds in a strip: the one on show is marked, finished ones
// link to their board (?w=), later ones wait.
function renderRounds() {
  const el = document.getElementById("rounds");
  el.hidden = !post && !duel;
  if (el.hidden) return;
  el.innerHTML = STRIP.map((r) => {
    const state = r.week === WEEK ? "now" : r.week < WEEK ? "past" : "next";
    const inner = `<span class="rname">${esc(r.name)}</span><span class="rweek">Week ${r.week}</span>`;
    return state === "past"
      ? `<a class="round past" href="?w=${r.week}">${inner}</a>`
      : `<span class="round ${state}"${state === "now" ? ' aria-current="page"' : ""}>${inner}</span>`;
  }).join(`<span class="rarrow" aria-hidden="true">&rsaquo;</span>`);
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
  const within = new Set(gaps.flatMap((g, i) => (gapTiers[i] !== "idle" && g < WITHIN ? [i, i + 1] : []))).size;
  const startersLeft = teams.reduce((s, t) => s + t.toPlay, 0);
  const left = `<span class="capsule"><b class="accent">${startersLeft}</b>starters left</span>`;
  // Pakistan vs. the World: the margin, in the gap's tier.
  if (duel) {
    caps.innerHTML =
      `<span class="capsule"><b class="${gapTiers[0]}">${fmt(gaps[0])}</b>margin</span>` + left +
      `<span class="capsule"><b class="gold">$${EXHIBITION.perHead}</b>a head</span>`;
    return;
  }
  // Playoffs: what the round is worth. The Bowl is the only round that pays.
  if (post && post.round.bowl) {
    const { champion, runnerUp } = Playoffs.PLAYOFFS.purse;
    caps.innerHTML =
      `<span class="capsule"><b class="gold">$${champion}</b>to the champion</span>` +
      `<span class="capsule"><b class="gold">$${runnerUp}</b>runner-up</span>` + left;
    return;
  }
  if (post) {
    const cut = gaps[cutAt];
    caps.innerHTML =
      `<span class="capsule"><b class="accent">${n - post.round.drop}</b>of ${n} advance</span>` +
      (cut === undefined ? "" : `<span class="capsule"><b class="${gapTiers[cutAt]}">${fmt(cut)}</b>cut line</span>`) + left;
    return;
  }
  // Regular season (2026-09-25, the canvas's pick): the close gaps' franchises, the coin flips, who is left.
  const flips = gapTiers.filter((tr) => tr === "critical").length;
  caps.innerHTML =
    `<span class="capsule"><b class="live">${within}</b>within ${WITHIN.toFixed(1)}</span>` +
    `<span class="capsule"><b>${flips}</b>coin flip${flips === 1 ? "" : "s"}</span>` + left;
}

// A franchise name is one column of the hero and the score is the other. A
// long single word ("WhiskeyDitka" at 30px) is wider than the column and,
// since the column may shrink below it, ran under the score. Step the size
// down until the longest word fits (the box is measured, so an icon counts
// too); if it still does not at the floor, give the name the full width and
// drop the score under it (.hero-mid.stack), and only past that let the word
// break. Only measurable while the element is displayed, so openTeam() calls
// it after showing the page. Multi-word names wrap and are left at full size.
const NAME_MIN_PX = 28;   // the redesign's floor (2026-09-24)
function fitName(el) {
  if (!el) return;
  const mid = el.closest(".hero-mid");
  el.style.fontSize = "";
  el.classList.remove("wrap-any");
  mid?.classList.remove("stack");
  if (!el.clientWidth) return;   // hidden (the page is closed, or the pane hides its hero)
  const fits = () => el.scrollWidth <= el.clientWidth + 1;
  const shrink = () => {
    el.style.fontSize = "";
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (!fits() && size > NAME_MIN_PX) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
    return fits();
  };
  if (shrink()) return;
  if (mid) {
    mid.classList.add("stack");
    if (shrink()) return;
  }
  el.classList.add("wrap-any");
}
function fitNames() {
  fitName(heroBody.querySelector(".hero-name"));
  fitName(document.getElementById("team-name"));
}
addEventListener("resize", fitNames);

function renderHero(changed, takeover) {
  if (phase === "preseason") return;   // hidden by renderChrome; the countdown pill stands in
  const lead = teams[0], chaser = teams[1], lt = gapTiers[0];
  // Playoffs: the round's leader; the Bowl's leader is the champion once
  // the games are done, and only the Bowl gets the gold (the rounds before
  // it pay nothing).
  const label = post
    ? (roundFinal() ? (post.round.bowl ? "Fantasy Bowl champion" : `${post.round.name} &middot; advances`)
      : takeover ? "New leader" : `Leading ${post.round.ref}`)
    : duel ? (roundFinal() ? "Wins the Pro Bowl" : takeover ? "New leader" : "Leading the Pro Bowl")
    : weekIsFinal() ? `Week ${WEEK} winner` : takeover ? "New leader" : `Leading Week ${WEEK}`;
  const gold = post ? Boolean(post.round.bowl) && roundFinal() : weekIsFinal();   // a real boolean: toggle(x, undefined) flips
  // Head to head (the Fantasy Bowl, and Pakistan vs. the World): both
  // face to face, the leader bright. The Pro Bowl's sides sit under their
  // flags, the Bowl's finalists under their franchise icons (an initial
  // when none is set), higher seed on the left.
  const bowl = post !== null && Boolean(post.round.bowl);
  if (duel || bowl) {
    const pair = duel ? duel.sides.map((s) => byId(s.id)) : [...teams].sort((a, b) => a.seed - b.seed);
    const crest = (t, i) => duel ? flagOf(duel.sides[i].flag)
      : `<span class="duel-flag duel-icon" aria-hidden="true">${t.icon ? franchiseIcon(t, "") : esc(t.team.trim()[0] || "?")}</span>`;
    const sub = (t) => (duel ? `${t.members.length} managers` : `#${t.seed} seed &middot; ${t.season}`) + (t.toPlay ? ` &middot; ${t.toPlay} to play` : "");
    heroBody.innerHTML =
      `<div class="hero-top">` +
        `<span class="micro hero-label"><span class="badge">01</span>${label}</span>` +
        `<span class="hero-status">${statusOf(lead)}</span>` +
      `</div>` +
      `<div class="duel">` +
        pair.map((t, i) =>
          `<div class="duel-side${t.id === lead.id ? " lead" : ""}">` +
            crest(t, i) +
            `<span class="duel-name">${esc(t.team)}</span>` +
            `<span class="duel-pts${fl(changed, t.id)}" data-tween="pts:${t.id}" data-delta>${fmt(t.live)}</span>` +
            `<span class="duel-sub">${sub(t)}</span>` +
          `</div>`).join(`<span class="duel-v" aria-hidden="true">v</span>`) +
      `</div>` +
      `<div class="hero-strip">` +
        (hot(lt) ? `<span class="tier ${lt}">${TIER_LABEL[lt]}</span>` : "") +
        `<span class="leads"><b>${esc(lead.team)}</b> ${roundFinal() ? "beat" : "leads"} <b>${esc(chaser.team)}</b> by</span>` +
        `<span class="hero-gap${changed.has(lead.id) || changed.has(chaser.id) ? " flash" : ""}" data-tween="gap:${lead.id}:${chaser.id}">${fmt(gaps[0])}</span>` +
      `</div>`;
  } else heroBody.innerHTML =
    `<div class="hero-top">` +
      `<span class="micro hero-label"><span class="badge">01</span>${label}</span>` +
      `<span class="hero-status">${statusOf(lead)}</span>` +
    `</div>` +
    `<div class="hero-mid">` +
      `<div class="hero-id">` +
        `<span class="hero-line"><span class="hero-mark">${franchiseMark(lead)}</span><span class="hero-name">${esc(lead.team)}</span></span>` +
        `<span class="hero-rec">${post ? `#${lead.seed} seed &middot; ${lead.season}` : `${lead.record} all-play`}</span>` +
      `</div>` +
      `<span class="hero-pts${fl(changed, lead.id)}" data-tween="pts:${lead.id}" data-delta>${fmt(lead.live)}</span>` +
    `</div>` +
    (lead.onNow ? playLine(lead) : "") +
    `<div class="hero-strip">` +
      (hot(lt) ? `<span class="tier ${lt}">${TIER_LABEL[lt]}</span>` : "") +
      `<span class="leads">${roundFinal() ? "Beat" : "Leads"} <b>${esc(chaser.team)}</b> by</span>` +
      `<span class="hero-gap${changed.has(lead.id) || changed.has(chaser.id) ? " flash" : ""}" data-tween="gap:${lead.id}:${chaser.id}">${fmt(gaps[0])}</span>` +
    `</div>`;
  hero.classList.toggle("winner", duel ? roundFinal() : gold);
  hero.classList.toggle("bowl", bowl);   // the leading score's iridescent sweep
  document.getElementById("hero-wrap").classList.toggle("winner", duel ? roundFinal() : gold);
  hero.setAttribute("aria-label",
    `${lead.team} leads ${duel ? "the Pro Bowl" : post ? post.round.ref : `Week ${WEEK}`} with ${fmt(lead.live)} points, ${fmt(gaps[0])} ahead of ${chaser.team}. Open lineup.`);
  fitName(heroBody.querySelector(".hero-name"));

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
        franchiseMark(t) +
        `<span class="who"><span class="name">${esc(t.team)}</span></span>` +
        `<span class="pts">&mdash;</span>` +
      `</button>`).join("");
    markActive();
    return;
  }

  // Pakistan vs. the World: each side, then the managers who filled its
  // lineup and what each contributed, fused under it. The hero already
  // carries the margin, so no divider between the sides.
  if (duel) {
    const dot = (t) => (t.onNow ? `<span class="dot"></span>` : "");
    // A side's mark is its flag, where a franchise shows its icon.
    const sideMark = (t) => {
      const code = duel.sides.find((sd) => sd.id === t.id)?.flag;
      return FLAGS[code] ? `<span class="fav flag" aria-hidden="true">${FLAGS[code]()}</span>` : franchiseMark(t);
    };
    rowsEl.innerHTML = teams.map((t) =>
      `<button class="row side fuse-bottom" type="button" data-id="${t.id}"` +
      ` aria-label="${esc(t.team)}, ${fmt(t.live)} points, ${t.members.length} managers. Open lineup.">` +
        `<span class="rank">${String(t.rank).padStart(2, "0")}</span>` +
        sideMark(t) +
        `<span class="who">` +
          `<span class="name">${esc(t.team)}</span>` +
          `<span class="sub"><span class="rec">${t.record}</span><span class="rec">${t.starters.length} players</span>` +
            `<span class="status${t.onNow ? " on" : ""}">${dot(t)}${statusOf(t)}</span></span>` +
          (t.onNow ? playLine(t) : "") +
        `</span>` +
        `<span class="pts${fl(changed, t.id)}" data-tween="pts:${t.id}" data-delta>${fmt(t.live)}</span>` +
      `</button>` +
      t.members.map((m, j, arr) =>
        `<button class="row contrib fuse-top${j < arr.length - 1 ? " fuse-bottom" : ""}" type="button" data-id="${m.id}"` +
        ` aria-label="${esc(m.team)}, ${m.starters.length} in the ${esc(t.team)} lineup, ${fmt(m.live)} points. Open lineup.">` +
          franchiseMark(m) +
          `<span class="who">` +
            `<span class="name">${esc(m.team)}</span>` +
            `<span class="sub"><span class="rec">${m.starters.length} ${m.starters.length === 1 ? "player" : "players"}</span>` +
              `<span class="status${m.onNow ? " on" : ""}">${dot(m)}${statusOf(m)}</span></span>` +
          `</span>` +
          `<span class="pts${fl(changed, m.id)}" data-tween="pts:${m.id}" data-delta>${fmt(m.live)}</span>` +
        `</button>`).join("")
    ).join(`<div class="board-sep board-v" role="presentation"><span>v</span></div>`);
    markActive();
    return;
  }

  // The leader lives in the hero, which already shows its lead over #2, so
  // the list starts at rank 2. The first listed row never fuses upward:
  // there is no card above it to fuse with, even when that gap is hot (the
  // hero strip carries that tier instead).
  // The Fantasy Bowl lists both finalists (the hero already faces them
  // off), with no divider between: the hero strip carries the margin.
  const bowl = post !== null && Boolean(post.round.bowl);
  rowsEl.innerHTML = teams.map((t, i) => {
    if (i === 0 && !bowl) return "";
    const below = gaps[i];
    const fuseTop = i > 1 && hot(gapTiers[i - 1]), fuseBottom = hot(gapTiers[i]);

    // Rank circle takes the hotter of the two gaps the row touches.
    const tiers = [gapTiers[i - 1], gapTiers[i]].filter(Boolean);
    const rankTier = tiers.includes("critical") ? "critical" : tiers.includes("live") ? "live" : "";

    // Playoffs: rows under the cut line are "out" (still playing, but not
    // through as things stand), and each row says which side it is on.
    const out = post !== null && !t.through;
    const champ = bowl && roundFinal() && !out;   // the Fantasy Bowl champion wears a gold ring once the games are done
    const rowCls = ["row",
      fuseTop ? "fuse-top" : "", fuseBottom ? "fuse-bottom" : "",
      fuseTop || fuseBottom ? "fused" : "", out ? "out" : "", champ ? "champ" : ""].filter(Boolean).join(" ");
    const fate = !post ? ""
      : bowl ? (roundFinal() ? (out ? `<span class="fate out">Runner-up</span>` : `<span class="fate in">Champion</span>`) : "")
      : out ? `<span class="fate out">${roundFinal() ? "Eliminated" : "Out"}</span>`
      : `<span class="fate in">${roundFinal() ? "Advances" : "In"}</span>`;

    const row =
      `<button class="${rowCls}" type="button" data-id="${t.id}"` +
      ` aria-label="Rank ${t.rank}, ${esc(t.team)}, ${t.record}, ${fmt(t.live)} points. Open lineup.">` +
        `<span class="rank ${rankTier}">${String(t.rank).padStart(2, "0")}</span>` +
        franchiseMark(t) +
        `<span class="who">` +
          `<span class="name">${esc(t.team)}</span>` +
          `<span class="sub">` +
            `<span class="rec">${t.record}</span>` + fate +
            `<span class="status${t.onNow ? " on" : ""}">` +
              (t.onNow ? `<span class="dot"></span>` : "") + statusOf(t) +
            `</span>` +
          `</span>` +
          (t.onNow ? playLine(t) : "") +
        `</span>` +
        `<span class="pts${fl(changed, t.id)}" data-tween="pts:${t.id}" data-delta>${fmt(t.live)}</span>` +
      `</button>`;

    if (below === undefined || bowl) return row;
    const gt = gapTiers[i];
    const cut = i === cutAt;
    // A coin-flip pill flashes when either score beside it moved.
    const pillFlash = gt === "critical" && (changed.has(t.id) || changed.has(teams[i + 1].id));
    const still = hot(gt) && done(t) && done(teams[i + 1]);   // a close gap nothing can move: no pulse
    return row +
      `<div class="gap ${gt}${cut ? " cut" : ""}${still ? " still" : ""}" aria-label="${cut ? "Cut line, " : ""}Gap ${fmt(below)}${gt === "critical" ? ", coin flip" : gt === "idle" ? ", neither has played" : ""}">` +
        `<span class="line"></span>` +
        `<span class="pill${pillFlash ? " flash" : ""}"><span data-tween="gap:${t.id}:${teams[i + 1].id}">${fmt(below)}</span>` +
          (cut ? `<span class="flip">Cut line</span>` : "") +   // the number alone; a close gap pulses instead of saying so
        `</span>` +
        `<span class="line"></span>` +
      `</div>`;
  }).join("") +
  // Round 1: whoever is resting sits under the list, unranked.
  (byeTeams.length ? `<div class="board-sep" role="presentation"><span>Bye week</span></div>` : "") +
  byeTeams.map((t) =>
    `<button class="row bye" type="button" data-id="${t.id}"` +
    ` aria-label="${esc(t.team)}, ${t.record}, bye this week. Open roster.">` +
      `<span class="rank">Bye</span>` +
      franchiseMark(t) +
      `<span class="who">` +
        `<span class="name">${esc(t.team)}</span>` +
        `<span class="sub"><span class="rec">${t.record}</span><span class="status">${statusOf(t)}</span></span>` +
      `</span>` +
      `<span class="pts">&mdash;</span>` +
    `</button>`).join("");

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
    el.style.setProperty("--dy", `${dy}px`);   // the row's transform reads --dy, so a lifted row stays lifted in flight
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = "transform .55s cubic-bezier(.2, .8, .2, 1)";
      el.style.removeProperty("--dy");
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

// key -> { from, to, t0, nodes: [Text], handle }: one loop per key drives
// every surface showing it (a franchise's score in the hero, its row and
// the team page are all "pts:<id>").
const tweens = new Map();
const TWEEN_MS = 700;

// Only surfaces that are actually showing; a closed team page holds
// stale numbers for whoever was opened last. Each element once: the team
// page sits inside #app, so its numbers matched both selectors, and the
// second pass over one of them, on a render while its roll was in flight,
// read the half-rolled text as a new value against the roll's target and
// popped a chip for the difference: red on a gain, mint on a loss, beside
// the true chip a beat later (2026-09-14, Walker's row on the Week 1
// Monday night).
const liveNumberEls = () => [...new Set([
  ...document.querySelectorAll("#app [data-tween]"),
  ...(open !== null ? page.querySelectorAll("[data-tween]") : []),
  ...(pcKey !== null ? pcSheet.querySelectorAll("[data-tween]") : []),
])];

// What each key shows right now, and the value it last settled on. Mid-roll
// the two differ: the roll's target is the settled value. So a re-render
// while a roll is in flight (the stat lines landing beside the poll) does
// not read the half-rolled number as a change and roll it again, with a
// chip for the remainder, up to the same total (2026-09-09).
function snapshotShown() {
  const shown = new Map();
  for (const el of liveNumberEls()) {
    const key = el.dataset.tween, now = parseFloat(el.textContent);
    const run = tweens.get(key);
    shown.set(key, { now, settled: run ? run.to : now });
  }
  return shown;
}

const easeOut = (p) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
const tweenValue = (t, now) => t.from + (t.to - t.from) * easeOut((now - t.t0) / TWEEN_MS);

// Bind a text node to the key's roll, starting one if there is none.
function joinTween(key, text, from, to, t0) {
  let t = tweens.get(key);
  if (!t) { t = { from, to, t0, nodes: [], handle: 0 }; tweens.set(key, t); }
  t.nodes.push(text);
  text.nodeValue = fmt(tweenValue(t, performance.now()));
}

function rollNumbers(shown) {
  const prior = new Map(tweens);
  for (const t of prior.values()) cancelAnimationFrame(t.handle);
  tweens.clear();
  for (const el of liveNumberEls()) {
    const key = el.dataset.tween;
    const s = shown.get(key), to = parseFloat(el.textContent);
    if (!s || !Number.isFinite(s.now) || !Number.isFinite(to)) continue;
    const text = el.firstChild;   // the number's text node; a chip sits after it
    if (Math.abs(to - s.settled) < 0.005) {
      // Unchanged. A roll still in flight carries on in the rebuilt element
      // from where it was, on its own curve, and pops no chip.
      const run = prior.get(key);
      if (run && Math.abs(to - s.now) >= 0.005) joinTween(key, text, run.from, to, run.t0);
      continue;
    }
    if ("delta" in el.dataset) {
      const d = r2(to - s.settled);
      const chip = document.createElement("span");
      chip.className = "delta" + (d < 0 ? " neg" : "");
      chip.textContent = (d > 0 ? "+" : "−") + fmt(Math.abs(d));
      chip.addEventListener("animationend", () => chip.remove(), { once: true });
      el.appendChild(chip);
    }
    if (reducedMotion.matches) continue;
    joinTween(key, text, s.now, to, performance.now());
  }
  for (const [key, t] of tweens) {
    const frame = (now) => {
      if (tweens.get(key) !== t) return;   // superseded by a later render
      const v = fmt(tweenValue(t, now));
      for (const n of t.nodes) n.nodeValue = v;
      if (now - t.t0 < TWEEN_MS) t.handle = requestAnimationFrame(frame);
      else tweens.delete(key);
    };
    t.handle = requestAnimationFrame(frame);
  }
}

let renderedAt = 0;
function render(changed = new Set()) {
  renderedAt = performance.now();
  renderChrome();
  const shown = snapshotShown();
  // Pre-season rows are alphabetical, so nobody "leads": the first live
  // board is a debut, not a lead change, and fires no takeover.
  // Nor does a board nobody has begun: its order is the season's, not a lead.
  const takeover = leaderId !== null && teams[0].id !== leaderId;
  leaderId = phase === "live" && started(teams[0]) ? teams[0].id : null;
  if (phase === "live") { feedPlays(); fetchBoardStatus(); }
  renderCapsules();
  renderHero(changed, takeover);
  renderRows(changed);
  renderSpotlight();
  if (open !== null) renderTeam(changed);
  rollNumbers(shown);
}

/* ---------------- stat lines ----------------
   Sleeper's lines, live through the proxy's `stats` type (the fixture
   embeds Week 12's per player as `st`). Context beside MFL's number;
   the estimate they feed is `ptsOf`, never a recomputed score
   (CLAUDE.md, "Which number is the number"). */

// Where the week stands: every game of the day final, and the week final
// (MFL marking it official is not read; the schedule's last whistle is).
const slate = { sunFinal: false, weekFinal: false };
// The week's "final" treatment lasts until the next week begins. A playoff
// round counts as final once its games are (roundFinal).
const weekIsFinal = () => slate.weekFinal || roundFinal();

const LIVE_NFL = new Map([
  ["JAC", "Q3 8:12"], ["KCC", "Q3 8:12"],   // Jaguars at Chiefs
  ["CHI", "Q4 2:31"], ["MIN", "Q4 2:31"],   // Bears at Vikings
]);
// Live source: a player's game clock comes from liveScoring (per player) or,
// failing that, the schedule (per NFL team). 3600 = not started, 0 = final.
// The situation's clock as seconds remaining (2026-09-09): a fresh one
// beats liveScoring's per-player clock, which refreshes with the points on
// MFL's cycle and, at the end of a game, sat on "Q4 0:26" for ten minutes
// after the final whistle until MFL marked the game final. In play the
// number is never 0 (a tied 4th quarter at 0:00 is heading to overtime),
// and overtime counts down its own clock.
const sitSecs = (tm) => {
  const sit = sitOf(tm);
  if (!sit) return null;
  if (sit.state === "post") return 0;
  if (sit.state === "pre") return 3600;
  if (sit.state !== "in" || !sit.period) return null;
  const [m, sec] = String(sit.clock || "0:00").split(":").map(Number);
  const left = (Number.isFinite(m) ? m * 60 : 0) + (Number.isFinite(sec) ? sec : 0);
  return Math.max(1, sit.period <= 4 ? (4 - sit.period) * 900 + left : left);
};
// Lay the situations over the schedule's game clocks, so the day's and the
// week's "final" (slate, dayStates) follow ESPN's whistle too. After the
// schedule is rebuilt and whenever a situation lands.
const overlaySituations = () => { for (const [tm, g] of games) { const secs = sitSecs(tm); if (secs != null) g.secs = secs; } };
const secsOf = (p) => (sitSecs(p.tm) ?? p.secs ?? games.get(p.tm)?.secs ?? null);
const clockText = (secs) => {
  const q = 4 - Math.floor((secs - 1) / 900), left = ((secs - 1) % 900) + 1;
  return `Q${q} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
};
const isLive = (p) => !slate.sunFinal && (FIXTURE
  ? LIVE_NFL.has(p.tm)
  : (secsOf(p) != null && secsOf(p) > 0 && secsOf(p) < 3600));
// A starter Sleeper has ruled doubtful, out or inactive is not "on now"
// for his franchise, though his game is (2026-09-17): the status names
// who is playing, and he is not. His row and his clock stay as they were;
// the statuses come from fetchBoardStatus while games are on.
const SIDELINED = new Set(["Doubtful", "Out", "IR", "PUP", "Sus", "NA"]);
const sidelined = (p) => Boolean(p.sid) && SIDELINED.has(rosterStatus.get(String(p.sid))?.inj);
const onField = (p) => isLive(p) && !sidelined(p);
const clockFor = (p) => (FIXTURE ? LIVE_NFL.get(p.tm) : clockText(secsOf(p)));
// Red zone: an offensive player's own team, with the ball, inside the
// other side's 20. Live players only, not IDP (a defender facing a
// red-zone drive is not the same signal). The game situation (ESPN,
// through the proxy; see fetchSituation) decides when there is a fresh
// one: it carries possession and a red-zone flag computed on the right
// side of the field. Without one, the schedule's per-team flags
// (inRedZone, hasPossession), which on the Week 1 opener (2026-09-09)
// came back as inconsistent snapshots: both teams in possession, a team
// in the red zone at halftime. Then only when the other side does not
// clearly have the ball.
const SITUATION_STALE_MS = 2 * 60e3;
// A situation counts only for the game the schedule has for the team
// (2026-09-16): ESPN's scoreboard is always the current week, so a page on
// a past week (?w=1 once ESPN rolled to Week 2) had the new week's "pre"
// games laid over every finished game's clock. The week then read as
// started and not final, doneTeams came out empty, every starter fell
// back to Sleeper's estimate, and gamesOn() polled every 15s for it. The
// kickoffs match to the second; a situation with no kickoff (a staged
// one) or a team with no schedule entry is taken as it comes.
const SAME_GAME_MS = 6 * 3600e3;
const sameGame = (tm, sit) => {
  const g = games.get(tm);
  return !g || sit.kickoff == null || Math.abs(g.kickoff - sit.kickoff) < SAME_GAME_MS;
};
const sitOf = (tm) => {
  if (Date.now() - situationAt >= SITUATION_STALE_MS) return null;
  const sit = situations.get(tm);
  return sit && sameGame(tm, sit) ? sit : null;
};
const inRedZone = (p) => {
  if (!isLive(p) || !POS_CLASS[p.pos]) return false;
  const sit = sitOf(p.tm);
  if (sit) return sit.state === "in" && sit.poss === p.tm && sit.rz;
  const m = games.get(p.tm)?.match;
  if (!m) return false;
  const mine = m.away.id === p.tm ? m.away : m.home, other = mine === m.away ? m.home : m.away;
  return mine.rz && !(other.poss && !mine.poss);
};
// How many of a franchise's starters are in a red-zone situation right now.
const rzCount = (t) => t.starters.filter((p) => inRedZone(p) && !sidelined(p)).length;

// What a row shows when the player is not on the field.
const gameLabel = (p) => {
  if (FIXTURE) return "Final";
  const secs = secsOf(p);
  if (secs == null) return "\u2014";
  if (secs <= 0) return "Final";
  const g = games.get(p.tm);
  return g ? `${g.kickoff.toLocaleDateString([], { weekday: "short" })} ${fmtTime(g.kickoff)}` : "";   // no schedule entry: nothing to say (a "Not started" crowded the phone row)
};

const statsFor = (t, k, bench = false) => (bench ? t.bench : t.starters)[k].st || {};

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
    st.idp_blk_kick ? `${st.idp_blk_kick} BLK` : "", st.idp_safe ? `${st.idp_safe} SAF` : "",
    // MFL counts special-teams tackles toward IDP totals; Sleeper breaks them out.
    st.st_tkl_solo ? `${st.st_tkl_solo} ST TKL` : "", st.st_ff ? `${st.st_ff} ST FF` : "", st.st_fum_rec ? `${st.st_fum_rec} ST FR` : "",
    (st.idp_td || st.idp_def_td || st.st_td) ? `${(st.idp_td || 0) + (st.idp_def_td || 0) + (st.st_td || 0)} TD` : "",
  ]);
}

/* Expanded row: the same Sleeper line as tiles, every counting stat the
   line folds away (targets, attempts, assists, a lost fumble) laid out,
   with a rate where the volume supports one. Core tiles for the position
   always show (zeros muted) so an empty line still reads as a line;
   the rest only once they count. Context beside MFL's number, as ever. */
const rate = (yd, n) => (n > 0 ? (yd / n).toFixed(1) : null);

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
const ET_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric" });
const ET_WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" });
const spotEl = document.getElementById("spot");
let lastSpotKey = null;

/* The card's entrance (2026-09-11). A day's last whistle used to pop the
   card in; now the space opens first, slowly, from the top down (the
   card's height tweened from nothing, the rows below easing down to make
   room), and only then does the scorer come into view, one piece at a
   time (label and day, headshot, name, position, line, franchise, points;
   .reveal with --i on each, CSS). The MVP of the week gets the same: the
   full opening when it arrives from nothing (a Monday night, the day and
   the week final together), the reveal alone when a day's card turns gold
   in place. A tick's re-render leaves the card alone while the reveal
   runs, so the pieces do not restart. */
const SPOT_OPEN_MS = 1600, SPOT_STEP_MS = 140, SPOT_PIECE_MS = 650;
let spotRevealUntil = 0;
function revealSpotlight(opening) {
  if (reducedMotion.matches) return;
  const pieces = [spotEl.querySelector(".spot-top"), ...spotEl.querySelectorAll(".spot-body > *, .spot-who > *")];
  pieces.forEach((el, i) => el.style.setProperty("--i", i));
  // The body's own rise stays off for good on this render: it is only
  // suppressed by .reveal, and came back as a second flash of the whole
  // card the moment the class came off (2026-09-11).
  spotEl.querySelector(".spot-body").style.animation = "none";
  const open = opening ? SPOT_OPEN_MS : 0;
  spotEl.style.setProperty("--open", `${open}ms`);
  spotEl.classList.add("reveal");
  if (opening) {
    const cs = getComputedStyle(spotEl);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const h = cs.boxSizing === "border-box" ? spotEl.offsetHeight : spotEl.offsetHeight - pad - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
    const a = spotEl.animate(
      [{ height: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: .7 }, { height: `${h}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1 }],
      { duration: SPOT_OPEN_MS, easing: "cubic-bezier(.22, 1, .36, 1)", id: "spot-open" });
    a.onfinish = a.oncancel = () => a.cancel();
  }
  spotRevealUntil = Date.now() + open + pieces.length * SPOT_STEP_MS + SPOT_PIECE_MS + 100;
  clearTimeout(spotRevealTimer);
  spotRevealTimer = setTimeout(() => { spotEl.classList.remove("reveal"); spotEl.style.removeProperty("--open"); }, spotRevealUntil - Date.now());
}
let spotRevealTimer = 0;
// The entrance runs on the first visit after a day's end and on a load
// or a refresh (2026-09-11): a card present when the page loads waits
// under the loader and opens once the board has cascaded in (spotQueued,
// boardReady). A return to the tab leaves it be (until 2026-09-12 a card
// showing when the tab came back after a minute away opened again, and
// the replay wore thin).
let spotQueued = false, boardIn = false;
function boardReady() {
  boardIn = true;
  if (!spotQueued) return;
  spotQueued = false;
  spotEl.hidden = false;
  revealSpotlight(true);
}

// The week's days as they stand: a day has started when its first game has
// kicked off and is final when every game on it has ended.
const dayStates = () => {
  const now = Date.now();
  return dayTeams.days.map((d) => {
    const gs = [...d.teams].map((tm) => games.get(tm)).filter(Boolean);
    return { ...d, started: gs.some((g) => g.kickoff <= now), final: gs.length > 0 && gs.every((g) => g.kickoff <= now && g.secs <= 0) };
  });
};

/* The spotlight's entries, oldest first (2026-09-11): every finished
   day's top starter (Thursday, Sunday, Monday) and, once the week is
   final, the MVP of the week last. The newest is the card's own pick and
   what a new day lands on; the arrows by the day pill flip back through
   the earlier days (spotIndex). Nothing while a day is in progress, as
   before. */
const BEARS_MVP = 40;   // a Bear past this is the MVP of the week, whoever scored more
const isBear = (p) => p.tm === "CHI";
function spotlightEntries() {
  const all = teams.flatMap((t) => liveStarters(t, new Set()).map((p) => ({ ...p, franchise: p.from || t.team })));
  // The Bears rule (2026-09-14, Shakeel's call the night Josh Allen and
  // Caleb Williams tied at 43.43): a tie for the top goes to the Bear, and
  // a Bear over BEARS_MVP points is the MVP of the week outright, whoever
  // scored more. The day cards get the tie rule only.
  const better = (p, a) => p.pts > a.pts || (p.pts === a.pts && isBear(p) && !isBear(a));
  const entry = (pool, label, when, mvp) => {
    if (!pool.length) return null;
    let top = pool.reduce((a, p) => (better(p, a) ? p : a), pool[0]);
    if (mvp) { const bear = pool.filter((p) => isBear(p) && p.pts > BEARS_MVP).reduce((a, p) => (!a || better(p, a) ? p : a), null); if (bear) top = bear; }
    return { top, label, when, mvp, key: `${when}:${top.key}` };
  };
  const out = [];
  if (FIXTURE) {                                                      // no schedule: the staged slate (Thursday's teams, everything else Sunday)
    if (!slate.sunFinal) return [];
    out.push(entry(all.filter((p) => isEarlyDay(p)), "Top scorer", "Thursday", false), entry(all.filter((p) => !isEarlyDay(p)), "Top scorer", "Sunday", false));
  } else {
    const days = dayStates();
    if (days.some((d) => d.started && !d.final)) return [];
    for (const d of days) if (d.final) out.push(entry(all.filter((p) => d.teams.has(p.tm)), "Top scorer", d.name, false));
  }
  if (weekIsFinal()) {
    const mvp = entry(all,
      post ? `\u2605 MVP of ${post.round.ref}` : duel ? "\u2605 MVP of the Pro Bowl" : "\u2605 MVP of the week",
      `${post ? post.round.name : duel ? EXHIBITION.name : `Week ${WEEK}`} final`, true);
    if (mvp && quinnWeek()) { mvp.top = QUINN; mvp.key = `${mvp.when}:${QUINN.key}`; }
    out.push(mvp);
  }
  return out.filter(Boolean);
}
/* Quinn, 3rd and 1's son, is the MVP of Week 2 (2026), whoever the NFL
   sends (Shakeel's surprise for the league, 2026-09-18): once the week's
   games are all final, after Monday night, his card takes the MVP slot in
   the same design and entrance; the day cards stay real. His points are
   his line under the league's rules. `?mvp=quinn` puts him on any finished
   week's MVP card for checking. */
const QUINN_ST = { rec: 6, rec_td: 2, idp_int: 1, idp_def_td: 1 };
const QUINN = {
  key: "quinn", n: "Quinn", pos: "WR", tm: "", team: "Special guest", franchise: "3rd and 1",
  img: "quinn.jpg", logo: "logo.png", line: "6 REC \u00b7 2 TD \u00b7 1 PICK SIX",
  st: QUINN_ST, pts: r2(Scoring.scoreLine(QUINN_ST)),
};
const quinnWeek = () => QUERY.get("mvp") === "quinn" || (!FIXTURE && SEASON === 2026 && WEEK === 2 && !post && !duel);
let spotIndex = null;   // the entry the arrows have flipped to; null is the newest

// flip: a render for the arrows, which shows another entry with the body's
// own rise and no reveal; a poll's render keys the reveal off the newest.
function renderSpotlight(flip = false) {
  const entries = spotlightEntries(), newest = entries[entries.length - 1];
  if (!newest) { spotEl.hidden = true; spotEl.classList.remove("reveal"); spotRevealUntil = 0; spotQueued = false; lastSpotKey = "none"; spotIndex = null; return; }
  const key = newest.key;
  const changed = lastSpotKey !== null && key !== lastSpotKey;
  if (!flip && !changed && Date.now() < spotRevealUntil) return;   // mid-reveal: the pieces would restart
  if (flip) { spotEl.classList.remove("reveal"); spotEl.style.removeProperty("--open"); spotRevealUntil = 0; }
  const appearing = spotEl.hidden || lastSpotKey === null;   // from nothing, the first render included
  if (boardIn) spotEl.hidden = false;   // under the loader it waits for the board (boardReady)
  const phaseChanged = changed && key.split(":")[0] !== lastSpotKey.split(":")[0];
  if (changed || appearing) spotIndex = null;   // a new newest: the card lands on it
  lastSpotKey = key;
  const i = spotIndex == null ? entries.length - 1 : Math.min(spotIndex, entries.length - 1);
  const { top, label, when, mvp } = entries[i];
  spotEl.classList.toggle("mvp", mvp);
  // More than one entry: a pill per day (and the MVP), the shown one lit;
  // tap, swipe or arrow keys flip. One entry: its day as a plain pill.
  const nav = entries.length > 1
    ? `<span class="spot-nav" role="tablist" aria-label="Days">` + entries.map((e, j) =>
        `<button class="spot-tab${j === i ? " on" : ""}${e.mvp ? " gold" : ""}" type="button" role="tab" data-i="${j}" aria-selected="${j === i}" title="${esc(e.when)}">` +
          `<span class="long">${e.mvp ? "\u2605 " : ""}${esc(e.when)}</span><span class="short">${e.mvp ? "\u2605 " : ""}${esc(e.mvp ? "Final" : e.when.slice(0, 3))}</span></button>`).join("") +
      `</span>`
    : `<span class="spot-when">${esc(when)}</span>`;
  const logoImg = top.logo || logoSrc(top.tm);
  const logo = logoImg ? `<span class="logo"><img src="${logoImg}" alt=""></span>` : `<span class="logo">${esc(top.tm)}</span>`;
  spotEl.innerHTML =
    (phaseChanged && newest.mvp && !reducedMotion.matches ? `<span class="spot-flash" aria-hidden="true"></span>` : "") +
    `<div class="spot-top"><span class="micro spot-label">${label}</span>${nav}</div>` +
    `<div class="spot-body"${changed || flip ? "" : ` style="animation:none"`}>` +
      `<span class="spot-face" style="${teamVars(top.tm)}"><span class="pphoto">${avatar(top)}</span>${logo}</span>` +
      `<span class="spot-who">` +
        `<span class="spot-name">${nameHtml(top.n)}</span>` +
        `<span class="spot-meta"><span class="pos ${posClass(top.pos)}">${esc(top.pos)}</span><span>${esc(top.team || top.tm)}</span></span>` +
        `<span class="spot-stat">${esc(top.line || statLine(top.pos, top.st))}</span>` +
        `<span class="spot-for">for <b>${esc(top.franchise)}</b></span>` +
      `</span>` +
      `<span class="spot-pts" data-tween="p:${top.key}">${fmt(top.pts)}</span>` +
    `</div>`;
  // The entrance: the full opening for a card from nothing or a new day's
  // card; the reveal alone when a day's card turns gold in place, or the
  // day's top scorer changes on a correction.
  if (!flip && (appearing || changed)) {
    if (!boardIn) { spotQueued = true; spotEl.hidden = true; return; }
    revealSpotlight(appearing || (phaseChanged && !newest.mvp));
  }
}
// Flip the spotlight to entry j (clamped), re-rendering with the body's
// rise; focus follows onto its pill when asked (keys and taps).
function flipSpot(j, focus = false) {
  const n = spotlightEntries().length;
  if (n < 2) return;
  const cur = spotIndex == null ? n - 1 : Math.min(spotIndex, n - 1);
  const to = Math.max(0, Math.min(n - 1, j));
  if (to === cur) return;
  spotIndex = to;
  renderSpotlight(true);
  if (focus) spotEl.querySelector(`.spot-tab[data-i="${to}"]`)?.focus();
}
const spotCur = () => { const n = spotlightEntries().length; return spotIndex == null ? n - 1 : Math.min(spotIndex, n - 1); };
spotEl.addEventListener("click", (e) => {
  const b = e.target.closest(".spot-tab");
  if (b) flipSpot(Number(b.dataset.i), true);
});
spotEl.addEventListener("keydown", (e) => {
  if (!e.target.closest(".spot-tab")) return;
  const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "Home" ? -Infinity : e.key === "End" ? Infinity : 0;
  if (!d) return;
  e.preventDefault();
  flipSpot(Number.isFinite(d) ? spotCur() + d : d < 0 ? 0 : Infinity, true);
});
// A swipe across the card flips it: left for a later day, right for an
// earlier one, like a carousel. Only a clear horizontal move counts, so a
// scroll that starts on the card is left to the page.
let spotTouch = null;
spotEl.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; spotTouch = { x: t.clientX, y: t.clientY }; }, { passive: true });
spotEl.addEventListener("touchend", (e) => {
  if (!spotTouch) return;
  const t = e.changedTouches[0], dx = t.clientX - spotTouch.x, dy = t.clientY - spotTouch.y; spotTouch = null;
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  flipSpot(spotCur() + (dx < 0 ? 1 : -1));
}, { passive: true });
spotEl.addEventListener("touchcancel", () => { spotTouch = null; }, { passive: true });

/* ---------------- team page ---------------- */

const POS_CLASS = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K" };
const posClass = (pos) => "pos-" + (POS_CLASS[pos] || "IDP");

// Lineup order -- reads like a lineup card, not a points ranking. Within a
// position the order is fixed for the week (name, then id): it used to be
// points, so two backs swapped rows every time one overtook the other,
// and tied rows (0.00 before kickoff) fell back to MFL's array order,
// which changes between polls (2026-09-08).
const POS_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DE: 5, DT: 5, LB: 6, CB: 7, S: 7 };
const byLineup = (a, b) =>
  (POS_ORDER[a.pos] ?? 9) - (POS_ORDER[b.pos] ?? 9) || a.n.localeCompare(b.n) || String(a.id).localeCompare(String(b.id));
// Position groups in the Team view, in lineup order: one labelled hairline
// opens each. Every defender is IDP, the league's one defensive slot type.
const posGroup = (pos) => (POS_CLASS[pos] ? pos : "IDP");
// Rows sway in (a 3D tilt that settles, staggered down the list) when the
// pane's contents change: a team selected or a tab switched. A poll's
// re-render keeps them still, so the board never twitches every 30s.
let rosterEnter = false;

/* The box score (2026-09-25, the redesign's "Broadcast" team page): the
   roster as one table per stat group, Passing, Rushing, Receiving,
   Kicking, Defense, each row the player's photo, name and game, his line
   in columns under the table's labels, and the points. Receivers and
   tight ends share Receiving; every defender is Defense. The columns are
   Sleeper's line (context, as ever); the points are the page's number.
   The roster is a size container: narrow (a phone, the laptop pane at
   1024px) a row is two lines, the name over the columns; wide it is one
   line with the game (both scores, the ball) between the name and the
   columns, and the photo a size up. Photos on at every width. */
const bxNum = (l, ...ks) => ({ l, v: (st) => String(ks.reduce((a, k) => a + (st[k] || 0), 0)), z: (st) => !ks.some((k) => st[k]) });
const bxFrac = (l, a, b) => ({ l, frac: true, v: (st) => `${st[a] || 0}/${st[b] || st[a] || 0}`, z: (st) => !st[a] && !st[b] });
const BOX = {
  QB: ["Passing", [bxFrac("C/ATT", "pass_cmp", "pass_att"), bxNum("YDS", "pass_yd"), bxNum("TD", "pass_td"), bxNum("INT", "pass_int"), bxNum("RUSH", "rush_yd")]],
  RB: ["Rushing", [bxNum("CAR", "rush_att"), bxNum("YDS", "rush_yd"), bxNum("REC", "rec"), bxNum("RYD", "rec_yd"), bxNum("TD", "rush_td", "rec_td")]],
  WR: ["Receiving", [bxNum("TGT", "rec_tgt"), bxNum("REC", "rec"), bxNum("YDS", "rec_yd"), bxNum("TD", "rec_td", "rush_td")]],
  K: ["Kicking", [bxFrac("FG", "fgm", "fga"), bxFrac("XP", "xpm", "xpa"), bxNum("LNG", "fgm_lng")]],
  IDP: ["Defense", [bxNum("TKL", "idp_tkl"), bxNum("SOLO", "idp_tkl_solo", "st_tkl_solo"), bxNum("SACK", "idp_sack"), bxNum("TO", "idp_int", "idp_ff", "idp_fum_rec"), bxNum("PD", "idp_pass_def")]],
};
const boxGroup = (pos) => { const g = posGroup(pos); return g === "TE" ? "WR" : g; };
const rosterHtml = (list, bench, isTop) => {
  const byGroup = new Map();
  for (const p of [...list].sort(byLineup)) {
    const g = boxGroup(p.pos);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(p);
  }
  let i = 0;
  return [...byGroup].map(([g, ps]) => {
    const [title, cols] = BOX[g];
    const head = `<div class="bx-head" role="presentation">` +
      `<span class="bx-t">${title}</span><span class="bx-sp">Player</span><span class="bx-gl">Game</span>` +
      cols.map((c) => `<span class="bx-l">${esc(c.l)}</span>`).join("") +
      `<span class="bx-pl">Pts</span></div>`;
    // Fixed column widths (a fraction wider), so every row lines up under the labels.
    const widths = cols.map((c) => (c.frac ? "var(--bx-f)" : "var(--bx-c)")).join(" ");
    return `<section class="bx" data-g="${g}" style="--bx-n:${cols.length};--bx-cols:${widths}" aria-label="${title}">${head}` +
      ps.map((p) => playerRow(p, bench, !bench && isTop(p), rosterEnter ? i++ : -1, cols, g)).join("") +
    `</section>`;
  }).join("");
};
// The row's game in the wide cut: away over home, scores once kicked off,
// the player's team bright, a football by whoever has the ball, RZ.
const gameCell = (p) => {
  const gs = gameState(p);
  if (!gs) return "";
  const { g, started, live, sit } = gs;
  const view = (s) => (sit ? { ...s, score: sit.scores?.[s.id] ?? s.score, poss: sit.poss === s.id, rz: sit.poss === s.id && sit.rz } : s);
  const side = (s, at) => `<span class="bg-t${s.id === p.tm ? " mine" : ""}${live && s.poss ? " poss" : ""}">` +
    `${at ? `<i>@</i>` : ""}${esc(s.id)}${started ? ` <b>${s.score}</b>` : ""}${live && s.rz ? ` <span class="pg-rz">RZ</span>` : ""}</span>`;
  return side(view(g.away), false) + side(view(g.home), true);
};

const initials = (name) => name.split(/[\s-]+/).filter(Boolean)
  .map((w) => w[0]).slice(0, 2).join("").toUpperCase();

// A CDN headshot that fails (403 for an unknown id) swaps to the initials.
const avatar = (p) => {
  const src = p.img || headshotSrc(p);
  if (src) return `<img class="avatar" src="${src}" alt="" decoding="async" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'), { className: 'avatar-fb', textContent: this.dataset.fb }))" data-fb="${esc(initials(p.n))}">`;
  return `<span class="avatar-fb" aria-hidden="true">${esc(initials(p.n))}</span>`;
};

const logoBadge = (tm) => logoSrc(tm) ? `<span class="plogo"><img src="${logoSrc(tm)}" alt="" loading="lazy"></span>` : "";

// Touchdowns from the stat line (all kinds), so a simulated score adds the
// chip live. IDP scores use the mockup's own idp_td key.
const tdCount = (st) => (st ? (st.pass_td || 0) + (st.rush_td || 0) + (st.rec_td || 0) + (st.idp_td || 0) + (st.idp_def_td || 0) + (st.st_td || 0) + (st.kr_td || 0) + (st.pr_td || 0) : 0);
const tdBadge = (st) => { const n = tdCount(st); return n ? `<span class="ptd">${n > 1 ? n + " " : ""}TD</span>` : ""; };

// What the player card says when there is no line to break out.
const noStats = (p) => phase === "preseason" ? "No stats until kickoff"
  : secsOf(p) == null && !FIXTURE ? "Game not started"
  : "No stats yet";

// The player's NFL game across the top of the card: away at home with
// both scores once it has kicked off (the player's own team bright, a
// football by whoever has the ball, RZ when they are in the red zone),
// and the state: kickoff day and time, the clock, or Final. Scores are
// the schedule's (a minute old at most while games are on); the clock is
// the player's own from liveScoring, which every poll refreshes.
// Where the player's game stands: not started (kickoff day and time), on
// (the clock) or Final. With a fresh situation the clock is ESPN's (the
// schedule's flags are not reliable, see inRedZone, and liveScoring's
// clock is as old as its points, minutes behind). Shared by the game
// strip and the card's Game vital, so the two agree.
const gameState = (p) => {
  const g = games.get(p.tm)?.match;
  if (!g) return null;
  const secs = secsOf(p);
  const started = Date.now() >= g.kickoff || (secs != null && secs < 3600);
  const live = started && secs != null && secs > 0;
  const sit = live ? sitOf(p.tm) : null;
  const sitClock = sit?.state === "in" && sit.period && sit.clock ? `${sit.period > 4 ? "OT" : `Q${sit.period}`} ${sit.clock}` : null;
  const state = !started ? fmtKick(g.kickoff) : secs == null || secs <= 0 ? "Final" : sitClock || clockText(secs);
  return { g, started, live, sit, state };
};
const gameStrip = (p) => {
  const gs = gameState(p);
  if (!gs) return "";
  const { g, started, live, sit, state } = gs;
  const view = (s) => (sit ? { ...s, score: sit.scores?.[s.id] ?? s.score, poss: sit.poss === s.id, rz: sit.poss === s.id && sit.rz } : s);
  const spot = sit && sit.dd && sit.spot ? `${sit.dd} at ${sit.spot}` : sit?.spot ? `ball at ${sit.spot}` : "";
  const play = live && sit?.state === "in" && sit.lastPlay ? playText(sit.lastPlay) : "";
  const team = (s) =>
    `<span class="pg-team${s.id === p.tm ? " mine" : ""}${live && s.poss ? " poss" : ""}">` +
      (logoSrc(s.id) ? `<img src="${logoSrc(s.id)}" alt="" loading="lazy">` : "") +
      `<span class="pg-id">${esc(s.id)}</span>` +
      (started ? `<b class="pg-score">${s.score}</b>` : "") +
      (live && s.rz ? `<span class="pg-rz">RZ</span>` : "") +
    `</span>`;
  return `<div class="pgame${live ? " live" : ""}">` +
    team(view(g.away)) + `<span class="pg-at">${started ? "@" : "at"}</span>` + team(view(g.home)) +
    `<span class="pg-state">${live ? `<span class="dot"></span>` : ""}${esc(state)}</span>` +
    (spot ? `<span class="pg-spot">${esc(spot)}</span>` : "") +
    (play ? `<span class="pg-play">${esc(play)}</span>` : "") +
  `</div>`;
};

// The last play, from the live situation (2026-09-15): ESPN's own text
// ("(Shotgun) J.Gibbs right tackle to SEA 45 for 12 yards (D.Reed)."),
// its formation prefix and full stop dropped. The strip shows it for the
// game; a live row shows it when it names the player, his initial and
// last name as ESPN writes them (the tackler in the brackets counts, so an
// IDP's tackle reads on his row too), and drops it when the next play
// does not. Context: the play narrates, the number is still MFL's or the
// line's.
// A play revised on review carries the ruling and the corrected result
// after it ("... REVERSED. J.Warren left end to MIA 1 for 11 yards"):
// the result is what stands, so it is what shows, marked as reversed.
const playText = (t) => {
  const s = String(t).replace(/^\([^)]*\)\s*/, "").replace(/\s*\.\s*$/, "");
  const m = /REVERSED\.\s*(.+)$/i.exec(s);
  return m ? `Reversed \u00b7 ${m[1]}` : s;
};
// A player as ESPN names him: his initial (one letter or two, "Ja.")
// and last name, with room for a "St. " or "Van " in between ("A.St.
// Brown"). Matches anywhere in a play, the tackler in the brackets too.
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameRe = (p, flags = "i") => {
  const last = lastName(p.n), init = String(p.n).trim()[0];
  // Not after a period: "A.St. Brown" must not read as S. Brown (2026-09-17).
  return last && init ? new RegExp(`(^|[^A-Za-z.])${escRe(init)}[a-z]*\\.\\s?(?:[A-Z][a-z]*\\.?\\s)?${escRe(last)}(?![A-Za-z])`, flags) : null;
};
const playNames = (text, p) => { const re = nameRe(p); return Boolean(re && re.test(text)); };
// Where a play last names the player (the ball carrier is named last), or -1.
const nameAt = (text, p) => {
  const re = nameRe(p, "gi");
  if (!re) return -1;
  let at = -1, m;
  while ((m = re.exec(text))) at = m.index + m[1].length;
  return at;
};
const lastPlayOf = (p) => {
  if (!isLive(p)) return "";
  const sit = sitOf(p.tm);
  const t = sit?.state === "in" ? sit.lastPlay : null;
  if (!t || !playNames(t, p)) return "";
  const re = nameRe(p);
  return playText(t).replace(new RegExp(`^${re.source.replace(/^\(\^\|\[\^A-Za-z\.\]\)/, "")}\\s+`, "i"), "");
};

/* A franchise's play feed (2026-09-17): the last play naming one of its
   live starters, under the "on now" names on its row and the leader's
   hero, so the board narrates without opening a roster. Plays arrive with
   the situation, one per game, so several starters in different games can
   land in the same poll: they queue per franchise and each holds the line
   at least PLAY_DWELL_MS before the next sweeps over it. One play naming
   two of its starters (a pass from its QB to its WR) is one item with
   both names. A play stays up while it is its game's last play, or until
   the next one comes; then it folds away. */
const PLAY_DWELL_MS = 5000, PLAY_SWEEP_MS = 900, PLAY_FOLD_MS = 300, PLAY_QUEUE_MAX = 3;
const feeds = new Map();   // franchise id -> { cur, queue, seen, timer }
const feedOf = (id) => {
  let f = feeds.get(id);
  if (!f) { f = { cur: null, queue: [], seen: new Set(), timer: 0 }; feeds.set(id, f); }
  return f;
};
// ESPN's id and the text: a play revised on review is news again ("Reversed · ...").
const playIdOf = (sit) => `${sit.playId || ""}|${sit.lastPlay}`;
// Still the last play of its game, with its player still on the field.
const playStands = (item) => {
  const sit = sitOf(item.tm);
  return Boolean(sit && sit.state === "in" && playIdOf(sit) === item.pid);
};
// Every play standing now that names a franchise's live starters, one item
// per play, the starters it names in lineup order.
function playsFor(t) {
  const byPlay = new Map();
  for (const p of t.starters.filter(isLive).sort(byLineup)) {
    const text = lastPlayOf(p);
    if (!text) continue;
    const sit = sitOf(p.tm), pid = playIdOf(sit);
    const item = byPlay.get(pid);
    if (item) { item.who.push(lastName(p.n)); item.ps.push(p); item.text = playText(sit.lastPlay); }   // two names: the play as ESPN wrote it
    else byPlay.set(pid, { pid, tm: p.tm, who: [lastName(p.n)], ps: [p], text });
  }
  return [...byPlay.values()].map(({ ps, ...item }) => ({ ...item, text: shortPlay(item.text, ps) }));
}
// The feed's line has two lines on a phone, and ESPN's text cut at the
// end loses the yards, the part worth reading. So the feed says less
// (the roster row and the game strip keep ESPN's words): tacklers in
// brackets go unless one of them is the franchise's own (an IDP's tackle
// is why the play is there), and a pass's depth and direction go ("pass
// short right to" is "pass to"; "incomplete" stays), and so does the
// ball spot before the yards ("to MIN 22 for 9 yards" is "for 9 yards").
const shortPlay = (text, ps) => text
  .replace(/\s*\(([^()]*)\)/g, (m, inner) =>
    /\b[A-Z][a-z]*\.\s?[A-Z]/.test(inner) && !ps.some((p) => playNames(inner, p)) ? "" : m)
  .replace(/\bpass (incomplete )?(?:short|deep) (?:left|right|middle)\b/gi, (m, inc) => `pass ${inc || ""}`.trim())
  .replace(/ to (?:[A-Z]{2,3} )?\d{1,2}(?= for -?\d+ yards?| for no gain)/g, "")   // the spot: the game strip has it, the yards say more
  .replace(/\s{2,}/g, " ").trim();
// On every render: queue the plays not seen yet and let each feed move on.
function feedPlays() {
  const ids = new Set();
  for (const t of teams) {
    ids.add(t.id);
    const f = feedOf(t.id);
    for (const item of playsFor(t)) {
      if (f.seen.has(item.pid)) continue;
      f.seen.add(item.pid);
      if (f.seen.size > 50) f.seen.delete(f.seen.values().next().value);
      f.queue.push(item);
      if (f.queue.length > PLAY_QUEUE_MAX) f.queue.shift();   // a backlog is old news: keep the latest
    }
    advanceFeed(t.id, false);
  }
  for (const id of feeds.keys()) if (!ids.has(id)) { clearTimeout(feeds.get(id).timer); feeds.delete(id); }
}
// Move a feed on if its current play has had its time: the next queued
// play in, or a play that no longer stands out. `patch` writes the line
// in place (from a timer, between renders); a render writes it itself.
function advanceFeed(id, patch) {
  const f = feeds.get(id);
  if (!f) return;
  clearTimeout(f.timer);
  const now = Date.now();
  if (f.cur && !f.cur.folding && now - f.cur.at < PLAY_DWELL_MS) {
    f.timer = setTimeout(() => advanceFeed(id, true), PLAY_DWELL_MS - (now - f.cur.at));
    return;
  }
  f.queue = f.queue.filter(playStands);
  if (f.queue.length) {
    const next = f.queue.shift();
    f.cur = { ...next, at: now, swap: Boolean(f.cur && !f.cur.folding) };
    f.timer = setTimeout(() => advanceFeed(id, true), PLAY_DWELL_MS);
  } else if (f.cur && !f.cur.folding && !playStands(f.cur)) {
    f.cur = { ...f.cur, folding: true, at: now };
    f.timer = setTimeout(() => { if (f.cur?.folding) { f.cur = null; patchFeed(id); } }, PLAY_FOLD_MS);
  } else return;   // it stands and nothing is waiting (or it is folding): the next render looks again
  if (patch) patchFeed(id);
}
function patchFeed(id) {
  for (const el of document.querySelectorAll(`.tfeed[data-feed="${id}"]`)) el.innerHTML = playLineInner(id);
}
// The line: who, then the play. A render mid-sweep carries the sweep on
// from where it was (a negative delay) instead of replaying it.
function playLineInner(id) {
  const c = feeds.get(id)?.cur;
  if (!c) return "";
  const el = Date.now() - c.at;
  const anim = reducedMotion.matches ? ""
    : c.folding ? " fold"
    : el < PLAY_SWEEP_MS ? (c.swap ? " swap" : " new") : "";
  return `<span class="tplay${anim}" style="--el:${Math.round(el)}"><b>${esc(c.who.join(" & "))}</b> ${esc(c.text)}</span>`;
}
const playLine = (t) => `<span class="tfeed" data-feed="${t.id}">${playLineInner(t.id)}</span>`;

// The stat tiles, the player card's middle (they used to expand under
// the row); the game strip sits in the card's hero.
/* This game as a box score (2026-09-11; a grid of tiles before): the
   line's stats in the position's groups, each number over a bar that
   shows it against the player's season high from the game log, so a
   full bar is a season best and a short one a quiet day. The bars are
   empty until the log lands and grow once it has; on a poll's refresh
   they land where they are. Which stats show is the tiles' rule: the
   position's core always (zeros muted), the rest once they count. */
let pcLog = null;   // the open player's season (profileOf's log), once it lands: the bars' scale
let pcBarsGrown = false;   // the bars grow once per card, when the log lands; every render after lands them where they are
const cs = {
  num: (l, k, always = false) => ({ l, always, v: (st) => String(st[k] || 0), n: (st) => st[k] || 0 }),
  sum: (l, ks, always = false) => ({ l, always, v: (st) => String(ks.reduce((a, k) => a + (st[k] || 0), 0)), n: (st) => ks.reduce((a, k) => a + (st[k] || 0), 0) }),
  frac: (l, a, b, always = false) => ({ l, always, frac: true, v: (st) => `${st[a] || 0}/${st[b] || st[a] || 0}`, n: (st) => st[a] || 0, zero: (st) => !(st[a] || 0) && !(st[b] || 0) }),
  rate: (l, yd, n) => ({ l, always: false, v: (st) => rate(st[yd] || 0, st[n] || 0) ?? "0.0", n: (st) => ((st[n] || 0) > 0 ? (st[yd] || 0) / st[n] : 0), zero: (st) => !((st[n] || 0) > 0) }),
};
const CARD_GROUPS = {
  QB: [["Passing", [cs.frac("CMP/ATT", "pass_cmp", "pass_att", true), cs.num("YDS", "pass_yd", true), cs.num("TD", "pass_td", true), cs.num("INT", "pass_int", true), cs.rate("Y/A", "pass_yd", "pass_att")]],
       ["Rushing", [cs.num("CAR", "rush_att"), cs.num("YDS", "rush_yd"), cs.num("TD", "rush_td"), cs.num("FUM", "fum_lost")]]],
  RB: [["Rushing", [cs.num("CAR", "rush_att", true), cs.num("YDS", "rush_yd", true), cs.num("TD", "rush_td", true), cs.rate("Y/C", "rush_yd", "rush_att")]],
       ["Receiving", [cs.frac("REC/TGT", "rec", "rec_tgt", true), cs.num("YDS", "rec_yd", true), cs.num("TD", "rec_td"), cs.num("FUM", "fum_lost")]]],
  WR: [["Receiving", [cs.frac("REC/TGT", "rec", "rec_tgt", true), cs.num("YDS", "rec_yd", true), cs.num("TD", "rec_td", true), cs.rate("Y/R", "rec_yd", "rec")]],
       ["Rushing", [cs.num("CAR", "rush_att"), cs.num("YDS", "rush_yd"), cs.num("TD", "rush_td"), cs.num("FUM", "fum_lost")]]],
  K: [["Kicking", [cs.frac("FG", "fgm", "fga", true), cs.frac("XP", "xpm", "xpa", true), cs.num("LNG", "fgm_lng")]]],
  IDP: [["Tackles", [cs.num("TKL", "idp_tkl", true), cs.num("SOLO", "idp_tkl_solo", true), cs.num("AST", "idp_tkl_ast", true), cs.num("TFL", "idp_tkl_loss"), cs.num("ST TKL", "st_tkl_solo")]],
        ["Plays", [cs.num("SACK", "idp_sack", true), cs.num("INT", "idp_int", true), cs.num("FF", "idp_ff"), cs.num("FR", "idp_fum_rec"), cs.num("PD", "idp_pass_def"), cs.num("BLK", "idp_blk_kick"), cs.num("SAF", "idp_safe"), cs.sum("TD", ["idp_td", "idp_def_td", "st_td"])]]],
};
CARD_GROUPS.TE = CARD_GROUPS.WR;
const statZero = (t, st) => (t.zero ? t.zero(st) : !t.n(st));
// Whether the player's game has begun: the section shows only once it
// has (2026-09-11; before kickoff it said "Game not started" under its
// heading, which is nothing to look at), and a poll's refresh turns it
// on as the game kicks off.
const gameBegun = (p) => {
  if (phase === "preseason") return false;
  const gs = gameState(p);
  if (gs) return gs.started;
  return (p.st && Object.keys(p.st).length > 0) || secsOf(p) != null;   // no schedule entry (the fixture, a bye): a line or a clock says it has
};
// grow: the bars start empty and are widened after a layout (fillBars), for the log's arrival; only that render transitions.
function cardStatsHtml(p, grow = false) {
  const st = p.st && Object.keys(p.st).length ? p.st : null;
  if (!st) return `<p class="pnone">${esc(noStats(p))}</p>`;
  const groups = (CARD_GROUPS[p.pos] || CARD_GROUPS.IDP)
    .map(([name, ts]) => [name, ts.filter((t) => t.always || !statZero(t, st))]).filter(([, ts]) => ts.length);
  const cols = Math.max(...groups.map(([, ts]) => ts.length));
  // The season's other weeks, for the scale (this week is in the log too while its game is on).
  const weeks = pcLog ? Object.values(pcLog).filter((e) => e?.stats && Object.keys(e.stats).length && Number(e.week) !== WEEK).map((e) => e.stats) : [];
  const stat = (t) => {
    const cur = t.n(st), zero = statZero(t, st);
    const others = weeks.map((w) => t.n(w)), hi = Math.max(cur, ...others, 0);
    const pct = weeks.length && hi > 0 ? Math.round((cur / hi) * 100) : 0;   // no season to scale against (the log not here, or Week 1): no bar, not a full one
    const best = weeks.length >= 2 && cur > 0 && others.every((o) => cur > o);   // a strict best, not a tie
    const v = t.frac ? t.v(st).replace("/", "<em>/") + (t.v(st).includes("/") ? "</em>" : "") : esc(t.v(st));
    return `<span class="sv${zero ? " zero" : ""}"><b>${v}</b>` +
      `<small>${esc(t.l)}${best ? `<em class="hi" title="Season best"><span> · best</span></em>` : ""}</small>` +
      `<span class="sb"><span${grow ? ` data-w="${pct}"` : ` style="width:${pct}%"`}></span></span></span>`;
  };
  return `<div class="sbox${grow ? " grow" : ""}" style="--cols:${cols}">` +
    groups.map(([name, ts]) => `<div class="sg"><i>${esc(name)}</i><div class="sg-stats">${ts.map(stat).join("")}</div></div>`).join("") +
  `</div>`;
}
function fillBars(root) {
  const bars = root.querySelectorAll(".sb > span[data-w]");
  void root.offsetWidth;   // the empty bars laid out first, so the widening is a transition and not a landing (a frame later was not enough in every browser)
  for (const b of bars) b.style.width = `${b.dataset.w}%`;
}

// Small badges by a player's name (rowBadges): Sleeper's injury status
// and a newspaper while there is news from the last day (rosterStatus,
// fetched for the open team's whole roster in one batched query).
const INJ_CHIP = { Questionable: ["Q", "soft"], Doubtful: ["D", "soft"], Out: ["OUT", ""], IR: ["IR", ""], PUP: ["PUP", ""], Sus: ["SUS", ""], NA: ["NA", ""], COV: ["COV", ""] };
const NEWS_FRESH_MS = 24 * 3600e3;
const NEWS_ICON = `<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M1.5 2.5h10v9.25a1.25 1.25 0 0 0 2.5 0V5h-1.25V3.5H15.5v8.25A2.75 2.75 0 0 1 12.75 14.5H3.5a2 2 0 0 1-2-2v-10Zm2 2v3h3v-3h-3Zm4.5 0v1.5h2.5v-1.5H8Zm0 2.25v1.5h2.5v-1.5H8ZM3.5 9v1.5h7V9h-7Z"/></svg>`;
const rowBadges = (p) => {
  const st = p.sid && rosterStatus.get(p.sid);
  if (!st) return "";
  let out = "";
  const chip = st.inj && (INJ_CHIP[st.inj] || [st.inj.toUpperCase().slice(0, 3), ""]);
  if (chip) out += `<span class="pinj${chip[1] ? ` ${chip[1]}` : ""}" title="${escq([st.inj, st.part].filter(Boolean).join(" · "))}">${esc(chip[0])}</span>`;
  if (st.newsAt && Date.now() - st.newsAt < NEWS_FRESH_MS) out += `<span class="pnew" title="News ${esc(timeAgo(st.newsAt))}">${NEWS_ICON}</span>`;
  return out;
};

// top: the team's highest-scoring starter gets a gold ring (MVP echo).
// The row is a button: tap (or Enter/Space) opens the player's card (the
// game so far, injury status, the latest news).
// The redesign's photo row (2026-09-24, as mfl-manager's): the headshot on
// its club's two colours (--tc1/--tc2, the touchdown card's TEAM_COLORS),
// clipped in .pphoto so the TD chip and the club mark can sit on its edges,
// and the first name quieter than the last (.fn).
const nameHtml = (n) => {
  const i = n.indexOf(" ");
  return i > 0 ? `<span class="fn">${esc(n.slice(0, i))}</span> ${esc(n.slice(i + 1))}` : esc(n);
};
const teamVars = (tm) => { const c = TEAM_COLORS[tm]; return c ? `--tc1:${c[0]};--tc2:${c[1]};` : ""; };
// The box score's name: the first name shows as an initial in the narrow
// cut and in full in the wide one (.fi / .ff), quieter than the last.
const boxNameHtml = (n) => {
  const i = n.indexOf(" ");
  if (i <= 0) return esc(n);
  const first = n.slice(0, i);
  return `<span class="fn"><span class="fi">${esc(first[0])}.</span><span class="ff">${esc(first)}</span></span> ${esc(n.slice(i + 1))}`;
};
// A box-score row: the same button, keys and signals as the photo row
// (live wash, red zone, top scorer's gold, TD chip, badges, the last
// play), laid out as a table row under its group's labels.
const boxRow = (p, bench, top, enter, cols, g) => {
  const dim = bench && phase !== "preseason";
  const style = teamVars(p.tm) + (enter >= 0 ? `--i:${enter}` : "");
  const st = p.st && Object.keys(p.st).length ? p.st : null;
  const mixed = g === "WR" || g === "IDP";   // the table holds more than one position: say which
  const play = lastPlayOf(p);
  return `<div class="prow bxr${dim ? " bench" : ""}${isLive(p) ? " live" : ""}${inRedZone(p) ? " rz" : ""}${top ? " top" : ""}${enter >= 0 ? " enter" : ""}"${style ? ` style="${style}"` : ""}` +
    ` role="button" tabindex="0" aria-haspopup="dialog" data-pk="${esc(p.key)}"${inRedZone(p) ? ` title="In the red zone"` : ""}>` +
    `<span class="pface"><span class="pphoto">${avatar(p)}</span>${logoBadge(p.tm)}${tdBadge(p.st)}</span>` +
    `<span class="pname"><b><span class="pn">${boxNameHtml(p.n)}</span>${rowBadges(p)}</b>` +
      `<span class="pmeta">${[
        mixed ? `<span class="bx-pos ${posClass(p.pos)}">${esc(p.pos)}</span>` : "",
        esc(p.tm),
        isLive(p) ? `<span class="clock"><span class="dot"></span>${clockFor(p)}</span>` : gameLabel(p) ? `<span>${esc(gameLabel(p))}</span>` : "",
        p.from ? `<span class="pfrom">${esc(p.from)}</span>` : "",
      ].filter(Boolean).join(`<span aria-hidden="true">·</span>`)}</span>` +
    `</span>` +
    `<span class="bx-game">${gameCell(p)}</span>` +
    cols.map((c) => `<span class="bx-v${!st || c.z(st) ? " zero" : ""}">${st ? esc(c.v(st)) : "&mdash;"}</span>`).join("") +
    `<span class="pright">` +
      `<span class="ppts${p.pts === 0 ? " zero" : ""}${p.flash ? " flash" : ""}"${p.key ? ` data-tween="p:${p.key}" data-delta` : ""}>${phase === "preseason" ? "&mdash;" : fmt(p.pts)}</span>` +
    `</span>` +
    (play ? `<span class="pplay">${esc(play)}</span>` : "") +
  `</div>`;
};
const playerRow = (p, bench, top = false, enter = -1, cols = null, g = null) => {
  if (cols) return boxRow(p, bench, top, enter, cols, g);
  const dim = bench && phase !== "preseason";   // pre-season the roster is nobody's bench
  const style = teamVars(p.tm) + (enter >= 0 ? `--i:${enter}` : "");
  return `<div class="prow${dim ? " bench" : ""}${dim && p.pts === 0 ? " zero" : ""}${isLive(p) ? " live" : ""}${inRedZone(p) ? " rz" : ""}${top ? " top" : ""}${enter >= 0 ? " enter" : ""}"${style ? ` style="${style}"` : ""}` +
    ` role="button" tabindex="0" aria-haspopup="dialog" data-pk="${esc(p.key)}"${inRedZone(p) ? ` title="In the red zone"` : ""}>` +
    `<span class="pface"><span class="pphoto">${avatar(p)}</span>${logoBadge(p.tm)}${tdBadge(p.st)}</span>` +
    `<span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span>` +
    `<span class="pname"><b><span class="pn">${nameHtml(p.n)}</span>${rowBadges(p)}</b>` +
      `<span class="pmeta">${[
        esc(p.tm),
        isLive(p) ? `<span class="clock"><span class="dot"></span>${clockFor(p)}</span>` : gameLabel(p) ? `<span>${esc(gameLabel(p))}</span>` : "",
        p.from ? `<span class="pfrom">${esc(p.from)}</span>` : "",
      ].filter(Boolean).join(`<span aria-hidden="true">·</span>`)}</span>` +
      `<span class="pstat">${esc(statLine(p.pos, p.st))}</span>` +
      (lastPlayOf(p) ? `<span class="pplay">${esc(lastPlayOf(p))}</span>` : "") +
    `</span>` +
    `<span class="pright">` +
      `<span class="ppts${p.pts === 0 ? " zero" : ""}${p.flash ? " flash" : ""}"${p.key ? ` data-tween="p:${p.key}" data-delta` : ""}>${phase === "preseason" ? "&mdash;" : fmt(p.pts)}</span>` +
    `</span>` +
  `</div>`;
};

const page = document.getElementById("team");
const rosterEl = document.getElementById("roster");
const tabs = [...page.querySelectorAll(".tab")];
let open = null;       // team id
let picked = null;     // the team last opened: its row stays lifted on the board while its page is up
let tab = "starters";
let lastFocus = null;
let teamView = null;   // the open team as last rendered ({ t, starters, bench }): the player card reads from it

// Starters in lineup order, on the page's number (`ptsOf`). Keyed by player
// id when the feed supplies one (2026-09-09): MFL's array order is not
// stable between polls, so a slot-number key put one poll's flash, roll
// and delta chip on whoever sat in that slot next, playing or not.
const playerKey = (t, p, k, bench = false) => `${t.id}:${bench ? "b" : ""}${p.id ?? k}`;
const liveStarters = (t, changed) => t.starters.map((p, k) => {
  const key = p.key || playerKey(t, p, k);
  return { ...p, key, mfl: p.pts, pts: r2(ptsOf(p)), flash: changed.has(key), st: statsFor(t, k) };
});

const liveBench = (t, changed) => t.bench.map((p, k) => {
  const key = playerKey(t, p, k, true);
  return { ...p, key, mfl: p.pts, pts: r2(ptsOf(p)), flash: changed.has(key), st: statsFor(t, k, true) };
});

function renderTeam(changed = new Set()) {
  const t = byId(open);
  const starters = liveStarters(t, changed);
  const bench = liveBench(t, changed);
  teamView = { t, starters, bench };
  fetchRosterStatus(t);

  const pre = phase === "preseason";
  document.getElementById("team-mark").innerHTML = franchiseMark(t);
  const nameEl = document.getElementById("team-name");
  nameEl.textContent = t.team;
  fitName(nameEl);   // a no-op while the page is closed; openTeam() fits it once shown
  const toPlay = !pre && t.toPlay ? ` \u00b7 ${t.toPlay} to play` : "";
  document.getElementById("team-rec").textContent = pre
    ? (starters.length ? `pre-season \u00b7 ${starters.length} starters set` : "pre-season \u00b7 lineup due at kickoff")
    : post ? `#${t.seed} seed \u00b7 ${t.season}${toPlay}`
    : t.isSide ? `${t.members.length} managers${toPlay}`
    : t.side ? `${t.starters.length} in the ${t.side.name} lineup`
    : `${t.rank ? ORD(t.rank) + " \u00b7 " : ""}${t.record}${toPlay}`;
  const gap = gapNote(t);
  document.getElementById("team-gap").textContent = gap;
  renderTeamSum(t, starters, bench, gap);
  const ptsEl = document.getElementById("team-pts");
  ptsEl.textContent = pre || t.bye ? "\u2014" : fmt(t.live);
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
  benchTab.hidden = Boolean(t.isSide);   // a side has no bench, only the lineup
  benchTab.firstChild.nodeValue = noLineup ? "Roster " : "Bench ";
  document.getElementById("tab-bench-n").textContent = noLineup ? `${bench.length} players` : pre ? String(bench.length) : `${fmt(sum(bench))} behind`;
  // Shown, not stored: the chosen tab survives until a lineup exists, so
  // the pane lands on Starters when the board goes live (or a lineup is set).
  const view = noLineup ? "bench" : t.isSide ? "starters" : tab;

  const list = view === "bench" ? bench : starters;
  const topPts = Math.max(0, ...starters.map((p) => p.pts));
  const isTop = (p) => !bench.includes(p) && topPts > 0 && p.pts === topPts;
  tabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === view)));
  rosterEl.innerHTML = list.length
    ? rosterHtml(list, view === "bench", isTop)
    : `<p class="empty">No ${view} on this roster.</p>`;
  if (rosterEnter) rosterEl.scrollTop = 0;   // new contents start at the top
  rosterEnter = false;
  renderNflNow();
  markMore();
  refreshPlayerCard();
}

// The band over the laptop pane's box score (2026-09-25, the Broadcast
// mock): the top starter's points, who is on, to play and done, the
// touchdowns, the gap to the neighbour and the bench.
function renderTeamSum(t, starters, bench, gap) {
  const el = document.getElementById("team-sum");
  if (phase === "preseason" || t.bye || !starters.length) { el.innerHTML = ""; return; }
  const top = starters.reduce((a, p) => (p.pts > (a?.pts ?? 0) ? p : a), null);
  const on = starters.filter((p) => isLive(p) && !sidelined(p)).length;
  const toPlay = t.toPlay || 0;
  const done = Math.max(0, starters.length - on - toPlay);
  const tds = starters.reduce((a, p) => a + tdCount(p.st), 0);
  const fig = (n, l) => `<span class="tb-fig"><b>${n}</b><small>${l}</small></span>`;
  // The latest play naming one of its live starters (one in the red zone first), with the down and the spot.
  const playing = starters.filter((p) => lastPlayOf(p)).sort((a, b) => inRedZone(b) - inRedZone(a));
  const pp = playing[0], sit = pp && sitOf(pp.tm);
  const play = pp ? `<div class="tb-play">${inRedZone(pp) ? `<span class="tb-rz">RZ</span>` : ""}<b>${esc(lastName(pp.n))}</b> \u00b7 ${esc(lastPlayOf(pp))}` +
    (sit?.dd && sit?.spot ? ` \u00b7 ${esc(sit.dd)} at ${esc(sit.spot)}` : "") + `</div>` : "";
  el.innerHTML =
    `<div class="tb-main"><span class="tb-kick">Box score \u00b7 Week ${WEEK}</span>` +
      `<h2 class="tb-name">${franchiseMark(t)}<span>${esc(t.team)}</span></h2><div class="tb-figs">` +
      (top ? fig(fmt(top.pts), `${esc(lastName(top.n) || top.n)} \u00b7 top`) : "") +
      fig(on, "On now") + fig(toPlay, "To play") + fig(done, "Final") + fig(tds, tds === 1 ? "Touchdown" : "Touchdowns") +
    `</div></div>` +
    `<div class="tb-side">${gap ? `<span class="tb-gap">${esc(gap)}</span>` : ""}` +
      (bench.length && !t.isSide ? `<span class="tb-bench">Bench ${fmt(sum(bench))} behind</span>` : "") + `</div>` + play;
}

// The team head's standing against its neighbour, as the Broadcast
// scorebug has it: the leader's cushion over 2nd, everyone else's
// distance to the rank above. Regular season, once the franchise has begun.
const ORD = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const gapNote = (t) => {
  if (phase !== "live" || post || duel || t.bye || !started(t)) return "";
  const i = teams.indexOf(t);
  if (i < 0 || teams.length < 2) return "";
  return i === 0
    ? `+${fmt(t.live - teams[1].live)} on 2nd`
    : `${fmt(teams[i - 1].live - t.live)} back of ${ORD(i)}`;
};

/* NFL now (2026-09-25, laptop pane): every game on the field this minute
   as a score box over the box score, away over home, the ball, RZ and
   the clock (ESPN's while its situation is fresh, as the game strip).
   Nothing while no game is on; hidden on a phone, where the team page is
   the box score alone. */
const nflNowEl = document.getElementById("nfl-now");
/* Off the field (2026-09-25): with no game live, the laptop's NFL-now
   slot above the pane holds the Top scorer card (the day's, or the MVP)
   instead, moved there from under the leader's card; it goes back when a
   game kicks off, and a phone never moves it. The element itself moves, so
   its flips, swipe and reveal come with it. */
const spotSlot = document.getElementById("spot-slot");
const spotHome = { parent: spotEl.parentElement, next: spotEl.nextElementSibling };
function placeSpot() {
  const up = desktop.matches && phase === "live" && !gamesOn();
  const target = up ? spotSlot : spotHome.parent;
  if (spotEl.parentElement === target) return up;
  if (up) spotSlot.appendChild(spotEl);
  else spotHome.parent.insertBefore(spotEl, spotHome.next);
  markActive();   // the board column changed height above the rows: the pane's top follows the leader's card
  return up;
}
function renderNflNow() {
  if (placeSpot() && !spotEl.hidden) { nflNowEl.hidden = true; nflNowEl.innerHTML = ""; return; }
  const seen = new Set(), all = [];
  for (const g of games.values()) {
    const m = g.match;
    if (!m || seen.has(m)) continue;
    seen.add(m);
    const sit = sitOf(m.home.id);
    const secs = sitSecs(m.home.id) ?? g.secs;
    const started = Date.now() >= m.kickoff || secs < 3600;
    all.push({ m, sit, secs, started, live: started && secs > 0 });
  }
  const live = all.filter((x) => x.live);
  // No game on: the NFL day's slate instead (Eastern), so the space beside
  // the week head reads the day's finals and what is still to come.
  const today = ET_DATE.format(new Date());
  const shown = live.length ? live : all.filter((x) => ET_DATE.format(x.m.kickoff) === today);
  nflNowEl.hidden = !shown.length || phase !== "live";
  if (nflNowEl.hidden) { nflNowEl.innerHTML = ""; return; }
  shown.sort((a, b) => b.live - a.live || a.m.kickoff - b.m.kickoff || a.m.home.id.localeCompare(b.m.home.id));
  const label = live.length ? `NFL now \u00b7 ${live.length} live` : "NFL today";
  nflNowEl.classList.toggle("many", shown.length > 6);
  nflNowEl.innerHTML = `<span class="nn-label"><span>${label}</span>${live.some((x) => x.sit?.rz) ? `<span>Red zone in <em>red</em></span>` : ""}</span><div class="nn-row">` + shown.map(({ m, sit, secs, started, live: on }) => {
    const view = (s) => (sit ? { ...s, score: sit.scores?.[s.id] ?? s.score, poss: sit.poss === s.id, rz: sit.poss === s.id && sit.rz } : s);
    const a = view(m.away), h = view(m.home);
    const rz = on && (a.rz || h.rz);
    const clock = !started ? fmtKick(m.kickoff) : !on ? "Final"
      : sit?.state === "in" && sit.period && sit.clock ? `${sit.period > 4 ? "OT" : `Q${sit.period}`} ${sit.clock}` : clockText(secs);
    const side = (s) => `<span class="nn-t${on && s.poss ? " poss" : ""}"><span class="nn-sw" style="${teamVars(s.id)}"></span><span class="nn-id">${esc(s.id)}</span><b>${started ? s.score : ""}</b></span>`;
    return `<div class="nn-box${rz ? " rz" : ""}${on ? " live" : ""}">${side(a)}${side(h)}<span class="nn-clock">${esc(clock)}${rz ? ` <span class="nn-rz">RZ</span>` : ""}</span></div>`;
  }).join("") + `</div>`;
}

// Laptop and up: the team panel is always in view, so "opening" a team is
// selecting it. The selected row becomes a tab into the panel.
const desktop = matchMedia("(min-width: 1024px)");

/* The back button on a phone (2026-09-11): the team page is a route over
   the board there and the player card a sheet over that, so each pushes
   a history entry as it opens, and the browser's back (the button, the
   system gesture, the edge swipe) closes the topmost. A close from the
   page's own controls pops its entry silently (navSkip), so the history
   never fills with stale entries. The laptop pane is a selection, not a
   navigation, and pushes nothing; the card there closes as before. The
   URL never changes, so nothing reads a different week; a state left
   over from a refresh is cleared at boot. */
let teamPushed = false, cardPushed = false, navSkip = 0;
if (history.state?.mfl) history.replaceState(null, "");   // a refresh on an open page: the entry is not ours any more
const navPush = (kind) => { if (desktop.matches) return false; history.pushState({ mfl: kind }, ""); return true; };
const navBack = (n) => { if (n > 0) { navSkip++; history.go(-n); } };
window.addEventListener("popstate", () => {
  if (navSkip > 0) { navSkip--; return; }   // our own pop: already closed
  if (cardPushed) { cardPushed = false; closePlayer(false, false); }
  else if (teamPushed) { teamPushed = false; closeTeam(false); }
});

// The pane is capped at the window and the roster card scrolls inside it;
// data-more shows a fade over the card's bottom edge while there is more.
function markMore() {
  const more = desktop.matches && rosterEl.scrollHeight - rosterEl.scrollTop - rosterEl.clientHeight > 4;
  page.dataset.more = more ? "1" : "0";
}
rosterEl.addEventListener("scroll", markMore, { passive: true });
addEventListener("resize", markMore);

// The pane's background is a top-to-bottom gradient; the tab needs the
// pane's colour at its own height, so each active element is told how far
// down the pane it sits (--tab-t) and the CSS mixes the matching colour.
function markActive() {
  const heroWrap0 = document.getElementById("hero-wrap");
  if (desktop.matches && !heroWrap0.hidden) {
    const col = heroWrap0.closest(".col-board").getBoundingClientRect(), h = heroWrap0.getBoundingClientRect();
    page.style.setProperty("--pane-top", `${Math.max(0, h.top - col.top)}px`);
    page.style.setProperty("--hero-h", `${h.height}px`);
  } else { page.style.removeProperty("--pane-top"); page.style.removeProperty("--hero-h"); }
  const pane = page.getBoundingClientRect();
  const place = (el, on) => {
    el.classList.toggle("active", on);
    if (!on || !pane.height) return;
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (r.top + r.height / 2 - pane.top) / pane.height));
    el.style.setProperty("--tab-t", `${(t * 100).toFixed(2)}%`);
  };
  for (const el of rowsEl.querySelectorAll(".row")) {
    place(el, desktop.matches && el.dataset.id === open);
    el.classList.toggle("sel", el.dataset.id === picked);
  }
  const heroWrap = document.getElementById("hero-wrap");
  place(heroWrap, desktop.matches && teams[0]?.id === open);
  page.classList.toggle("hero-tab", desktop.matches && !heroWrap.hidden && teams[0]?.id === open);
  // The Bowl's and the Pro Bowl's card is a face-off naming both sides, not
  // the picked one, so the band keeps the picked team's name (2026-09-25).
  page.classList.toggle("face-off", Boolean(duel) || Boolean(post?.round?.bowl));
  syncHeroAway();
  heroWrap.classList.toggle("sel", phase !== "preseason" && teams[0]?.id === picked);
}
addEventListener("resize", () => { if (desktop.matches) markActive(); });

/* The leader's name in the band while its card is scrolled away (laptop,
   2026-09-25): the card beside the band names the team, so the band hides
   the name while the card is there; once the page scrolls the card up past
   the band's bottom (the pane is sticky, the card is not), the name comes
   in, and goes again when the card is back. One rAF per scroll burst. */
let awayFrame = 0;
function syncHeroAway() {
  awayFrame = 0;
  const heroWrap = document.getElementById("hero-wrap");
  const band = document.getElementById("team-band");
  const on = desktop.matches && page.classList.contains("hero-tab");
  const away = on && heroWrap.getBoundingClientRect().bottom < band.getBoundingClientRect().bottom - 24;
  page.classList.toggle("hero-away", away);
}
addEventListener("scroll", () => { if (!awayFrame) awayFrame = requestAnimationFrame(syncHeroAway); }, { passive: true });

function openTeam(id, pick = true) {
  open = id; tab = "starters";
  if (pick) picked = id;
  rosterEnter = true;
  renderTeam();
  markActive();
  if (desktop.matches) return;   // the panel is already showing it

  lastFocus = document.activeElement;
  const wasOpen = page.dataset.open === "true";
  page.dataset.open = "true";
  if (!wasOpen && !teamPushed) teamPushed = navPush("team");
  page.scrollTop = 0;
  document.body.classList.add("team-open");   // board keeps its scroll position
  fitName(document.getElementById("team-name"));   // measurable now that the page is displayed
  document.getElementById("back").focus();
}

function closeTeam(pop = true) {   // pop: take the page's history entries back too (a back press already has)
  if (desktop.matches) return;   // nothing to close; the panel stays
  if (page.dataset.open !== "true") return;
  let entries = 0;
  if (cardPushed) { cardPushed = false; entries++; }
  if (teamPushed) { teamPushed = false; entries++; }
  if (pop) navBack(entries);
  closePlayer(true, false);
  page.dataset.open = "closing";   // fades out, then unmounts below
  document.body.classList.remove("team-open");
  open = null;
  picked = null;   // the row's lift comes off with the page (it used to stay, as a trace of where you had been; it read as stuck, 2026-09-10)
  markActive();
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
tabs.forEach((b) => b.addEventListener("click", () => { if (!b.hidden && !tabs.some((o) => o.hidden)) tab = b.dataset.tab; rosterEnter = true; renderTeam(); }));

/* ---------------- player card ----------------
   A tap on a roster row opens the player's card over the page
   (2026-09-10; it replaced the breakdown that expanded under the row):
   the game so far (the game strip and the stat tiles), the points rolling
   on the shared tween key, Sleeper's injury status, and the latest news,
   the same RotoWire / FantasyPros / RotoBaller items Sleeper's own app
   shows, read straight from sleeper.app/graphql (it answers with
   access-control-allow-origin: *, so no proxy), fetched once per open,
   remembered a few minutes, never on the poll. A poll's re-render refills
   the hero and the game from the current roster and leaves the news
   alone. Every item names its source and links to it: that attribution is
   the condition of using the feed (fantasy-draft-assistant, Aug 2026).
   Context beside the number, as the stat lines are: nothing here feeds a
   score. */
const pcard = document.getElementById("pcard");
const pcSheet = document.getElementById("pc-sheet");
let pcKey = null;      // the open player's key (playerKey); null while closed
let pcFocus = null;    // the row that opened it, for focus on close
let pcInjury = null;   // Sleeper's injury fields for the open player, once they land
let pcTimer = 0;
let pcPanel = "news";   // the phone's open tab, news or game log; every card opens on the news
const PC_IN_MS = 520;   // the sheet's sweep up from the bottom (styles.css: fflr-pc-in)
const NEWS_WIPE_MS = 520;   // the news sweeping in from the left, once the sheet has landed
const SWEEP_EASE = "cubic-bezier(.22, 1, .36, 1)";

const PROFILE_TTL_MS = 3 * 60e3;
const profiles = new Map();   // Sleeper id -> { at, news: Promise, injury: Promise }

async function sleeperGql(query) {
  const res = await fetch("https://sleeper.app/graphql", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`sleeper graphql ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

const NEWS_SOURCES = { fantasy_pros: "FantasyPros", rotowire: "RotoWire", rotoballer: "RotoBaller", sleeper: "Sleeper", nfl: "NFL.com", espn: "ESPN" };
const sourceLabel = (src) => NEWS_SOURCES[src] || String(src || "Report").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const timeAgo = (ms) => {
  const secs = Math.max(0, (Date.now() - ms) / 1000);
  if (secs < 90) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  const days = Math.round(secs / 86400);
  return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
};
// "Sep 2, 6:56 PM", the reader's own clock, as Sleeper's card dates its news.
const WHEN_FMT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const whenLabel = (ms) => WHEN_FMT.format(new Date(ms));
// RotoBaller's `published` is Eastern wall-clock written as UTC: on the
// Week 1 opener its "exits the game" item read an hour BEFORE kickoff, and
// RotoWire's equivalent came four hours after it (2026-09-10). So it is
// shifted by Eastern's offset at that instant (DST through Intl), and the
// items sort on the corrected time. The other two sources are right.
const ET_OFFSET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" });
const etOffsetMs = (ms) => {
  const name = ET_OFFSET.formatToParts(ms).find((x) => x.type === "timeZoneName")?.value || "";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60e3 : -5 * 3600e3;
};
const newsItem = (n) => {
  const m = n.metadata || {};
  let at = Number(n.published) || 0;
  if (n.source === "rotoballer" && at) at -= etOffsetMs(at);   // 20:45 "Z" that was 20:45 ET (-04:00) -> 00:45Z
  return { at, source: n.source, title: m.title || "", desc: m.description || "", analysis: m.analysis || "", url: m.url || "" };
};

function profileOf(sid) {
  const id = String(sid).replace(/[^A-Za-z0-9]/g, "");
  const have = profiles.get(id);
  if (have && Date.now() - have.at < PROFILE_TTL_MS) return have;
  const prof = {
    at: Date.now(),
    // The season week by week (api.sleeper.com, CORS open): each week's
    // line with the opponent, for the game log.
    log: fetch(`https://api.sleeper.com/stats/nfl/player/${id}?season_type=regular&season=${SEASON}&grouping=week`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`sleeper ${r.status}`))))
      .then((d) => (d && typeof d === "object" ? d : {}))
      .catch(() => null),
    news: sleeperGql(`{get_player_news(sport:"nfl",player_id:"${id}",limit:8){metadata published source}}`)
      .then((d) => (d.get_player_news || []).map(newsItem).sort((a, b) => b.at - a.at))
      .catch(() => null),   // null: the fetch failed; []: no news
    injury: sleeperGql(`{get_player(sport:"nfl",player_id:"${id}"){injury_status injury_body_part injury_notes practice_participation}}`)
      .then((d) => d.get_player || null)
      .catch(() => null),
  };
  profiles.set(id, prof);
  return prof;
}

/* The game log (2026-09-11), cut after Sleeper's: every week of the
   season, the opponent and the NFL result from ESPN's team schedule
   (site.api.espn.com, CORS open, one call per team held ten minutes),
   the player's line for the week from Sleeper's per-player season
   (profileOf's `log`), the points under the league's rules
   (Scoring.scoreLine, the same number the page shows on a game day)
   and the snap share, then the position's own groups. A week with a
   game and no line is dashes (not played, or not yet); the bye says
   so. Without the schedule the log falls back to the weeks Sleeper
   has, with no result. Context beside the number, like the news. */
const ESPN_ABBR = { SFO: "sf", NEP: "ne", GBP: "gb", KCC: "kc", TBB: "tb", NOS: "no", LVR: "lv", JAC: "jax", WAS: "wsh" };   // MFL code -> ESPN's
const TO_MFL = { SF: "SFO", NE: "NEP", GB: "GBP", KC: "KCC", TB: "TBB", NO: "NOS", LV: "LVR", JAX: "JAC", WSH: "WAS" };    // Sleeper's and ESPN's -> MFL
const toMfl = (code) => TO_MFL[String(code || "").toUpperCase()] || String(code || "").toUpperCase();
const schedules = new Map();   // MFL team code -> { at, promise }
const SCHEDULE_TTL_MS = 10 * 60e3;
function teamSchedule(tm) {
  if (!tm) return Promise.resolve(null);
  const have = schedules.get(tm);
  if (have && Date.now() - have.at < SCHEDULE_TTL_MS) return have.promise;
  const abbr = ESPN_ABBR[tm] || String(tm).toLowerCase();
  const promise = fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${abbr}/schedule?season=${SEASON}`, { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`espn ${r.status}`))))
    .then((d) => {
      const weeks = {};
      for (const ev of d.events || []) {
        const c = ev.competitions?.[0], w = Number(ev.week?.number);
        if (!c || !w) continue;
        const mine = c.competitors.find((x) => toMfl(x.team?.abbreviation) === tm), them = c.competitors.find((x) => x !== mine);
        if (!mine || !them) continue;
        const final = c.status?.type?.completed === true || typeof mine.winner === "boolean";
        weeks[w] = { opp: toMfl(them.team?.abbreviation), home: mine.homeAway === "home", final,
          us: Number(mine.score?.value ?? mine.score), them: Number(them.score?.value ?? them.score), win: mine.winner === true, date: ev.date };
      }
      return { weeks, bye: Number(d.byeWeek) || 0 };
    });
  schedules.set(tm, { at: Date.now(), promise });
  promise.catch(() => schedules.delete(tm));
  return promise;
}
const LOG_WEEKS = 18;
const logCol = (l, f) => ({ l, f });
const logFrac = (l, a, b) => logCol(l, (st) => `${st[a] || 0}/${st[b] || st[a] || 0}`);
const logRate = (l, yd, n) => logCol(l, (st) => rate(st[yd] || 0, st[n] || 0) ?? "0.0");
function logGroups(pos) {
  const rush = ["Rushing", [logCol("CAR", (st) => st.rush_att || 0), logCol("YDS", (st) => st.rush_yd || 0), logCol("TD", (st) => st.rush_td || 0), logRate("AVG", "rush_yd", "rush_att"), logCol("LNG", (st) => st.rush_lng || 0)]];
  const rec = ["Receiving", [logCol("REC", (st) => st.rec || 0), logCol("TGT", (st) => st.rec_tgt || 0), logCol("YDS", (st) => st.rec_yd || 0), logCol("TD", (st) => st.rec_td || 0), logCol("LNG", (st) => st.rec_lng || 0)]];
  if (pos === "QB") return [
    ["Passing", [logFrac("CMP/ATT", "pass_cmp", "pass_att"), logCol("YDS", (st) => st.pass_yd || 0), logCol("TD", (st) => st.pass_td || 0), logCol("INT", (st) => st.pass_int || 0), logRate("Y/A", "pass_yd", "pass_att")]],
    ["Rushing", rush[1].slice(0, 3)],
  ];
  if (pos === "RB") return [rush, ["Receiving", rec[1].slice(0, 4)]];
  if (pos === "WR" || pos === "TE") return [rec, ["Rushing", rush[1].slice(0, 3)]];
  if (pos === "K") return [["Kicking", [logFrac("FG", "fgm", "fga"), logCol("LNG", (st) => st.fgm_lng || 0), logFrac("XP", "xpm", "xpa")]]];
  return [["Defense", [logCol("TKL", (st) => st.idp_tkl || 0), logCol("SOLO", (st) => st.idp_tkl_solo || 0), logCol("AST", (st) => st.idp_tkl_ast || 0),
    logCol("SACK", (st) => st.idp_sack || 0), logCol("TFL", (st) => st.idp_tkl_loss || 0), logCol("INT", (st) => st.idp_int || 0),
    logCol("FF", (st) => st.idp_ff || 0), logCol("PD", (st) => st.idp_pass_def || 0), logCol("TD", (st) => st.idp_def_td || 0)]]];
}
const snapShare = (st, pos) => {
  const idp = !["QB", "RB", "WR", "TE", "K"].includes(pos);
  const mine = idp ? st.def_snp : st.off_snp, team = idp ? st.tm_def_snp : st.tm_off_snp;
  return mine && team ? `${Math.round((mine / team) * 100)}%` : "\u2014";
};
function gameLogHtml(p, log, sched) {
  const groups = [["Fantasy", [logCol("PTS", (st) => fmt(r2(Scoring.scoreLine(st)))), logCol("SNP%", (st) => snapShare(st, p.pos))]], ...logGroups(p.pos)];
  const cols = groups.flatMap(([, c]) => c);
  const oppHtml = (opp, home) => opp
    ? `<i>${home ? "vs" : "@"}</i>${logoSrc(opp) ? `<img src="${logoSrc(opp)}" alt="">` : ""}${esc(opp)}`
    : "\u2014";
  const resHtml = (g) => g?.final && Number.isFinite(g.us) && Number.isFinite(g.them)
    ? `<b class="${g.win ? "w" : g.us === g.them ? "t" : "l"}">${g.win ? "W" : g.us === g.them ? "T" : "L"}</b> ${g.us}-${g.them}` : "\u2014";
  // Two renderings of the same weeks: the table for a laptop, and for a
  // phone a stacked list, a week to a row with the line under it, so
  // nothing scrolls sideways.
  const rows = [], items = [];
  for (let w = 1; w <= LOG_WEEKS; w++) {
    const g = sched?.weeks?.[w], e = log?.[w] || log?.[String(w)];
    const st = e?.stats && Object.keys(e.stats).length ? e.stats : null;
    const now = w === WEEK ? " now" : "";
    if (sched && w === sched.bye) {
      rows.push(`<tr class="${now.trim()}"><td class="wk">${w}</td><td class="bye" colspan="${cols.length + 2}">Bye</td></tr>`);
      items.push(`<div class="plog-item bye${now}"><span class="wk">${w}</span><span class="opp">Bye</span></div>`);
      continue;
    }
    if (!g && !e) {
      if (sched) continue;
      rows.push(`<tr class="${now.trim()}"><td class="wk">${w}</td><td class="opp">\u2014</td><td class="res">\u2014</td>${cols.map(() => `<td class="dash">\u2014</td>`).join("")}</tr>`);
      items.push(`<div class="plog-item${now}"><span class="wk">${w}</span><span class="opp">\u2014</span><span class="res">\u2014</span><b class="pts dash">\u2014</b></div>`);
      continue;
    }
    const opp = g ? g.opp : toMfl(e.opponent), home = g ? g.home : !e.is_away_team;
    rows.push(`<tr class="${now.trim()}"><td class="wk">${w}</td><td class="opp">${oppHtml(opp, home)}</td><td class="res">${resHtml(g)}</td>` +
      cols.map((c) => (st ? `<td>${esc(String(c.f(st)))}</td>` : `<td class="dash">\u2014</td>`)).join("") + `</tr>`);
    const line = st ? (statLine(p.pos, st) || "No stats") : g?.final ? "Did not play" : "";
    items.push(`<div class="plog-item${now}"><span class="wk">${w}</span><span class="opp">${oppHtml(opp, home)}</span><span class="res">${resHtml(g)}</span>` +
      `<b class="pts${st ? "" : " dash"}">${st ? fmt(r2(Scoring.scoreLine(st))) : "\u2014"}</b>` +
      (line ? `<span class="plog-line">${esc(line)}</span>` : "") + `</div>`);
  }
  if (!rows.length) return `<p class="pc-meta">No games logged for ${esc(p.n)} this season.</p>`;
  return `<table class="plog"><thead>` +
    `<tr class="grp"><th colspan="3"></th>${groups.map(([name, c]) => `<th colspan="${c.length}"><span>${esc(name)}</span></th>`).join("")}</tr>` +
    `<tr class="cols"><th class="wk">WK</th><th class="opp">OPP</th><th class="res">RESULT</th>${cols.map((c) => `<th>${esc(c.l)}</th>`).join("")}</tr>` +
    `</thead><tbody>${rows.join("")}</tbody></table>` +
    `<div class="plog-list">${items.join("")}</div>`;
}
const LOG_SKELETON = `<div class="pnews skel plog-skel" aria-hidden="true"><i style="width:60%"></i><i></i><i></i><i></i><i></i><i></i></div>`;

// The open player as the roster shows him now (points, line, flash), from
// the open team's last render: starters or bench, whichever tab.
const pcPlayer = () => {
  if (pcKey === null || !teamView) return null;
  const p = teamView.starters.find((x) => x.key === pcKey);
  if (p) return { p, t: teamView.t, bench: false };
  const b = teamView.bench.find((x) => x.key === pcKey);
  return b ? { p: b, t: teamView.t, bench: true } : null;
};

const escq = (v) => esc(v).replace(/"/g, "&quot;");
const INJ_SOFT = new Set(["Questionable", "Doubtful"]);
const injuryChip = (inj) => {
  if (!inj?.injury_status) return "";
  const bits = [inj.injury_status, inj.injury_body_part].filter(Boolean).join(" · ");
  const practice = inj.practice_participation ? ` · ${inj.practice_participation} practice` : "";
  return `<span class="pc-inj${INJ_SOFT.has(inj.injury_status) ? " soft" : ""}"${inj.injury_notes ? ` title="${escq(inj.injury_notes)}"` : ""}>${esc(bits + practice)}</span>`;
};
// The hero band: the team's colours (TEAM_COLORS, as on the touchdown
// card; the theme's own for a free agent), its logo ghosted behind the
// headshot, the name, the franchise as a kicker, and the vitals: the
// points (rolling) and the game strip (the fixture has no schedule, so
// there the row's own label).
function pcHeroHtml(p, t) {
  const rs = p.sid && rosterStatus.get(p.sid);
  const inj = pcInjury || (rs ? { injury_status: rs.inj, injury_body_part: rs.part } : null);
  const strip = gameStrip(p) || `<b>${esc(phase === "preseason" ? "Pre-season" : gameLabel(p))}</b>`;
  const team = `<span class="pc-team">${logoSrc(p.tm) ? `<img src="${logoSrc(p.tm)}" alt="">` : ""}${esc(p.tm || "FA")}</span>`;
  return `<div class="pc-hero">` +
    (logoSrc(p.tm) ? `<img class="pc-mark" src="${logoSrc(p.tm)}" alt="" aria-hidden="true">` : "") +
    `<span class="pface pc-face">${avatar(p)}${logoBadge(p.tm)}${tdBadge(p.st)}</span>` +
    `<div class="pc-main">` +
      `<span class="pc-kicker">${esc(p.from || t.team)} · Week ${WEEK}</span>` +
      `<h2 class="pc-name" id="pc-name">${esc(p.n)}</h2>` +
      `<div class="pc-sub">${team}<span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span>` +
        `<span id="pc-inj-slot">${injuryChip(inj)}</span>` +
      `</div>` +
    `</div>` +
    `<div class="pc-vitals">` +
      `<span class="pc-vital"><i>Points</i><b class="pc-pts${p.flash ? " flash" : ""}" data-tween="p:${esc(p.key)}" data-delta>${phase === "preseason" ? "&mdash;" : fmt(p.pts)}</b></span>` +
      `<span class="pc-vital game"><i>Game</i>${strip}</span>` +
    `</div>` +
  `</div>`;
}
// Three ghost stories hold the news' place while it loads, so the card
// reads as full from the first frame instead of filling in.
const NEWS_SKELETON = Array.from({ length: 3 }, () =>
  `<div class="pnews skel" aria-hidden="true"><i style="width:74%"></i><i style="width:34%"></i><i></i><i style="width:88%"></i></div>`).join("");

/* The news is the card's second act (2026-09-11): the sheet sweeps up
   from the bottom with the player's data, and once it has landed the
   news sweeps in from the left: the stories themselves if they are
   already here, the ghost stories otherwise, with the real ones sweeping
   over the ghosts when they land (a wipe front crossing left to right,
   the ghosts nudged off ahead of it), never before the ghosts have
   finished arriving. Reduced motion lands each at once. */
function sweepIn(el) {
  el.classList.remove("pending");
  if (reducedMotion.matches) return;
  el.animate([{ clipPath: "inset(0 100% 0 0)", transform: "translateX(-12px)" }, { clipPath: "inset(0 0 0 0)", transform: "none" }],
    { duration: NEWS_WIPE_MS, easing: SWEEP_EASE });
}
function showNews(list, items, p, overGhosts) {
  list.closest(".pc-news")?.classList.remove("loading");
  let ghost = null;
  if (overGhosts && !reducedMotion.matches) {
    ghost = document.createElement("div");
    ghost.className = "pc-news-ghost"; ghost.setAttribute("aria-hidden", "true");
    ghost.innerHTML = list.innerHTML; ghost.style.top = `${list.offsetTop}px`;
    list.parentElement.appendChild(ghost);
  }
  list.innerHTML = newsHtml(items, p);   // the sheet is a fixed height on every screen: nothing grows
  sweepIn(list);
  if (ghost) {
    const a = ghost.animate([{ clipPath: "inset(0 0 0 0)", transform: "none" }, { clipPath: "inset(0 0 0 100%)", transform: "translateX(12px)" }],
      { duration: NEWS_WIPE_MS, easing: SWEEP_EASE, fill: "forwards" });
    a.onfinish = () => ghost.remove();
    setTimeout(() => ghost.remove(), NEWS_WIPE_MS + 100);   // a backgrounded tab never finishes an animation
  }
}

function newsHtml(items, p) {
  if (items === null) return `<p class="pc-meta">Couldn't load the news. <a href="https://news.google.com/search?q=${encodeURIComponent(`${p.n} ${p.tm || ""}`.trim())}" target="_blank" rel="noopener">Search the news &#8599;</a></p>`;
  if (!items.length) return `<p class="pc-meta">No recent news for ${esc(p.n)}.</p>`;
  return items.slice(0, 6).map((n) => `<article class="pnews">` +
    `<h5>${esc(n.title || "Update")}</h5>` +
    `<div class="pnews-when">${n.at ? `${esc(whenLabel(n.at))} via ` : ""}<b>${esc(sourceLabel(n.source))}</b></div>` +
    (n.desc ? `<p>${esc(n.desc)}</p>` : "") +
    (n.analysis ? `<div class="pnews-analysis"><b>Analysis:</b> ${esc(n.analysis)}</div>` : "") +
    (n.url ? `<a href="${escq(n.url)}" target="_blank" rel="noopener">Read at ${esc(sourceLabel(n.source))} &#8599;</a>` : "") +
  `</article>`).join("");
}

function openPlayer(key, row) {
  pcKey = key; pcInjury = null; pcPanel = "news"; pcLog = null; pcBarsGrown = false;
  const hit = pcPlayer();
  if (!hit) { pcKey = null; return; }
  clearTimeout(pcTimer);
  pcFocus = row || null;
  const { p, t } = hit;
  const openedAt = performance.now();
  const [ground, accent] = TEAM_COLORS[p.tm] || [];
  pcSheet.style.cssText = ground ? `--pc-ground:${ground};--pc-accent:${accent}` : "";   // the tab and the band wear the team's colours
  // The body's sections are flat siblings: the laptop's grid places the
  // game and the log in the left column and the news in the right, and
  // the phone stacks them, the news and the log behind a pair of tabs.
  const tab = (id, label) => `<button class="tab" type="button" role="tab" data-panel="${id}" aria-selected="${pcPanel === id}">${label}</button>`;
  pcSheet.innerHTML =
    `<button class="pc-close" id="pc-close" type="button" aria-label="Close">&#x2715;</button>` +
    `<div id="pc-hero">${pcHeroHtml(p, t)}</div>` +
    `<div class="pc-body" data-panel="${pcPanel}">` +
      `<section class="pc-game${gameBegun(p) ? "" : " off"}"><h4>This game</h4><div id="pc-game">${cardStatsHtml(p)}</div></section>` +
      `<div class="pc-tabs" role="tablist" aria-label="Player">${tab("news", "News")}${tab("log", "Game log")}</div>` +
      `<section class="pc-news${p.sid ? " loading" : ""}"><div class="pc-news-inner"><h4>News</h4>` +
        `<div class="pc-news-list${p.sid ? " pending" : ""}" id="pc-news-list">${p.sid ? NEWS_SKELETON : `<p class="pc-meta">No news feed for this player.</p>`}</div>` +
      `</div></section>` +
      `<section class="pc-log"><h4>Game log</h4><div class="plog-wrap${p.sid ? " pending" : ""}" id="pc-log">${p.sid ? LOG_SKELETON : `<p class="pc-meta">No game log for this player.</p>`}</div></section>` +
    `</div>`;
  const wasOpen = pcard.dataset.open === "true";
  pcard.dataset.open = "true";
  if (!wasOpen && !cardPushed) cardPushed = navPush("card");
  document.body.classList.add("pcard-open");
  document.getElementById("pc-close").focus({ preventScroll: true });
  if (!p.sid) return;
  const prof = profileOf(p.sid);
  const still = () => pcKey === key && pcard.dataset.open === "true";   // not closed, or another player since
  // Act two once the sheet has landed (sweepIn / showNews): the sheet is
  // as tall as its content, and a phone slides it up by its own height,
  // so stories arriving mid-slide made it jump (2026-09-10).
  let landed;   // the stories, once they are here
  prof.news.then((items) => { landed = items; });
  // The game log lands the same way, once the sheet has: the season from
  // Sleeper beside the team's schedule from ESPN (a failed schedule still
  // logs the weeks Sleeper has).
  Promise.all([prof.log, teamSchedule(p.tm).catch(() => null)]).then(([log, sched]) => {
    const wait = reducedMotion.matches ? 0 : Math.max(0, PC_IN_MS - (performance.now() - openedAt));
    setTimeout(() => {
      const wrap = still() && document.getElementById("pc-log");
      if (!wrap) return;
      wrap.innerHTML = log || sched ? gameLogHtml(p, log || {}, sched) : `<p class="pc-meta">Couldn't load the game log.</p>`;
      sweepIn(wrap);
      // The box score's bars: scaled to the season now that it is here, growing in.
      pcLog = log || null;
      const hit = pcPlayer(), game = document.getElementById("pc-game");
      if (hit && game && pcLog && !pcBarsGrown) { pcBarsGrown = true; game.innerHTML = cardStatsHtml(hit.p, true); fillBars(game); }
    }, wait);
  });
  setTimeout(() => {
    if (!still()) return;
    const list = document.getElementById("pc-news-list");
    if (landed !== undefined) { showNews(list, landed, p, false); return; }
    sweepIn(list);   // the ghost stories, while the news loads
    const sweptAt = performance.now();
    prof.news.then((items) => {
      const wait = reducedMotion.matches ? 0 : Math.max(0, NEWS_WIPE_MS - (performance.now() - sweptAt));
      setTimeout(() => { if (still()) showNews(document.getElementById("pc-news-list"), items, p, true); }, wait);
    });
  }, reducedMotion.matches ? 0 : Math.max(0, PC_IN_MS - (performance.now() - openedAt)));
  prof.injury.then((inj) => {
    if (!still()) return;
    pcInjury = inj;
    const slot = document.getElementById("pc-inj-slot");
    if (slot) slot.innerHTML = injuryChip(inj);
  });
}

// A render while the card is up: the hero and the game refill from the
// current roster (the number rolls, since the card is among the live
// surfaces); the news stays. Called by renderTeam, so a tab switch and a
// poll both land here.
function refreshPlayerCard() {
  if (pcKey === null || pcard.dataset.open !== "true") return;
  const hit = pcPlayer();
  if (!hit) { closePlayer(); return; }   // no longer on the open team
  const { p, t } = hit;
  document.getElementById("pc-hero").innerHTML = pcHeroHtml(p, t);
  document.getElementById("pc-game").innerHTML = cardStatsHtml(p);
  pcSheet.querySelector(".pc-game")?.classList.toggle("off", !gameBegun(p));
}

/* Roster status: for every player on the open team, Sleeper's injury
   status and the date of his latest news item, in one batched GraphQL
   query (aliases; about a second and 2KB for twenty players), asked for
   when a team is shown and again every few minutes while it is. Rows
   wear them as badges by the name (rowBadges) and the card's injury
   chip reads them before its own fetch lands. */
const rosterStatus = new Map();    // Sleeper id -> { inj, part, newsAt }
const statusAskedAt = new Map();   // team id -> when its roster was last asked for
const STATUS_EVERY_MS = 3 * 60e3;
let statusPending = null;
function fetchRosterStatus(t) {
  if (!t || FIXTURE || statusPending) return;
  if (Date.now() - (statusAskedAt.get(t.id) || 0) < STATUS_EVERY_MS) return;
  const sids = [...new Set([...t.starters, ...(t.bench || [])].map((p) => p.sid).filter(Boolean))].map((id) => String(id).replace(/[^A-Za-z0-9]/g, ""));
  if (!sids.length) return;
  statusAskedAt.set(t.id, Date.now());
  const q = "{" + sids.map((id) =>
    `p${id}:get_player(sport:"nfl",player_id:"${id}"){injury_status injury_body_part} n${id}:get_player_news(sport:"nfl",player_id:"${id}",limit:1){published source}`).join(" ") + "}";
  statusPending = sleeperGql(q).then((d) => {
    for (const id of sids) {
      const inj = d[`p${id}`] || {}, n = (d[`n${id}`] || [])[0];
      rosterStatus.set(id, { inj: inj.injury_status || null, part: inj.injury_body_part || null, newsAt: n ? newsItem(n).at : 0 });
    }
    rerenderSoon();   // the badges, after the last render's flash and rolls
  }).catch(() => statusAskedAt.delete(t.id)).finally(() => { statusPending = null; });
}

// The board's statuses: every live starter's injury status, so a franchise
// whose man was ruled out mid-game does not read him as "on now". One
// batched query for the starters whose games are on (no news: the open
// team's own fetch brings that), every few minutes while any is.
let boardStatusAt = 0, boardStatusPending = null;
function fetchBoardStatus() {
  if (FIXTURE || phase !== "live" || boardStatusPending || Date.now() - boardStatusAt < STATUS_EVERY_MS) return;
  const sids = [...new Set(rosters.flatMap((t) => t.starters).filter(isLive).map((p) => p.sid).filter(Boolean))].map((id) => String(id).replace(/[^A-Za-z0-9]/g, ""));
  if (!sids.length) return;
  boardStatusAt = Date.now();
  const q = "{" + sids.map((id) => `p${id}:get_player(sport:"nfl",player_id:"${id}"){injury_status injury_body_part}`).join(" ") + "}";
  boardStatusPending = sleeperGql(q).then((d) => {
    for (const id of sids) {
      const inj = d[`p${id}`] || {}, prev = rosterStatus.get(id);
      rosterStatus.set(id, { newsAt: 0, ...prev, inj: inj.injury_status || null, part: inj.injury_body_part || null });
    }
    rerenderSoon();
  }).catch(() => { boardStatusAt = Date.now() - STATUS_EVERY_MS + 30e3; }).finally(() => { boardStatusPending = null; });   // a failure tries again in 30s
}

function closePlayer(instant = false, pop = true) {   // pop: take the card's history entry back too (a back press already has)
  if (pcard.dataset.open !== "true") return;
  if (cardPushed) { cardPushed = false; if (pop) navBack(1); }
  clearTimeout(pcTimer);
  const key = pcKey;
  pcKey = null; pcInjury = null;
  document.body.classList.remove("pcard-open");
  const finish = () => { pcard.dataset.open = "false"; pcSheet.innerHTML = ""; };
  if (instant || reducedMotion.matches) finish();
  else { pcard.dataset.open = "closing"; pcTimer = setTimeout(finish, 260); }
  // Back to the row that opened it (a poll may have rebuilt it: find it by key).
  const back = pcFocus?.isConnected ? pcFocus : rosterEl.querySelector(`[data-pk="${CSS.escape(key)}"]`);
  pcFocus = null;
  back?.focus({ preventScroll: true });
}

/* Swipe down to close, on the phone sheet (2026-09-10). A finger
   dragging down from the band, or from the body while it is scrolled to
   the top, carries the sheet with it and dims the scrim in step (the drag
   scrubs a paused Web Animation on each: the entrance's fill would
   override an inline transform); let go past a third of the sheet, or
   with a flick, and it slides the rest of the way and closes; short of
   that it springs back. A drag that starts upward, or in a scrolled
   body, is a scroll and is left alone. */
const phoneSheet = matchMedia("(max-width: 599px)");
const pcScrim = document.getElementById("pc-scrim");
const SWIPE_CLOSE = 1 / 3, SWIPE_FLICK = 0.6;   // of the sheet's height; px per ms
let swipe = null;
pcSheet.addEventListener("touchstart", (e) => {
  swipe = null;
  if (!phoneSheet.matches || pcard.dataset.open !== "true" || e.touches.length !== 1) return;
  const body = pcSheet.querySelector(".pc-body");
  const inBody = body && body.contains(e.target);
  const y = e.touches[0].clientY, t = performance.now();
  swipe = { y0: y, y, t, vy: 0, dy: 0, dragging: false, canDrag: !inBody || body.scrollTop <= 0 };
}, { passive: true });
pcSheet.addEventListener("touchmove", (e) => {
  if (!swipe) return;
  const y = e.touches[0].clientY, t = performance.now();
  const dy = y - swipe.y0;
  if (!swipe.dragging) {
    if (dy < -8 || (!swipe.canDrag && Math.abs(dy) > 8)) { swipe = null; return; }   // a scroll
    if (dy < 8) return;
    swipe.dragging = true;
    swipe.sheet = pcSheet.animate([{ transform: "translateY(0)" }, { transform: "translateY(1000px)" }], { duration: 1000, fill: "both" });
    swipe.scrim = pcScrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1000, fill: "both" });
    swipe.sheet.pause(); swipe.scrim.pause();
  }
  if (e.cancelable) e.preventDefault();
  if (t > swipe.t) swipe.vy = (y - swipe.y) / (t - swipe.t);
  swipe.y = y; swipe.t = t;
  swipe.dy = Math.max(0, dy);
  swipe.sheet.currentTime = swipe.dy;
  swipe.scrim.currentTime = Math.min(1000, (swipe.dy / pcSheet.offsetHeight) * 1000);
}, { passive: false });
const endSwipe = () => {
  const sw = swipe; swipe = null;
  if (!sw?.dragging) return;
  const h = pcSheet.offsetHeight;
  sw.sheet.cancel(); sw.scrim.cancel();
  const from = { transform: `translateY(${sw.dy}px)` }, dim = Math.max(0, 1 - sw.dy / h);
  if (sw.dy > h * SWIPE_CLOSE || sw.vy > SWIPE_FLICK) {
    const ms = Math.max(120, 260 * (1 - sw.dy / h));
    const a = pcSheet.animate([from, { transform: "translateY(100%)" }], { duration: ms, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" });
    const b = pcScrim.animate([{ opacity: dim }, { opacity: 0 }], { duration: ms, fill: "forwards" });
    let done = false;
    const finish = () => { if (done) return; done = true; closePlayer(true); a.cancel(); b.cancel(); };   // cancelled so nothing lingers on the next open
    a.onfinish = finish;
    setTimeout(finish, ms + 60);   // a backgrounded tab never finishes an animation
  } else {
    pcSheet.animate([from, { transform: "none" }], { duration: 280, easing: "cubic-bezier(.22, 1, .36, 1)" });
    pcScrim.animate([{ opacity: dim }, { opacity: 1 }], { duration: 280 });
  }
};
pcSheet.addEventListener("touchend", endSwipe);
pcSheet.addEventListener("touchcancel", endSwipe);

rosterEl.addEventListener("click", (e) => {
  const row = e.target.closest(".prow");
  if (row) openPlayer(row.dataset.pk, row);
});
rosterEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const row = e.target.closest(".prow");
  if (!row) return;
  e.preventDefault();   // Space would scroll the roster
  openPlayer(row.dataset.pk, row);
});
pcard.addEventListener("click", (e) => {
  if (e.target.closest("#pc-close") || e.target.id === "pc-scrim") { closePlayer(); return; }
  const tab = e.target.closest(".pc-tabs .tab");
  if (!tab) return;
  pcPanel = tab.dataset.panel;
  pcSheet.querySelector(".pc-body").dataset.panel = pcPanel;
  for (const b of pcSheet.querySelectorAll(".pc-tabs .tab")) b.setAttribute("aria-selected", String(b === tab));
});
// Once a row's swing has settled, drop .enter: its will-change and
// backface-visibility keep the row on its own compositor layer, and in
// Safari text painted inside such a layer later went unpainted.
rosterEl.addEventListener("animationend", (e) => {
  if (e.animationName !== "fflr-sway") return;
  e.target.classList.remove("enter");
  e.target.style.removeProperty("--i");
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (witch.dataset.open === "true") endWitchingHour();
  else if (tdModal.dataset.open === "true") dismissTouchdown();
  else if (pcard.dataset.open === "true") closePlayer();
  else if (page.dataset.open === "true") closeTeam();
});

/* ---------------- touchdown announcements ----------------
   One card at a time, TD_MS each, queued in arrival order so two scores
   in the same poll both get their moment. ESPN's play is what raises one
   (playTouchdowns; CLAUDE.md, "Every touchdown ... is worth 6"). */

const TD_MS = 4000;
const TD_CHI_MS = 5500;   // the Bears card holds longer: the chant needs its moment
// The card wears the scorer's team colours: a dark ground and a bright
// accent per team, keyed by MFL's codes. Literal on purpose (they are the
// team's, not the theme's) and the same in both themes, like the Bears
// card always was. Grounds are the team's darker colour so white text
// reads on them; where a team's brighter colour is too dull to glow (the
// Ravens' and Giants' metallic gold and red) it is lifted a shade.
const TEAM_COLORS = {
  ARI: ["#97233f", "#ffb612"], ATL: ["#141414", "#a71930"], BAL: ["#241773", "#c9a227"],
  BUF: ["#00338d", "#c60c30"], CAR: ["#101820", "#0085ca"], CHI: ["#0b162a", "#c83803"],
  CIN: ["#151515", "#fb4f14"], CLE: ["#311d00", "#ff3c00"], DAL: ["#041e42", "#b0b7bc"],
  DEN: ["#002244", "#fb4f14"], DET: ["#0076b6", "#c9cfd3"], GBP: ["#203731", "#ffb612"],
  HOU: ["#03202f", "#c41e3a"], IND: ["#002c5f", "#dde3e6"], JAC: ["#006778", "#d7a22a"],
  KCC: ["#e31837", "#ffb81c"], LVR: ["#111111", "#c4cacd"], LAC: ["#0080c6", "#ffc20e"],
  LAR: ["#003594", "#ffa300"], MIA: ["#008e97", "#fc4c02"], MIN: ["#4f2683", "#ffc62f"],
  NEP: ["#002244", "#c60c30"], NOS: ["#101820", "#d3bc8d"], NYG: ["#0b2265", "#c41e3a"],
  NYJ: ["#125740", "#e8edea"], PHI: ["#004c54", "#c9cfd3"], PIT: ["#101820", "#ffb612"],
  SFO: ["#aa0000", "#b3995d"], SEA: ["#002244", "#69be28"], TBB: ["#34302b", "#d50a0a"],
  TEN: ["#0c2340", "#4b92db"], WAS: ["#5a1414", "#ffb612"],
};
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
  const over = Boolean(ev.overturned);
  const ms = over ? TD_MS : p.tm === "CHI" ? TD_CHI_MS : TD_MS;
  tdCard.style.setProperty("--td-ms", `${ms}ms`);
  const colors = TEAM_COLORS[p.tm];   // a free agent's card keeps the theme's own
  tdModal.classList.toggle("td-team", Boolean(colors));
  tdModal.classList.toggle("td-chi", p.tm === "CHI" && !over);
  tdModal.classList.toggle("td-over", over);   // overturned on review: the same card, muted, the points struck
  tdModal.style.setProperty("--td-ground", colors ? colors[0] : "");
  tdModal.style.setProperty("--td-accent", colors ? colors[1] : "");
  tdCard.innerHTML =
    `<span class="td-rays" aria-hidden="true"></span>` +
    `<span class="td-flash" aria-hidden="true"></span>` +
    `<span class="td-more" id="td-more" hidden></span>` +
    `<span class="td-word">${over ? "Overturned" : "Touchdown"}</span>` +
    (over ? `<span class="td-review">No touchdown on review</span>` : "") +
    (p.tm === "CHI" && !over ? chant("Bear down!") : "") +
    `<span class="td-face">${bigShot(p)}${teamLogo(p.tm)}</span>` +
    `<span class="td-name">${esc(p.n)}</span>` +
    `<span class="td-meta"><span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span><span>${esc(p.tm)}</span></span>` +
    `<span class="td-for"><i>for</i><b>${esc(ev.franchise)}</b></span>` +
    (over ? `<span class="td-pts"><s>+${fmt(ev.pts)}</s></span>` : `<span class="td-pts">+${fmt(ev.pts)}</span>`) +
    `<span class="td-bar" aria-hidden="true"></span>`;
  renderTdMore();
  tdModal.dataset.open = "true";
  clearTimeout(tdTimer);
  tdTimer = setTimeout(dismissTouchdown, ms);
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

// No demo bar on main: ?td=<NFL team> raises a card for that team's first
// starter on the board once it is up (any starter when the team has
// none), for checking the team colours.
function checkTouchdown(tm) {
  const all = teams.flatMap((t) => t.starters.map((p) => ({ p, t })));
  const hit = all.find((x) => x.p.tm === tm) || all[0];
  if (hit) announceTouchdown({ player: hit.p, franchise: hit.t.team, pts: 8.5, starter: true });
}

/* ---------------- The Witching Hour ----------------
   NFL RedZone's 2:30 PM Central moment: the early games reach their
   fourth quarters at once, and Scott Hanson calls it. Every Sunday at
   that time the board gives way to a ten-second full-screen take on the
   RedZone graphic, in three cuts (a tilted close-up with the hands
   racing, the clock upright as they settle on 2:30, then WITCHING HOUR
   stacked over the clock on a neon-lit wall), then fades back. Only Escape skips it. */

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
// No click-to-skip: a stray tap on a full-screen takeover is far likelier
// than a wish to skip it (2026-09-08). Escape (above) is the deliberate way
// out; the touchdown card keeps its tap-to-skip.
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

const themeMeta = document.querySelector('meta[name="theme-color"]');
function syncTheme() {
  const now = effective();
  segBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === now)));
  // The installed app's status bar follows the canvas of the theme in use.
  if (themeMeta) themeMeta.content = getComputedStyle(root).getPropertyValue("--canvas").trim() || "#060a11";
}
segBtns.forEach((b) => b.addEventListener("click", () => {
  root.dataset.theme = b.dataset.theme;
  try { localStorage.setItem(THEME_KEY, b.dataset.theme); } catch {}
  syncTheme();
}));
syncTheme();

/* ---------------- holidays ----------------
   Thanksgiving and Christmas have games this season (2026-09-12), and
   the page wears each day's colours: data-holiday on the root, a token
   layer over both themes at the end of styles.css. The day is the NFL's,
   Eastern, like the spotlight's days (a Karachi manager watches the
   Thanksgiving games on Friday morning); checked at load, every minute
   and when the tab is shown, so a page left open through midnight
   changes with the day. Thanksgiving is November's fourth Thursday. */

const HOLIDAYS = ["thanksgiving", "christmas"];
const HOLIDAY_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", weekday: "short" });
// Christmas: a light snowfall over the page, built while the holiday is
// on and emptied otherwise (see styles.css, "Christmas snowfall"). Every
// flake gets its own lane, size, weight, fall time and sway; negative
// delays so the sky is already full when it first shows.
const snowEl = document.getElementById("snow");
function snowOn(on) {
  if (!on) { snowEl.innerHTML = ""; return; }
  if (snowEl.childElementCount) return;
  const r = (a, b) => a + Math.random() * (b - a);
  snowEl.innerHTML = Array.from({ length: 48 }, () =>
    `<span class="flake" style="--x:${r(0, 100).toFixed(1)}%;--s:${r(2, 5).toFixed(1)}px;--o:${r(.35, .85).toFixed(2)};--d:${r(9, 20).toFixed(1)}s;--delay:${r(-20, 0).toFixed(1)}s;--sway:${r(8, 30).toFixed(0)}px;--sd:${r(2.5, 5).toFixed(1)}s"><i></i></span>`).join("");
}
function holidayOn(ms = Date.now()) {
  const p = Object.fromEntries(HOLIDAY_DATE.formatToParts(ms).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  const m = Number(p.month), d = Number(p.day);
  if (m === 12 && d === 25) return "christmas";
  if (m === 11 && p.weekday === "Thu" && d >= 22 && d <= 28) return "thanksgiving";
  return null;
}
// ?holiday=thanksgiving|christmas forces one for checking.
const holidayForced = HOLIDAYS.includes(QUERY.get("holiday")) ? QUERY.get("holiday") : null;
function syncHoliday() {
  const h = holidayForced || holidayOn();
  if (h) root.dataset.holiday = h; else delete root.dataset.holiday;
  snowOn(h === "christmas");
  // A turkey or a snowman beside the WEEK title, on the trophy's swing.
  const em = document.getElementById("week-holiday");
  em.textContent = { thanksgiving: "\u{1F983}", christmas: "\u26C4" }[h] || "";
  em.hidden = !h;
  syncTheme();   // the status bar follows the holiday's canvas
}
syncHoliday();
setInterval(syncHoliday, 60e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden) syncHoliday(); });

/* ---------------- loading the data ---------------- */

const toArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const SLEEPER_TEAM = { SFO: "sf", NEP: "ne", GBP: "gb", KCC: "kc", TBB: "tb", NOS: "no", LVR: "lv", JAC: "jax" };
const sleeperTeam = (tm) => SLEEPER_TEAM[tm] || String(tm).toLowerCase();

async function api(type, params = {}, timeoutMs = 0) {
  const u = new URL("api/mfl", location.href);
  u.searchParams.set("type", type);
  for (const [k, v] of Object.entries(params)) if (v !== "" && v != null) u.searchParams.set(k, v);
  const res = await fetch(u, { cache: "no-store", signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined });
  if (!res.ok) throw new Error(`${type}: HTTP ${res.status}`);
  const json = await res.json();   // { ok: true, data } | { ok: false, error }
  if (json.season) SEASON = Number(json.season);
  return json;
}

// The fixture: data.js is loaded only when needed (it is 2.2MB of base64).
// In the bundle it is inlined ahead of this script and MFL_FIXTURE is set.
function loadFixture() {
  FIXTURE = true;
  const apply = () => {
    rosters = ROSTERS;
    headshotSrc = (p) => (p.sid && HEADSHOTS[p.sid]) || null;
    logoSrc = (tm) => LOGOS[tm] || null;
    WEEK = 12; SEASON = 2025; UPDATED = "4:12 PM"; phase = "live";
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
// Kickoffs do not move, but the schedule also carries each game's score,
// possession and red zone (the game strip, the RZ markers), so while a
// game is on it comes with every poll; otherwise every five minutes.
const SCHEDULE_EVERY = 5 * 60e3;
const gamesOn = () => [...games.values()].some((g) => g.kickoff <= Date.now() && g.secs > 0);
// Stat lines: Sleeper's live stats through the proxy, keyed by Sleeper id,
// refreshed once a minute in season. Context beside MFL's number, never a
// score. The fetch runs beside the poll, never in its path: it has its
// own timeout, a failure keeps the last lines, and when fresh lines land
// they are applied to the current rosters and the board re-renders. Lines
// more than five minutes old are marked delayed (and dimmed); lines that
// never arrived while games are on are marked unavailable.
let statsBySid = {};
let statsAt = 0;           // when lines last arrived
let statsFailed = false;   // a fetch has failed since the last success
let statsPending = null;
const STATS_TIMEOUT_MS = 8000, STATS_STALE_MS = 5 * 60e3;
const statsEvery = () => (gamesOn() ? 0 : 60e3);   // every poll while games are on: a touchdown's card should land within one

const applyStats = () => {
  for (const t of rosters) for (const p of [...t.starters, ...t.bench]) p.st = (p.sid && statsBySid[p.sid]) || {};
};
// Re-render from beside the poll once the last render's flash and rolls
// (.9s) have played out, not over them. A poll in flight picks the new
// data up itself.
function rerenderSoon() {
  const wait = Math.max(0, 1000 - (performance.now() - renderedAt));
  setTimeout(() => { if (!polling && teams.length) { derive(); render(); } }, wait);
}

// The live game situations (ESPN, through the proxy's `situation` type,
// held 15s there): who has the ball, the ball spot, down and distance and
// the red zone, for every game on. Fetched with every poll while games
// are on, beside it, never in its path; a failure keeps the last one, and
// after two minutes without a fresh one (sitOf) the page falls back to
// MFL's schedule flags. Context only: nothing here touches a score.
let situationPending = null;
function fetchSituation() {
  if (situationPending) return;
  situationPending = api("situation", {}, 6000)
    .then(applySituationBody)
    .catch((e) => console.warn("game situations unavailable, keeping the last ones:", e))
    .finally(() => { situationPending = null; });
}
function applySituationBody(r) {
  if (!r.ok) { if (!r.pending) console.warn("game situations unavailable, keeping the last ones:", r.error); return; }
  // An older copy than the one on the page (another function instance's
  // cache, or an edge's, answering this tick) is dropped: laid over a newer
  // one it put the game's previous play back, and the play after it read as
  // new again (Goff's touchdown card twice, 2026-09-17).
  if (r.data.at && r.data.at < situationFetchedAt) return;
  situationFetchedAt = r.data.at || situationFetchedAt;
  situations = new Map(Object.entries(r.data.games || {}));
  situationPrevAt = situationAt;
  situationAt = Date.now();
  overlaySituations();
  if (phase === "live" && !FIXTURE) playTouchdowns();   // a play ending in TOUCHDOWN raises the card first
  if (!polling && teams.length) rerenderSoon();
}

function fetchStats(week) {
  if (statsPending) return;
  statsPending = api("stats", { W: String(week) }, STATS_TIMEOUT_MS)
    .then((st) => {
      if (!st.ok) throw new Error(st.error);
      const next = st.data.stats || {};
      applyStatsBody(st);
    })
    .catch((e) => { statsFailed = true; console.warn("stat lines unavailable, keeping the last ones:", e); })
    .finally(() => { statsPending = null; });
}
// The lines landing, from beside the poll or inside a tick: the touchdown
// check first (a line's new touchdown raises the card before the poll's
// jump can, so the jump is matched to it), then every roster row's `st`.
// A part the proxy marked pending (Sleeper still answering when the tick
// went out) is not a failure: the next tick carries it.
function applyStatsBody(st) {
  if (!st.ok) {
    if (!st.pending) { statsFailed = true; console.warn("stat lines unavailable, keeping the last ones:", st.error); }
    return;
  }
  const next = st.data.stats || {};
  if (JSON.stringify(next) !== JSON.stringify(statsBySid)) stampUpdated();
  statsBySid = next;
  statsAt = Date.now();
  statsFailed = false;
  applyStats();
  if (!polling && teams.length) rerenderSoon();
}
// "" while fine; otherwise the word for the subhead. Only while games are
// on: final lines cannot go stale.
const statsNote = () => {
  if (phase !== "live" || slate.sunFinal || FIXTURE) return "";
  if (statsAt === 0) return statsFailed ? "stats unavailable" : "";
  return Date.now() - statsAt > STATS_STALE_MS ? "stats delayed" : "";
};

/* Touchdowns: ESPN's play is the only signal (2026-09-17, Shakeel's call
   after a second night of doubled cards). A play in a live game ending in
   TOUCHDOWN raises the card within a poll of the whistle, for the ball
   carrier and, on a pass with no turnover, the passer too, with the play's
   value under the league's rules (the yards it names through
   app/scoring.js) as the points. Sleeper's line and MFL's 6-point jump
   raised cards too, from 2026-09-08 and 2026-09-10, matched against each
   other and the play by per-player counts and time windows; each pairing
   that fell outside its window (a line ahead of the play, a jump past its
   three minutes, a snapshot flapping back) raised the same touchdown
   twice, so they raise nothing now. A touchdown ESPN's scoreboard never
   shows as a game's last play (two plays inside one poll) gets no card;
   the board's number is unaffected either way.
   A card is raised once per play: every play id a game has shown is
   remembered, a play re-posted under a new id with the same text is the
   same play, and a player's card holds off another for TD_COOLDOWN_MS (no
   one scores twice inside two minutes of the clock on the wall). The
   first play after a page load or a gap of two minutes only primes the
   memory: it may be old. A play marked NULLIFIED, REVERSED, NO PLAY or a
   two-point try is not a touchdown. Nothing here feeds a score. */
const TD_WINDOW_MS = 3 * 60e3;   // a reversal posted as its own entry this soon after the play overturns it
const TD_COOLDOWN_MS = 2 * 60e3;
const TD_PLAY_FRESH_MS = 2 * 60e3;   // a play raises a card only when the previous situation is this recent
const tdLastAt = new Map();      // "fid:pid" -> when his last card was raised
const tdPlayTexts = new Set();   // "away@home|text" of every touchdown play handled
const tdKey = (t, p) => `${t.id}:${p.id}`;
// On every situation arrival: a new play ending in TOUCHDOWN names its
// scorer(s) among the league's starters on either side. The ball carrier
// is the starter the play names last; on a pass with no turnover the
// passer scores too. The play's value comes from the yards it names.
const playSeen = new Map();   // "away@home" -> the last play handled: { id, text, at, raised: [{ t, p, pts }], ids }
const PLAY_IDS_KEPT = 200;   // a game has ~180 plays
let situationPrevAt = 0;
const playPoints = (role, yds) => r2(Scoring.scoreLine(
  role === "pass" ? { pass_td: 1, pass_yd: yds, pass_cmp: 1, pass_att: 1 }
  : role === "rec" ? { rec_td: 1, rec_yd: yds, rec: 1, rec_tgt: 1 }
  : role === "rush" ? { rush_td: 1, rush_yd: yds, rush_att: 1 }
  : role === "kr" ? { kr_td: 1, kr_yd: yds }
  : role === "pr" ? { pr_td: 1, pr_yd: yds }
  : { idp_def_td: 1 }));
function tdFromPlay(t, p, pts) {
  const key = tdKey(t, p), last = tdLastAt.get(key);
  if (last && Date.now() - last < TD_COOLDOWN_MS) return false;   // this touchdown's card is up already
  tdLastAt.set(key, Date.now());
  announceTouchdown({ player: p, franchise: t.team, pts, est: true, starter: true });
  return true;
}
// Overturned on review (2026-09-15): the card read the ruling on the
// field, and the booth reversed it. Every card the play raised gets a
// muted "Overturned" card, and the touchdown comes back out of the
// bookkeeping so the player's next one still counts. ESPN revises the
// play's own text in place ("... TOUCHDOWN. The Replay Official reviewed
// the ... ruling, and the play was REVERSED. ..."), and a reversal posted
// as its own entry within the window, naming one of the scorers and not
// a try, counts too. The board's points were never the play's.
function overturn(seen) {
  for (const { t, p, pts } of seen.raised) {
    tdLastAt.delete(tdKey(t, p));   // his next touchdown counts
    announceTouchdown({ player: p, franchise: t.team, pts, overturned: true, starter: true });
  }
  seen.raised = [];
}
/* A play is judged once the page has been polling steadily: the newest
   play on a load, or after a gap, may be minutes old. That gate used to
   DROP the play, and the drop was permanent — it went into `ids` and was
   never looked at again, so a touchdown still on the field fifteen
   seconds later never raised its card. It is the case a phone meets every
   time: the tab stops polling while the screen is off, it polls once on
   being shown, and the play it swallows is the touchdown the viewer has
   just watched (Tuten and McBride, 2026-09-20; a page load swallows one
   the same way, since the first arrival has no previous one to measure
   against). So an unjudged play is held over instead, and the next
   arrival that still finds it on the field judges it — within
   TD_HOLD_MS of the first sighting, and never at a break, so nothing
   genuinely old comes through. */
const TD_HOLD_MS = 90e3;
const atABreak = (g) => /halftime|end of|delay|suspended/i.test(String(g.detail || ""));
function playTouchdowns() {
  const fresh = situationPrevAt > 0 && Date.now() - situationPrevAt < TD_PLAY_FRESH_MS;
  for (const g of new Set(situations.values())) {
    const id = g.playId || g.lastPlay;
    if (!id || !sameGame(g.home, g)) continue;   // another week's game says nothing about this one
    const gk = `${g.away}@${g.home}`, text = String(g.lastPlay || "");
    const prev = playSeen.get(gk);
    if (prev && prev.id === id) {
      if (prev.text !== text) { prev.text = text; if (/REVERSED/i.test(text) && prev.raised.length) overturn(prev); }
      // Held over from a load or a gap: the play is still the one on the
      // field, so it was current after all.
      if (!prev.judged && fresh && Date.now() - prev.at < TD_HOLD_MS && !atABreak(g)) judgePlay(g, gk, prev);
      continue;
    }
    // Every play the game has shown is remembered, not just the last: a
    // play that comes round again (ESPN or a cache flapping back to an
    // older snapshot, then forward) is not news, and a touchdown raises its
    // card once however many times it reappears.
    if (prev?.ids.has(id)) continue;
    const ids = prev?.ids || new Set();
    ids.add(id);
    if (ids.size > PLAY_IDS_KEPT) ids.delete(ids.values().next().value);
    const seen = { id, text, at: Date.now(), raised: [], ids, judged: false };
    playSeen.set(gk, seen);
    if (/REVERSED/i.test(text) && prev?.raised.length && Date.now() - prev.at < TD_WINDOW_MS
      && !/TWO-POINT|extra point/i.test(text) && prev.raised.some((r) => playNames(text, r.p))) overturn(prev);
    if (fresh) judgePlay(g, gk, seen);
  }
}

// One play, weighed once: does it end in a touchdown by one of the
// league's starters, and whose card is it? Sets `judged` so a play held
// over for freshness is never weighed twice.
function judgePlay(g, gk, seen) {
  seen.judged = true;
  const text = seen.text;
  if (g.state !== "in" || !/TOUCHDOWN/.test(text)) return;
  // The play's text carries the try after the score ("... TOUCHDOWN.
  // TWO-POINT CONVERSION ATTEMPT. ..."; seen on a 2024 game), so a try
  // only rules the play out when it comes BEFORE the touchdown, i.e. it
  // is the play. Nullified, reversed and no-play can sit anywhere.
  const head = text.slice(0, text.search(/TOUCHDOWN/));
  if (/NULLIFIED|REVERSED|NO PLAY/i.test(text) || /TWO-POINT/i.test(head)) return;
  const passAt = head.search(/\bpass\b/i), turnover = /INTERCEPT|FUMBLE|RECOVER|LATERAL/i.test(head);
  const yds = Number(([...head.matchAll(/for (\d+) yards?/g)].pop() || [])[1]) || 0;
  // The same play re-posted under a new id is the same touchdown.
  const sig = `${gk}|${head.replace(/^\([^)]*\)\s*/, "").trim()}`;
  if (tdPlayTexts.has(sig)) return;
  tdPlayTexts.add(sig);
  const named = [];
  for (const t of rosters) for (const p of t.starters) if (p.tm === g.away || p.tm === g.home) { const at = nameAt(head, p); if (at >= 0) named.push({ t, p, at }); }
  if (!named.length) return;
  named.sort((a, b) => b.at - a.at);
  const card = (x, role) => { const pts = playPoints(role, yds); if (tdFromPlay(x.t, x.p, pts)) seen.raised.push({ t: x.t, p: x.p, pts }); };
  if (passAt >= 0 && !turnover) {
    const receiver = named.find((x) => x.at > passAt), passer = named.find((x) => x.at < passAt);
    if (receiver) card(receiver, "rec");
    if (passer) card(passer, "pass");
  } else {
    card(named[0], turnover ? "def" : /\bkicks\b/i.test(head) ? "kr" : /\bpunts\b/i.test(head) ? "pr" : "rush");
  }
}
const mkPlayer = (id, pts = 0, secs = null) => {
  const i = playerInfo[id] || {};
  // MFL spells kickers "PK"; the page's positions (and the league's lineup
  // rule) say K. Every defensive position maps to the one IDP colour later.
  const pos = i.pos === "PK" ? "K" : (i.pos || "?");
  return { id, n: i.n || `#${id}`, pos, tm: i.tm || "", pts, sid: i.sid || null, st: (i.sid && statsBySid[i.sid]) || {}, secs };
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
  splashStep(0.55);   // the league is in; the live feed is the last answer
  const fr = toArray(lg.data.league?.franchises?.franchise);
  names = new Map(fr.map((f) => [f.id, f.name]));
  // The export's name carries the year ("INDOMEXPAK 2026"); the kicker names the season itself.
  if (lg.data.league?.name) LEAGUE = String(lg.data.league.name).trim().replace(/\s*\b(19|20)\d{2}\s*$/, "") || LEAGUE;
  icons = new Map(fr.filter((f) => f.icon || f.logo).map((f) => [f.id, f.icon || f.logo]));
  rosterIds = new Map(toArray(rs.data.rosters?.franchise).map((f) => [f.id, toArray(f.player).map((p) => p.id)]));
  headshotSrc = (p) => (p.sid ? `https://sleepercdn.com/content/nfl/players/thumb/${p.sid}.jpg` : null);
  logoSrc = (tm) => (tm ? `https://sleepercdn.com/images/team_logos/nfl/${sleeperTeam(tm)}.png` : null);
  showLoading("Pulling the live feed\u2026");
  await refreshLive(true);
}

// One poll: liveScoring for the week, the schedule, the stat lines and the
// game situations, as one `tick` from the proxy (2026-09-15) naming the
// parts this poll wants, so a 15-second poll while games are on is one
// request and one function invocation, and every viewer in a window gets
// the same snapshot from the edge. Should the fold itself fail, the poll
// goes the old way, each type on its own and the context beside it.
// Returns the set of changed keys for the renderer (team ids and
// `${teamId}:${playerId}`).
async function refreshLive(first = false) {
  const w = QUERY.get("w") || "";
  // The schedule is fetched every few minutes, not every poll: kickoffs do
  // not move, and in season each player's own clock comes with liveScoring.
  const wantSchedule = first || !games.size || gamesOn() || Date.now() - scheduleAt > SCHEDULE_EVERY;
  const wantStats = first || Date.now() - statsAt > statsEvery();
  const wantSituation = first || gamesOn();
  let ls, sch = null, side = null;
  try {
    const parts = ["liveScoring", wantSchedule && "nflSchedule", wantStats && "stats", wantSituation && "situation"].filter(Boolean);
    const t = await api("tick", { W: w, parts: parts.join(",") });
    if (!t.ok || !t.parts?.liveScoring) throw new Error(t.error || "no liveScoring in the tick");
    ({ liveScoring: ls, nflSchedule: sch = null, ...side } = t.parts);
  } catch (e) {
    console.warn("tick failed, polling each type:", e);
    [ls, sch] = await Promise.all([api("liveScoring", { W: w, DETAILS: "1" }), wantSchedule ? api("nflSchedule", { W: w }) : null]);
  }

  if (sch) {
  scheduleAt = Date.now();
  games = new Map();
  let firstKick = null;
  for (const m of toArray(sch.ok ? sch.data.nflSchedule?.matchup : [])) {
    const k = new Date(Number(m.kickoff) * 1000);
    const secs = Number(m.gameSecondsRemaining);
    const [a, b] = toArray(m.team);
    const away = a?.isHome === "1" ? b : a, home = a?.isHome === "1" ? a : b;
    if (!firstKick || k < firstKick) {
      firstKick = k;
      opener = away && home ? `${away.id} at ${home.id}` : "";
    }
    // The game itself (both scores, who has the ball, red zone) for the
    // player card's game strip.
    const side = (t) => ({ id: t.id, score: Number(t.score) || 0, poss: t.hasPossession === "1", rz: t.inRedZone === "1" });
    const match = away && home ? { kickoff: k, away: side(away), home: side(home) } : null;
    for (const t of toArray(m.team)) games.set(t.id, { kickoff: k, secs: Number.isFinite(secs) ? secs : 3600, match });
  }
  overlaySituations();
  kickoff = firstKick;
  // The week's game days, each its own spotlight day. Grouped by the NFL's
  // own date (Eastern), not the viewer's: a Sunday afternoon kickoff is
  // already Monday in Karachi.
  const byDay = new Map();
  for (const [tm, g] of games) {
    const key = ET_DATE.format(g.kickoff);
    if (!byDay.has(key)) byDay.set(key, { key, name: ET_WEEKDAY.format(g.kickoff), kickoff: g.kickoff, teams: new Set() });
    const d = byDay.get(key);
    d.teams.add(tm);
    if (g.kickoff < d.kickoff) d.kickoff = g.kickoff;
  }
  dayTeams.days = [...byDay.values()].sort((a, b) => a.kickoff - b.kickoff);
  dayTeams.early = new Set(dayTeams.days.length > 1 ? dayTeams.days[0].teams : []);
  }
  if (side?.situation) applySituationBody(side.situation);
  else if (!side && wantSituation) fetchSituation();   // the old way, beside the poll

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
  await loadPlayoffs();
  await loadSeason();
  if (side?.stats) applyStatsBody(side.stats);
  else if (!side && wantStats) fetchStats(WEEK);   // the old way, beside the poll, not in it
  const franchises = toArray(L.franchise);
  // "Updated" is when MFL's snapshot last changed, not when we last polled:
  // the export regenerates on MFL's own cycle (~200s on the Week 1 opener)
  // and most polls bring back the same body, so a poll-time stamp read
  // fresh while the scores stood still. Any score or lineup status moving
  // counts; the check time sits beside it once they drift apart.
  const sig = franchises.map((f) => `${f.id}:${f.score}:${toArray(f.players?.player).map((p) => `${p.id}:${p.score}:${p.status}`).join(",")}`).join(";");
  if (sig !== snapshotSig) { snapshotSig = sig; stampUpdated(); }
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
        changed.add(f.id).add(key);   // the row's key, see playerKey
      }
    });
    return team;
  });
  lastScores = next;
  if (duel) for (const id of [...changed]) if (duel.sideOf.has(id)) changed.add(duel.sideOf.get(id).id);
  slate.sunFinal = games.size > 0 && [...games.values()].every((g) => g.secs <= 0);
  // With the feed the week is final once every game is (MFL's own "official"
  // mark is not read; the playoffs already use this rule). The MVP card and
  // the Week winner hero follow, and clear when MFL rolls the week.
  slate.weekFinal = slate.sunFinal;
  return changed;
}

// Playoff weeks: seed and fold the field from the season's franchise
// scores (one small call, held ten minutes by the proxy). The scores are
// refetched when the fold cannot complete, e.g. a page left open from Round
// 1 into the Semifinal has no Week 15 scores yet. If it still cannot, `post`
// stays null and the board shows every franchise, as in the regular season.
// The season so far, for the record chip: every finished week's all-play
// (Playoffs.allPlay over the weeks before this one, regular season only),
// fetched with the week's first poll, again when the week rolls, and every
// half hour in case of stat corrections. Never in the poll's path for long:
// a failure leaves the last table, or none (the week's record alone).
const SEASON_EVERY = 30 * 60e3;
async function loadSeason() {
  if (FIXTURE || WEEK <= 1 || Playoffs.round(WEEK) || WEEK === EXHIBITION.week) { seasonRec = null; return; }
  if (seasonRec && seasonRecWeek === WEEK && Date.now() - seasonAt < SEASON_EVERY) return;
  const ss = await api("seasonScores", {}, 6000).catch((e) => ({ ok: false, error: String(e) }));
  if (!ss.ok) { console.warn("seasonScores:", ss.error); return; }
  seasonScores = ss.data.weeks;
  seasonRec = new Map(Playoffs.allPlay(seasonScores.filter((wk) => Number(wk.week) < WEEK)).map((r) => [r.id, r]));
  seasonRecWeek = WEEK; seasonAt = Date.now();
}

async function loadPlayoffs() {
  post = null; duel = null;
  if (WEEK === EXHIBITION.week) { duel = Playoffs.exhibition(); return; }
  if (!Playoffs.round(WEEK)) return;
  let f = seasonScores && Playoffs.field(seasonScores, WEEK);
  if (!f?.complete) {
    const ss = await api("seasonScores").catch((e) => ({ ok: false, error: String(e) }));
    if (ss.ok) { seasonScores = ss.data.weeks; f = Playoffs.field(seasonScores, WEEK); }
    else console.warn("seasonScores:", ss.error);
  }
  if (f?.complete) {
    f.recordOf = new Map(f.seeds.map((s) => [s.id, s.record]));
    post = f;
  } else {
    console.warn(`Week ${WEEK} is a playoff week but an earlier round's scores are missing; showing every franchise`);
  }
}

/* Polling budget. MFL rate-limits and asks clients to back off, so:
   - in season, liveScoring every 30s (the proxy holds it 15s, so several
     open pages still cost MFL at most four calls a minute);
   - before the season, everything every 5 minutes -- the countdown ticks
     locally and lineups do not change by the second;
   - nothing at all while the tab is hidden; a poll runs as soon as it is
     shown again. */
// Every 15s while a game is on (2026-09-15; 30s before): Sleeper's lines
// and ESPN's situation move within seconds of a play and the proxy holds
// them 15s, so a touchdown's card and the last play land within a poll.
// MFL is still asked every 30s behind it (its window in the proxy), the
// cadence the spike ran with no 429s; its export moves every ~200s anyway.
// 30s in season between games, five minutes before the season.
const POLL_GAME_MS = 15e3, POLL_LIVE_MS = 30e3, POLL_PRESEASON_MS = 5 * 60e3;
let pollTimer = null, polling = false;

const pollEvery = () => (phase !== "live" ? POLL_PRESEASON_MS : gamesOn() ? POLL_GAME_MS : POLL_LIVE_MS);
function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollLive, pollEvery());
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
// The cartoon needed 2.8s to play through once; the splash (2026-09-24,
// mfl-manager's) needs only a beat for its name to be read filling.
const MIN_LOAD_MS = 1200;

// The name fills as the answers come in, as the manager's: a creep on
// time alone toward 70% (MFL can be slow, and a word that sits still reads
// as stuck), a floor raised by each answer that lands (splashStep), full
// when the board is ready. The curtain opens once the fill has caught up,
// so the word is seen whole for a beat.
const spFill = document.getElementById("sp-fill"), spT0 = performance.now();
let spP = 0, spFloor = 0, spRaf = 0, spOpen = null, spGone = false;
function spFrame(now) {
  spRaf = 0;
  if (spGone) return;
  const creep = 0.7 * (1 - Math.exp(-(now - spT0) / 5000));
  const target = Math.max(spFloor, creep);
  spP = reducedMotion.matches ? target : spP + (target - spP) * 0.07;
  spFill.style.setProperty("--p", `${(spP * 100).toFixed(2)}%`);
  if (spOpen && spP > 0.995) { spFill.style.setProperty("--p", "100%"); const go = spOpen; spOpen = null; setTimeout(go, reducedMotion.matches ? 0 : 280); return; }
  spRaf = requestAnimationFrame(spFrame);
}
spRaf = requestAnimationFrame(spFrame);
const splashStep = (p) => { spFloor = Math.max(spFloor, p); };

function showLoading(msg) {
  if (msg) loaderMsg.textContent = msg;
  loader.hidden = false;
}
// Fills the name, parts the curtain, and calls then() as it opens (the
// board cascades in behind it). A tab in the background gets no frames,
// so it opens at once there, and never later than 1.5s after the call.
function hideLoading(then = () => {}) {
  spFloor = 1;
  let opened = false;
  const open = () => {
    if (opened) return; opened = true; spOpen = null; spGone = true;
    loader.classList.add("gone");
    then();
    setTimeout(() => { loader.hidden = true; }, reducedMotion.matches ? 400 : 1300);
  };
  if (document.hidden) return open();
  spOpen = open;
  if (!spRaf) spRaf = requestAnimationFrame(spFrame);
  setTimeout(open, 1500);
}

// Top to bottom: every block on the board, then each standings row and
// divider in order, then the laptop pane.
function cascadeIn() {
  if (reducedMotion.matches) { pickOnLoad(); boardReady(); return; }
  const app = document.getElementById("app");
  const targets = [
    document.querySelector(".layout > .masthead"),
    ...[...document.querySelectorAll(".col-board > *")].flatMap((el) =>
      el.classList.contains("standings") ? [el.querySelector(".standings-head"), ...rowsEl.children] : [el]),
    page,
  ].filter((el) => el && !el.hidden);
  targets.forEach((el, i) => { el.classList.add("cascade"); el.style.setProperty("--i", i); });
  app.classList.add("intro");
  setTimeout(() => {
    app.classList.remove("intro");
    targets.forEach((el) => { el.classList.remove("cascade"); el.style.removeProperty("--i"); });
    pickOnLoad(); boardReady();
  }, targets.length * 55 + 700);
}
// The laptop pane shows the leader from the start; once the board has
// cascaded in, the leader's hero rises to say so. Lifted after the
// cascade, not before it: the cascade animates the same transform, so a
// lift set earlier sat hidden under it and snapped in when the run ended.
function pickOnLoad() {
  if (!desktop.matches || open === null || picked !== null) return;
  picked = open;
  markActive();
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
  if (desktop.matches) openTeam(teams[0].id, false);   // shown, not yet lifted: pickOnLoad() lifts it after the cascade
  await document.fonts.ready;
  const wait = Math.max(0, MIN_LOAD_MS - (performance.now() - loadStart));
  setTimeout(() => hideLoading(() => { cascadeIn(); if (QUERY.has("witch")) playWitchingHour(); if (QUERY.has("td")) checkTouchdown(QUERY.get("td")); }), wait);
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
  // The Top scorer card may be in the laptop's slot inside the pane, which a
  // phone hides: bring it home when the window narrows (2026-09-25; it vanished).
  placeSpot();
  markActive();
});

boot();
