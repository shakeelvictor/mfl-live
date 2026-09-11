// Illustrative mid-slate framing. The fixture is a finished week, so the
// clock, starters yet to play and "on now" are staged to show the board
// in progress. liveScoring supplies the real values (playersYetToPlay,
// gameSecondsRemaining) once the feed is wired.
let WEEK = 12;   // the demo bar's view tags move it into the postseason
let SEASON = 2025;   // the NFL season the mockup is seeded from
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
const LIVE = 3.0;       // close: within three points, the gap pulses (2026-09-09; was 2.5)
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
let gapTiers = [];   // gapTiers[i] is that gap's tier: critical / live / settled, or idle while neither side has begun

/* ---------------- postseason (the demo bar's view tags) ----------------
   The same model as the app on main. In a playoff week `post` holds the
   round's field (playoffs.js: seeds on the Week 1-14 all-play record, then
   the 5 -> 3 -> 4 -> 2 fold); in Week 18 `duel` holds the two sides of
   Pakistan vs. the World. The showcase seeds from the real 2025 season
   (season.js) and folds each earlier round from THIS board's live points,
   so the teams above the cut line in Round 1 are exactly the ones in the
   Semifinal. The fixture's Week 12 points stand in for every round's
   scores. */
let post = null;          // { round, seedOf, recordOf, alive, bye, ... } in Weeks 15-17
let byeTeams = [];        // resting this round (Round 1: the No. 1 seed)
let cutAt = -1;           // gaps[cutAt] is the cut line, under the last advancing rank
let duel = null;          // { sides, sideOf } in Week 18
let duelMembers = [];     // the contributing franchises, for their own pages and the simulator
const ROUNDS = Playoffs.PLAYOFFS.rounds;
const EXHIBITION = Playoffs.EXHIBITION;
const STRIP = [...ROUNDS, { week: EXHIBITION.week, name: EXHIBITION.name }];
const nextRound = () => (post ? ROUNDS[ROUNDS.indexOf(post.round) + 1] || null : null);
// A round is decided once its games are ("End the day" on the demo bar).
const roundFinal = () => (post !== null || duel !== null) && slate.sunFinal;

// The sides' flags, drawn inline (emoji flags are letters on Windows).
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

// All-play record is pure arithmetic on the sorted list. Everything the
// page shows -- ranks, records, gaps, tiers, headline stats -- comes from
// ROSTERS, never from a constant that could disagree with its own rows.
// In a playoff round only the franchises playing it are ranked, the seed
// chip replaces the week's record, and a tie goes to the higher seed. In
// Week 18 the two sides are the teams, each the sum of its members.
function derive() {
  const withLive = (t) => ({
    ...t,
    live: r2(t.pts + (teamBump[t.id] || 0)),
    toPlay: slate.sunFinal ? 0 : (YET_TO_PLAY[t.team] ?? 0),
    onNow: t.starters.some(isLive),
    seed: post ? post.seedOf.get(t.id) : null,
    season: post ? post.recordOf.get(t.id) : null,
  });
  // The fixture has no declared super lineups (every franchise started
  // twelve in Week 12), so each side's is picked here: its managers' best
  // twelve under the lineup rules. A manager's starters become the players
  // he contributed; the rest of his lineup joins his bench. Players keep
  // their franchise keys (k: the index on the franchise), so the simulator
  // and the tweens address them exactly as on the franchise's own page.
  if (duel) {
    const pool = (fr) => fr.starters.map((p, k) => {
      const key = `${fr.id}:${k}`;
      return { ...p, k, key, from: fr.team, fromId: fr.id, pts: r2(p.pts + (playerBump[key] || 0)), st: liveStats[key] || p.st || {} };
    });
    duelMembers = [];
    teams = duel.sides.map((s) => {
      const frs = ROSTERS.filter((t) => s.franchises.includes(t.id));
      const picked = new Set(pickLineup(frs.flatMap(pool)).map((p) => p.key));
      const members = frs.map((fr) => {
        const mine = pool(fr);
        const starters = mine.filter((p) => picked.has(p.key));
        const bench = mine.filter((p) => !picked.has(p.key))
          .concat(fr.bench.map((p, k) => ({ ...p, bk: k, key: `${fr.id}:b${k}`, fromId: fr.id })));
        const base = r2(starters.reduce((a, p) => a + (ROSTERS.find((r) => r.id === fr.id).starters[p.k].pts), 0));
        return {
          ...fr, side: s, starters, bench, pts: base,
          live: r2(starters.reduce((a, p) => a + p.pts, 0)),
          toPlay: starters.filter(isLive).length, onNow: starters.some(isLive),
          seed: null, season: null,
        };
      }).sort((a, b) => b.live - a.live || a.team.localeCompare(b.team));
      duelMembers.push(...members);
      return {
        id: s.id, team: s.name, isSide: true, members,
        pts: r2(members.reduce((a, t) => a + t.pts, 0)),
        live: r2(members.reduce((a, t) => a + t.live, 0)),
        toPlay: members.reduce((a, t) => a + t.toPlay, 0),
        onNow: members.some((t) => t.onNow),
        starters: members.flatMap((t) => t.starters),
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
  teams = (post ? ROSTERS.filter((t) => post.alive.includes(t.id)) : ROSTERS)
    .map(withLive)
    .sort((a, b) => (post ? (b.live - a.live || a.seed - b.seed) : b.live - a.live))
    .map((t, i, arr) => ({
      ...t, rank: i + 1,
      record: post ? `#${t.seed} seed` : `${arr.length - 1 - i}-${i}`,
      through: post ? i < arr.length - post.round.drop : null,
    }));
  gaps = teams.slice(0, -1).map((t, i) => r2(t.live - teams[i + 1].live));
    gapTiers = gaps.map((g, i) => gapTier(g, teams[i], teams[i + 1]));
  n = teams.length;
  cutAt = post ? n - post.round.drop - 1 : -1;
  byeTeams = post ? ROSTERS.filter((t) => post.bye.includes(t.id)).map(withLive).map((t) => ({ ...t, bye: true, record: `#${t.seed} seed` })) : [];
}

// The best twelve from a pool, greedily by points under the league's
// lineup: QB, 2 RB, 3 WR (a TE may take one), TE, K, 3 IDP and a flex
// for anyone but a QB. Good enough for a showcase, not a solver.
function pickLineup(pool) {
  const slots = { QB: 1, RB: 2, WR: 3, TE: 1, K: 1, IDP: 3, FLEX: 1 };
  const fits = (p) => {
    const g = POS_CLASS[p.pos] ? p.pos : "IDP";
    const tries = g === "QB" ? ["QB"] : g === "TE" ? ["TE", "WR", "FLEX"] : [g, "FLEX"];
    return tries.find((sl) => slots[sl] > 0);
  };
  const out = [];
  for (const p of [...pool].sort((a, b) => b.pts - a.pts)) {
    const sl = fits(p);
    if (sl) { slots[sl]--; out.push(p); }
  }
  return out;
}

let n = ROSTERS.length;
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
const TIER_LABEL = { critical: "Coin flip", live: "Close", settled: "Settled", idle: "Not started" };

// Who is on the field for a franchise: its live starters by last name, in
// lineup order, two of them and a count for the rest ("Mahomes, Kelce +3").
// Replaced "N to play · on now" on 2026-09-09 (ported from main).
const lastName = (n) => {
  const w = String(n).trim().split(/\s+/).filter((x) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(x));
  return w[w.length - 1] || String(n);
};
const onNowNames = (t) => {
  const live = t.starters.filter(isLive).sort(byLineup);
  return live.slice(0, 2).map((p) => esc(lastName(p.n))).join(", ") + (live.length > 2 ? ` +${live.length - 2}` : "");
};

const statusOf = (t) => t.bye
  ? `Bye &middot; plays ${nextRound()?.ref || "next week"}`
  // No starters at all: MFL reports playersYetToPlay as 0 for a franchise
  // that never set a lineup, which is not "all played".
  : t.starters.length === 0
    ? (t.side ? "none in the lineup" : "no lineup set")
  : t.toPlay === 0
    ? "all played"
  : t.onNow
    ? `${onNowNames(t)}${rzCount(t) ? ` &middot; <span class="rzn" title="${rzCount(t)} in the red zone">${rzCount(t)} RZ</span>` : " &middot; on now"}`
    : `${t.toPlay} to play`;

/* ---------------- chrome ---------------- */

function renderChrome() {
  // Playoffs: the round's name is the title, "Playoffs · Week 15" above it.
  const kicker = document.getElementById("kicker");
  kicker.hidden = !post && !duel;
  if (post || duel) kicker.innerHTML = duel ? `Week ${WEEK} &middot; Pakistan vs. the World` : `Playoffs &middot; Week ${WEEK}`;
  const title = document.getElementById("week-title");
  title.textContent = duel ? EXHIBITION.name : post ? post.round.name : `Week ${WEEK}`;
  // The Fantasy Bowl: the title's drift turns gold and a trophy sits beside it.
  const bowlTitle = post !== null && Boolean(post.round.bowl);
  title.classList.toggle("bowl", bowlTitle);
  document.getElementById("week-trophy").hidden = !bowlTitle;
  document.getElementById("bowl-bg").classList.toggle("on", bowlTitle);   // the gold clouds behind the board
  document.getElementById("app").classList.toggle("bowl", bowlTitle);     // and the text above and below the title steps up a shade
  document.getElementById("subhead").innerHTML =
    (duel ? `One super lineup a side, $${EXHIBITION.perHead} a head`
      : post ? roundBlurb()
      : "All-play &middot; every team plays every other team") +
    ` &middot; updated ${esc(UPDATED)}`;
  renderRounds();
}

// "Seeds 2–6 play, top 3 advance" / "4 play, top 2 advance" / the Bowl.
function roundBlurb() {
  if (post.round.bowl) return "Higher score takes the title";
  const seeds = teams.map((t) => t.seed);
  const who = byeTeams.length && seeds.length ? `Seeds ${Math.min(...seeds)}&ndash;${Math.max(...seeds)} play` : `${n} play`;
  return `${who}, top ${n - post.round.drop} advance`;
}

// The postseason in a strip: the week on show is marked, finished ones
// are done, later ones wait. (On main the finished ones link to ?w=.)
function renderRounds() {
  const el = document.getElementById("rounds");
  el.hidden = !post && !duel;
  if (el.hidden) return;
  el.innerHTML = STRIP.map((r) => {
    const state = r.week === WEEK ? "now" : r.week < WEEK ? "past" : "next";
    return `<span class="round ${state}"${state === "now" ? ' aria-current="page"' : ""}><span class="rname">${esc(r.name)}</span><span class="rweek">Week ${r.week}</span></span>`;
  }).join(`<span class="rarrow" aria-hidden="true">&rsaquo;</span>`);
}

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
  const caps = document.getElementById("capsules");
  const within = new Set(gaps.flatMap((g, i) => (gapTiers[i] !== "idle" && g < WITHIN ? [i, i + 1] : []))).size;
  const atStake = gaps.filter((g, i) => gapTiers[i] !== "idle" && g < WITHIN).length;
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
  caps.innerHTML =
    `<span class="capsule"><b>${within}</b>within ${WITHIN.toFixed(1)}</span>` +
    `<span class="capsule"><b>${atStake}</b>wins at stake</span>` + left;
}

// A franchise name is one column of the hero and the score is the other. A
// long single word ("WhiskeyDitka" at 30px) is wider than the column and,
// since the column may shrink below it, ran under the score. Step the size
// down until the longest word fits; if it still does not at the floor, give
// the name the full width and drop the score under it (.hero-mid.stack), and
// only past that let the word break. Only measurable while the element is
// displayed, so openTeam() calls it after showing the page. Multi-word names
// wrap and are left at full size.
const NAME_MIN_PX = 24;
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
  const lead = teams[0], chaser = teams[1], lt = gapTiers[0];
  // Playoffs: the round's leader; the Bowl's leader is the champion once
  // the games are done, and only the Bowl gets the gold (the rounds before
  // it pay nothing). Week 18: both sides face to face under their flags.
  const label = duel
    ? (roundFinal() ? "Wins the Pro Bowl" : takeover ? "New leader" : "Leading the Pro Bowl")
    : post
    ? (roundFinal() ? (post.round.bowl ? "Fantasy Bowl champion" : `${post.round.name} &middot; advances`)
      : takeover ? "New leader" : `Leading ${post.round.ref}`)
    : weekIsFinal() ? `Week ${WEEK} winner` : takeover ? "New leader" : `Leading Week ${WEEK}`;
  const gold = duel ? roundFinal() : post ? Boolean(post.round.bowl) && roundFinal() : weekIsFinal();   // a real boolean: toggle(x, undefined) flips
  // Head to head (the Fantasy Bowl, and Pakistan vs. the World): both face
  // to face, the leader bright. The Pro Bowl's sides sit under their flags,
  // the Bowl's finalists under an initial (the mockup has no franchise
  // icons), higher seed on the left.
  const bowl = post !== null && Boolean(post.round.bowl);
  const pair = duel ? duel.sides.map((s) => byId(s.id)) : bowl ? [...teams].sort((a, b) => a.seed - b.seed) : [];
  const crest = (t, i) => duel ? flagOf(duel.sides[i].flag) : `<span class="duel-flag duel-icon" aria-hidden="true">${esc(t.team.trim()[0] || "?")}</span>`;
  const sub = (t) => (duel ? `${t.members.length} managers` : `#${t.seed} seed &middot; ${t.season}`) + (t.toPlay ? ` &middot; ${t.toPlay} to play` : "");
  const mid = duel || bowl
    ? `<div class="duel">` +
        pair.map((t, i) =>
          `<div class="duel-side${t.id === lead.id ? " lead" : ""}">` +
            crest(t, i) +
            `<span class="duel-name">${esc(t.team)}</span>` +
            `<span class="duel-pts${fl(changed, t.id)}" data-tween="pts:${t.id}" data-delta>${fmt(t.live)}</span>` +
            `<span class="duel-sub">${sub(t)}</span>` +
          `</div>`).join(`<span class="duel-v" aria-hidden="true">v</span>`) +
      `</div>`
    : `<div class="hero-mid">` +
        `<div class="hero-id">` +
          `<span class="hero-name">${esc(lead.team)}</span>` +
          `<span class="hero-rec">${post ? `#${lead.seed} seed &middot; ${lead.season}` : `${lead.record} all-play`}</span>` +
        `</div>` +
        `<span class="hero-pts${fl(changed, lead.id)}" data-tween="pts:${lead.id}" data-delta>${fmt(lead.live)}</span>` +
      `</div>`;
  heroBody.innerHTML =
    `<div class="hero-top">` +
      `<span class="micro hero-label"><span class="badge">1</span>${label}</span>` +
      `<span class="hero-status">${statusOf(lead)}</span>` +
    `</div>` + mid +
    `<div class="hero-strip">` +
      (hot(lt) ? `<span class="tier ${lt}">${TIER_LABEL[lt]}</span>` : "") +
      (duel || bowl
        ? `<span class="leads"><b>${esc(lead.team)}</b> ${roundFinal() ? "beat" : "leads"} <b>${esc(chaser.team)}</b> by</span>`
        : `<span class="leads">${roundFinal() ? "Beat" : "Leads"} <b>${esc(chaser.team)}</b> by</span>`) +
      `<span class="hero-gap${changed.has(lead.id) || changed.has(chaser.id) ? " flash" : ""}" data-tween="gap:${lead.id}:${chaser.id}">${fmt(gaps[0])}</span>` +
    `</div>`;
  hero.classList.toggle("winner", gold);
  hero.classList.toggle("bowl", bowl);   // the leading score's iridescent sweep
  document.getElementById("hero-wrap").classList.toggle("winner", gold);
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

  // Pakistan vs. the World: each side, then the managers who filled its
  // lineup and what each contributed, fused under it.
  if (duel) {
    const dot = (t) => (t.onNow ? `<span class="dot"></span>` : "");
    rowsEl.innerHTML = teams.map((t) =>
      `<button class="row side fuse-bottom" type="button" data-id="${t.id}"` +
      ` aria-label="${esc(t.team)}, ${fmt(t.live)} points, ${t.members.length} managers. Open lineup.">` +
        `<span class="rank">${t.rank}</span>` +
        `<span class="who">` +
          `<span class="name">${esc(t.team)}</span>` +
          `<span class="sub"><span class="rec">${t.record}</span><span class="rec">${t.starters.length} players</span>` +
            `<span class="status${t.onNow ? " on" : ""}">${dot(t)}${statusOf(t)}</span></span>` +
        `</span>` +
        `<span class="pts${fl(changed, t.id)}" data-tween="pts:${t.id}" data-delta>${fmt(t.live)}</span>` +
        `<span class="chev" aria-hidden="true">&rsaquo;</span>` +
      `</button>` +
      t.members.map((m, j, arr) =>
        `<button class="row contrib fuse-top${j < arr.length - 1 ? " fuse-bottom" : ""}" type="button" data-id="${m.id}"` +
        ` aria-label="${esc(m.team)}, ${m.starters.length} in the ${esc(t.team)} lineup, ${fmt(m.live)} points. Open lineup.">` +
          `<span class="rank">${esc(m.team.trim()[0] || "?")}</span>` +
          `<span class="who">` +
            `<span class="name">${esc(m.team)}</span>` +
            `<span class="sub"><span class="rec">${m.starters.length} ${m.starters.length === 1 ? "player" : "players"}</span>` +
              `<span class="status${m.onNow ? " on" : ""}">${dot(m)}${statusOf(m)}</span></span>` +
          `</span>` +
          `<span class="pts${fl(changed, m.id)}" data-tween="pts:${m.id}" data-delta>${fmt(m.live)}</span>` +
          `<span class="chev" aria-hidden="true">&rsaquo;</span>` +
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
    const above = gaps[i - 1], below = gaps[i];
    const fuseTop = i > 1 && hot(gapTiers[i - 1]), fuseBottom = hot(gapTiers[i]);

    // Rank circle takes the hotter of the two gaps the row touches.
    const tiers = [gapTiers[i - 1], gapTiers[i]].filter(Boolean);
    const rankTier = tiers.includes("critical") ? "critical" : tiers.includes("live") ? "live" : "";

    // Playoffs: rows under the cut line are "out" and every row says which
    // side of it it is on.
    const out = post !== null && !t.through;
    const rowCls = ["row",
      fuseTop ? "fuse-top" : "", fuseBottom ? "fuse-bottom" : "",
      fuseTop || fuseBottom ? "fused" : "", out ? "out" : ""].filter(Boolean).join(" ");
    const fate = !post ? ""
      : bowl ? (roundFinal() ? (out ? `<span class="fate out">Runner-up</span>` : `<span class="fate in">Champion</span>`) : "")
      : out ? `<span class="fate out">${roundFinal() ? "Eliminated" : "Out"}</span>`
      : `<span class="fate in">${roundFinal() ? "Advances" : "In"}</span>`;

    const row =
      `<button class="${rowCls}" type="button" data-id="${t.id}"` +
      ` aria-label="Rank ${t.rank}, ${esc(t.team)}, ${t.record}, ${fmt(t.live)} points. Open lineup.">` +
        `<span class="rank ${rankTier}">${t.rank}</span>` +
        `<span class="who">` +
          `<span class="name">${esc(t.team)}</span>` +
          `<span class="sub">` +
            `<span class="rec">${t.record}</span>` + fate +
            `<span class="status${t.onNow ? " on" : ""}">` +
              (t.onNow ? `<span class="dot"></span>` : "") + statusOf(t) +
            `</span>` +
          `</span>` +
        `</span>` +
        `<span class="pts${fl(changed, t.id)}" data-tween="pts:${t.id}" data-delta>${fmt(t.live)}</span>` +
        `<span class="chev" aria-hidden="true">&rsaquo;</span>` +
      `</button>`;

    if (below === undefined || bowl) return row;
    const gt = gapTiers[i];
    const cut = i === cutAt;
    // A coin-flip pill flashes when either score beside it moved.
    const pillFlash = gt === "critical" && (changed.has(t.id) || changed.has(teams[i + 1].id));
    return row +
      `<div class="gap ${gt}${cut ? " cut" : ""}" aria-label="${cut ? "Cut line, " : ""}Gap ${fmt(below)}${gt === "critical" ? ", coin flip" : gt === "idle" ? ", neither has played" : ""}">` +
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
      `<span class="who">` +
        `<span class="name">${esc(t.team)}</span>` +
        `<span class="sub"><span class="rec">${t.record}</span><span class="status">${statusOf(t)}</span></span>` +
      `</span>` +
      `<span class="pts">&mdash;</span>` +
      `<span class="chev" aria-hidden="true">&rsaquo;</span>` +
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
// stale numbers for whoever was opened last.
const liveNumberEls = () => [
  ...document.querySelectorAll("#app [data-tween]"),
  ...(open !== null ? page.querySelectorAll("[data-tween]") : []),
  ...(pcKey !== null ? pcSheet.querySelectorAll("[data-tween]") : []),
];

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

let silent = false;   // a view switch: nothing rolls, nothing pops a delta

function render(changed = new Set()) {
  // A member's change is its side's change.
  if (duel) for (const id of [...changed]) if (duel.sideOf.has(id)) changed.add(duel.sideOf.get(id).id);
  renderChrome();
  const shown = silent ? new Map() : snapshotShown();
  const takeover = leaderId !== null && teams[0].id !== leaderId;
  leaderId = teams[0].id;
  renderCapsules();
  renderHero(changed, takeover);
  renderRows(changed);
  renderSpotlight();
  if (open !== null) renderTeam(changed);
  rollNumbers(shown);
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
// The week's "final" treatment lasts until the next week begins. A playoff
// round counts as final once its games are (roundFinal).
const weekIsFinal = () => (slate.weekFinal && !slate.nextWeek) || roundFinal();

const LIVE_NFL = new Map([
  ["JAC", "Q3 8:12"], ["KCC", "Q3 8:12"],   // Jaguars at Chiefs
  ["CHI", "Q4 2:31"], ["MIN", "Q4 2:31"],   // Bears at Vikings
]);
const isLive = (p) => !slate.sunFinal && LIVE_NFL.has(p.tm);
const clockFor = (p) => LIVE_NFL.get(p.tm);

// The NFL slate behind the rows, for the player card's game strip: the
// real 2025 Week 12 finals, re-paired around the two staged live games
// (the Jaguars and Bears are on the field against the Chiefs and Vikings
// here, so their real opponents meet each other). A simulated touchdown
// adds seven to the scorer's side. poss: who has the ball in a live game.
const GAMES = [
  { away: "BUF", home: "HOU", as: 19, hs: 23 }, { away: "NEP", home: "CIN", as: 26, hs: 20 },
  { away: "SEA", home: "TEN", as: 30, hs: 24 }, { away: "IND", home: "ARI", as: 20, hs: 24 },
  { away: "PIT", home: "GBP", as: 28, hs: 23 }, { away: "NYG", home: "DET", as: 27, hs: 34 },
  { away: "NYJ", home: "BAL", as: 10, hs: 23 }, { away: "CLE", home: "LVR", as: 24, hs: 10 },
  { away: "PHI", home: "DAL", as: 21, hs: 24 }, { away: "ATL", home: "NOS", as: 24, hs: 10 },
  { away: "TBB", home: "LAR", as: 7, hs: 34 }, { away: "CAR", home: "SFO", as: 9, hs: 20 },
  { away: "JAC", home: "KCC", as: 17, hs: 20, poss: "KCC" },
  { away: "CHI", home: "MIN", as: 24, hs: 21, poss: "CHI", rz: "CHI" },
];
const GAME_OF = new Map(GAMES.flatMap((g) => [[g.away, g], [g.home, g]]));
// Red zone: an offensive player's own team inside the 20. Live players
// only, not IDP.
const inRedZone = (p) => {
  const g = GAME_OF.get(p.tm);
  return Boolean(g && isLive(p) && POS_CLASS[p.pos] && g.rz === p.tm);
};
// How many of a franchise's starters are in a red-zone situation right now.
const rzCount = (t) => t.starters.filter(inRedZone).length;

const scoreNfl = (tm, by = 7) => { const g = GAME_OF.get(tm); if (g) g[g.home === tm ? "hs" : "as"] += by; };

const liveStats = {};   // `${teamId}:${index}` (bench: `b${index}`) -> mutated copy of st
const slotKey = (t, k, bench) => `${t.id}:${bench ? "b" : ""}${k}`;
// k is always the index on the FRANCHISE's lineup: a Week 18 member's
// lists are re-cut, so its players carry their franchise index (k / bk).
const franchiseOf = (t) => ROSTERS.find((r) => r.id === t.id) || t;
const slotPlayer = (t, k, bench) => (bench ? franchiseOf(t).bench : franchiseOf(t).starters)[k];
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

/* Expanded row: the same line as tiles, every counting stat the line
   folds away (targets, attempts, assists, a lost fumble) laid out, with
   a rate where the volume supports one. Core tiles for the position
   always show (zeros muted) so an empty line still reads as a line; the
   rest only once they count. Context beside MFL's number, as ever.
   Same as app/statTiles on main. */
const rate = (yd, n) => (n > 0 ? (yd / n).toFixed(1) : null);

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

/* The spotlight's entries, oldest first (2026-09-11): Thursday's top
   starter and Sunday's once Sunday is final, and once the week is final
   the MVP of the week last. The newest is the card's own pick and what
   a new day lands on; the arrows by the day pill flip back through the
   earlier days (spotIndex). Nothing while Sunday is in progress, as
   before. */
function spotlightEntries() {
  const all = teams.flatMap((t) => liveStarters(t, new Set()).map((p) => ({ ...p, franchise: p.from || t.team })));
  if (slate.nextWeek || !slate.sunFinal) return [];
  const entry = (pool, label, when, mvp) => {
    if (!pool.length) return null;
    const top = pool.reduce((a, p) => (p.pts > a.pts ? p : a), pool[0]);
    return { top, label, when, mvp, key: `${when}:${top.key}` };
  };
  const out = [entry(all.filter((p) => THU_NFL.has(p.tm)), "Top scorer", "Thursday", false), entry(all.filter((p) => !THU_NFL.has(p.tm)), "Top scorer", "Sunday", false)];
  if (weekIsFinal()) out.push(entry(all,
    post ? `\u2605 MVP of ${post.round.ref}` : duel ? "\u2605 MVP of the Pro Bowl" : "\u2605 MVP of the week",
    `${post ? post.round.name : duel ? EXHIBITION.name : `Week ${WEEK}`} final`, true));
  return out.filter(Boolean);
}
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
  const nav = entries.length > 1
    ? `<span class="spot-nav"><button class="spot-arrow" type="button" data-dir="-1" aria-label="Earlier day"${i === 0 ? " disabled" : ""}>&#8249;</button>` +
      `<span class="spot-when">${esc(when)}</span>` +
      `<button class="spot-arrow" type="button" data-dir="1" aria-label="Later day"${i === entries.length - 1 ? " disabled" : ""}>&#8250;</button></span>`
    : `<span class="spot-when">${esc(when)}</span>`;
  const logo = LOGOS[top.tm] ? `<span class="logo"><img src="${LOGOS[top.tm]}" alt=""></span>` : `<span class="logo">${esc(top.tm)}</span>`;
  spotEl.innerHTML =
    (phaseChanged && newest.mvp && !reducedMotion.matches ? `<span class="spot-flash" aria-hidden="true"></span>` : "") +
    `<div class="spot-top"><span class="micro spot-label">${label}</span>${nav}</div>` +
    `<div class="spot-body"${changed || flip ? "" : ` style="animation:none"`}>` +
      `<span class="spot-face">${avatar(top)}${logo}</span>` +
      `<span class="spot-who">` +
        `<span class="spot-name">${esc(top.n)}</span>` +
        `<span class="spot-meta"><span class="pos ${posClass(top.pos)}">${esc(top.pos)}</span><span>${esc(top.tm)}</span></span>` +
        `<span class="spot-stat">${esc(statLine(top.pos, top.st))}</span>` +
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
spotEl.addEventListener("click", (e) => {
  const b = e.target.closest(".spot-arrow");
  if (!b || b.disabled) return;
  const n = spotlightEntries().length, cur = spotIndex == null ? n - 1 : Math.min(spotIndex, n - 1);
  spotIndex = Math.max(0, Math.min(n - 1, cur + Number(b.dataset.dir)));
  renderSpotlight(true);
  spotEl.querySelector(`.spot-arrow[data-dir="${b.dataset.dir}"]`)?.focus();
});

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
const rosterHtml = (list, bench, isTop) => {
  let last = null;
  return [...list].sort(byLineup).map((p, i) => {
    const g = posGroup(p.pos);
    const sep = g === last ? "" : `<div class="pgroup" data-g="${g}" role="presentation"><span>${g}</span></div>`;
    last = g;
    return sep + playerRow(p, bench, !bench && isTop(p), rosterEnter ? i : -1);
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
const tdCount = (st) => (st ? (st.pass_td || 0) + (st.rush_td || 0) + (st.rec_td || 0) + (st.idp_td || 0) + (st.idp_def_td || 0) + (st.st_td || 0) + (st.kr_td || 0) + (st.pr_td || 0) : 0);
const tdBadge = (st) => { const n = tdCount(st); return n ? `<span class="ptd">${n > 1 ? n + " " : ""}TD</span>` : ""; };

// The player's NFL game across the card's hero: away @ home with
// both scores, the player's own team bright, a football by whoever has
// the ball, RZ when they are in the red zone, and the clock or Final.
const gameStrip = (p) => {
  const g = GAME_OF.get(p.tm);
  if (!g) return "";
  const live = isLive(p);
  const team = (id, score) =>
    `<span class="pg-team${id === p.tm ? " mine" : ""}${live && g.poss === id ? " poss" : ""}">` +
      (LOGOS[id] ? `<img src="${LOGOS[id]}" alt="">` : "") +
      `<span class="pg-id">${esc(id)}</span><b class="pg-score">${score}</b>` +
      (live && g.rz === id ? `<span class="pg-rz">RZ</span>` : "") +
    `</span>`;
  return `<div class="pgame${live ? " live" : ""}">` +
    team(g.away, g.as) + `<span class="pg-at">@</span>` + team(g.home, g.hs) +
    `<span class="pg-state">${live ? `<span class="dot"></span>${clockFor(p)}` : "Final"}</span>` +
  `</div>`;
};

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
const gameBegun = (p) => isLive(p) || !!(p.st && Object.keys(p.st).length);   // the mockup stages every game as on or final
// grow: the bars start empty and are widened after a layout (fillBars), for the log's arrival; only that render transitions.
function cardStatsHtml(p, grow = false) {
  const st = p.st && Object.keys(p.st).length ? p.st : null;
  if (!st) return `<p class="pnone">No stats yet</p>`;
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
const playerRow = (p, bench, top = false, enter = -1) =>
  `<div class="prow${bench ? " bench" : ""}${p.pts === 0 ? " zero" : ""}${isLive(p) ? " live" : ""}${inRedZone(p) ? " rz" : ""}${top ? " top" : ""}${enter >= 0 ? " enter" : ""}"${enter >= 0 ? ` style="--i:${enter}"` : ""}` +
    ` role="button" tabindex="0" aria-haspopup="dialog" data-pk="${esc(p.key)}"${inRedZone(p) ? ` title="In the red zone"` : ""}>` +
    `<span class="pface">${avatar(p)}${logoBadge(p.tm)}${tdBadge(p.st)}</span>` +
    `<span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span>` +
    `<span class="pname"><b><span class="pn">${esc(p.n)}</span>${rowBadges(p)}</b>` +
      `<span class="pmeta">${esc(p.tm)}<span aria-hidden="true">·</span>` +
        (isLive(p) ? `<span class="clock"><span class="dot"></span>${clockFor(p)}</span>` : `<span>Final</span>`) +

        (p.from ? `<span aria-hidden="true">·</span><span class="pfrom">${esc(p.from)}</span>` : "") +
      `</span>` +
      `<span class="pstat">${esc(statLine(p.pos, p.st))}</span>` +
    `</span>` +
    `<span class="pright">` +
      `<span class="ppts${p.pts === 0 ? " zero" : ""}${p.flash ? " flash" : ""}"${p.key ? ` data-tween="p:${p.key}" data-delta` : ""}>${fmt(p.pts)}</span>` +
    `</span>` +
  `</div>`;

const page = document.getElementById("team");
const rosterEl = document.getElementById("roster");
const tabs = [...page.querySelectorAll(".tab")];
let open = null;       // team id
let picked = null;     // the team last opened: its row stays lifted on the board while its page is up
let tab = "starters";
let lastFocus = null;
let teamView = null;   // the open team as last rendered ({ t, starters, bench }): the player card reads from it

// Starters with any live bumps applied, in fixture order.
// A player that already carries a key (Week 18's re-cut lists) is read by
// that key; otherwise by its place on the franchise's lineup.
const liveStarters = (t, changed) => t.starters.map((p, k) => {
  const key = p.key || `${t.id}:${k}`;
  const owner = p.fromId ? { id: p.fromId } : t;   // a side's players belong to their franchises
  const src = p.key ? slotPlayer(owner, p.k, false) : p;
  return { ...p, key, pts: r2(src.pts + (playerBump[key] || 0)), flash: changed.has(key), st: p.key ? (liveStats[key] || src.st || {}) : statsFor(t, k) };
});

const liveBench = (t, changed) => t.bench.map((p, k) => {
  const key = p.key || `${t.id}:b${k}`;
  const bumped = playerBump[key] || benchBump[key] || 0;
  const src = p.key ? slotPlayer(p.fromId ? { id: p.fromId } : t, p.bk ?? p.k, p.bk != null) : p;
  return { ...p, key, pts: r2(src.pts + bumped), flash: changed.has(key), st: p.key ? (liveStats[key] || src.st || {}) : statsFor(t, k, true) };
});

function renderTeam(changed = new Set()) {
  const t = byId(open);
  const starters = liveStarters(t, changed);
  const bench = liveBench(t, changed);
  teamView = { t, starters, bench };
  fetchRosterStatus(t);

  document.getElementById("team-rank").textContent = t.bye ? "Bye" : t.rank ?? t.team.trim()[0];
  document.getElementById("team-week").textContent = duel ? `${EXHIBITION.name} \u00b7 Week ${WEEK}` : post ? `${post.round.name} \u00b7 Week ${WEEK}` : `Week ${WEEK}`;
  document.getElementById("team-status").innerHTML = statusOf(t);
  const nameEl = document.getElementById("team-name");
  nameEl.textContent = t.team;
  fitName(nameEl);   // a no-op while the page is closed; openTeam() fits it once shown
  document.getElementById("team-rec").textContent = post ? `#${t.seed} seed \u00b7 ${t.season} regular season`
    : t.isSide ? `${t.members.length} managers \u00b7 one super lineup`
    : t.side ? `${t.starters.length} in the ${t.side.name} lineup`
    : `${t.record} all-play`;
  const ptsEl = document.getElementById("team-pts");
  ptsEl.textContent = t.bye ? "\u2014" : fmt(t.live);
  ptsEl.dataset.tween = `pts:${t.id}`;
  ptsEl.dataset.delta = "";
  ptsEl.classList.toggle("flash", changed.has(t.id));
  const stEl = document.getElementById("tab-starters-n");
  stEl.textContent = fmt(sum(starters));
  stEl.dataset.tween = `starters:${t.id}`;
  document.getElementById("tab-bench-n").textContent = `${fmt(sum(bench))} behind`;
  document.querySelector('.tab[data-tab="bench"]').hidden = Boolean(t.isSide);   // a side has no bench, only the lineup

  const view = t.isSide ? "starters" : tab;
  const list = view === "bench" ? bench : starters;
  const topPts = Math.max(0, ...starters.map((p) => p.pts));
  const isTop = (p) => !bench.includes(p) && topPts > 0 && p.pts === topPts;
  tabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === view)));
  rosterEl.innerHTML = list.length
    ? rosterHtml(list, view === "bench", isTop)
    : `<p class="empty">No ${view} on this roster.</p>`;
  if (rosterEnter) rosterEl.scrollTop = 0;   // new contents start at the top
  rosterEnter = false;
  markMore();
  refreshPlayerCard();
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
  heroWrap.classList.toggle("sel", teams[0]?.id === picked);
}
addEventListener("resize", () => { if (desktop.matches) markActive(); });

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
tabs.forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; rosterEnter = true; renderTeam(); }));

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
const logNum = (k) => logCol(k.l, (st) => st[k.k] || 0);
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
    ? `<i>${home ? "vs" : "@"}</i>${LOGOS[opp] ? `<img src="${LOGOS[opp]}" alt="">` : ""}${esc(opp)}`
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
// points (rolling) and the game strip.
function pcHeroHtml(p, t) {
  const rs = p.sid && rosterStatus.get(p.sid);
  const inj = pcInjury || (rs ? { injury_status: rs.inj, injury_body_part: rs.part } : null);
  const strip = gameStrip(p) || "<b>Final</b>";
  const team = `<span class="pc-team">${LOGOS[p.tm] ? `<img src="${LOGOS[p.tm]}" alt="">` : ""}${esc(p.tm || "FA")}</span>`;
  return `<div class="pc-hero">` +
    (LOGOS[p.tm] ? `<img class="pc-mark" src="${LOGOS[p.tm]}" alt="" aria-hidden="true">` : "") +
    `<span class="pface pc-face">${avatar(p)}${logoBadge(p.tm)}${tdBadge(p.st)}</span>` +
    `<div class="pc-main">` +
      `<span class="pc-kicker">${esc(p.from || t.team)} · Week ${WEEK}</span>` +
      `<h2 class="pc-name" id="pc-name">${esc(p.n)}</h2>` +
      `<div class="pc-sub">${team}<span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span>` +
        `<span id="pc-inj-slot">${injuryChip(inj)}</span>` +
      `</div>` +
    `</div>` +
    `<div class="pc-vitals">` +
      `<span class="pc-vital"><i>Points</i><b class="pc-pts${p.flash ? " flash" : ""}" data-tween="p:${esc(p.key)}" data-delta>${fmt(p.pts)}</b></span>` +
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
  if (!t || statusPending) return;
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
// Re-render from beside a tick once the last render's flash and rolls
// (.9s) have played out, not over them (main's rerenderSoon).
const rerenderSoon = () => setTimeout(() => { if (teams.length) render(); }, 1000);
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
   in the same poll both get their moment. In the mockup a touchdown is a
   simulated event (below). With the feed wired, MFL exposes only fantasy
   points, so the trigger would be a single starter jumping by a
   touchdown's worth of points between polls. */

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
  const ms = p.tm === "CHI" ? TD_CHI_MS : TD_MS;
  tdCard.style.setProperty("--td-ms", `${ms}ms`);
  const colors = TEAM_COLORS[p.tm];   // a free agent's card keeps the theme's own
  tdModal.classList.toggle("td-team", Boolean(colors));
  tdModal.classList.toggle("td-chi", p.tm === "CHI");
  tdModal.style.setProperty("--td-ground", colors ? colors[0] : "");
  tdModal.style.setProperty("--td-accent", colors ? colors[1] : "");
  tdCard.innerHTML =
    `<span class="td-rays" aria-hidden="true"></span>` +
    `<span class="td-flash" aria-hidden="true"></span>` +
    `<span class="td-more" id="td-more" hidden></span>` +
    `<span class="td-word">Touchdown</span>` +
    (p.tm === "CHI" ? chant("Bear down!") : "") +
    `<span class="td-face">${bigShot(p)}${teamLogo(p.tm)}</span>` +
    `<span class="td-name">${esc(p.n)}</span>` +
    `<span class="td-meta"><span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span><span>${esc(p.tm)}</span></span>` +
    `<span class="td-for"><i>for</i><b>${esc(ev.franchise)}</b></span>` +
    `<span class="td-pts">+${fmt(ev.pts)}</span>` +
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

/* ---------------- The Witching Hour ----------------
   NFL RedZone's 2:30 PM Central moment: the early games reach their
   fourth quarters at once, and Scott Hanson calls it. Every Sunday at
   that time the board gives way to a ten-second full-screen take on the
   RedZone graphic, in three cuts (a tilted close-up with the hands
   racing, the clock upright as they settle on 2:30, then WITCHING HOUR
   stacked over the clock on a neon-lit wall), then fades back. The demo bar fires it on demand; only
   Escape skips it. */

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
document.getElementById("witch-btn").addEventListener("click", playWitchingHour);

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

/* ---------------- simulation (mockup only) ----------------
   Bumps one starter on a team that still has players to play, every few
   seconds, to exercise the live transitions: value flashes, rows sliding
   when ranks swap, clusters re-fusing. Not a feed. */

const simBtn = document.getElementById("sim");
let simTimer = null;

// Only players whose game is on the field can score. Kickers never
// score touchdowns, so they are left out of the TD pool.
// Points land on franchises: in Week 18 the sides are sums of their members.
const scoringTeams = () => (duel ? duelMembers : teams);
const randomStarter = (forTd = false) => {
  const pool = scoringTeams().flatMap((t) => t.starters
    .map((p, k) => ({ t, k: p.k ?? k, p }))
    .filter(({ p }) => isLive(p) && !(forTd && p.pos === "K")));
  return pool[Math.floor(Math.random() * pool.length)];
};

// Six for the score plus a little yardage, announced as a touchdown.
function scoreTouchdown(t, k, changed) {
  const pts = r2(6 + Math.random() * 4);
  bump(t, k, pts);
  bumpStats(t, k, pts, true);
  scoreNfl(slotPlayer(t, k).tm);
  announceTouchdown({ player: slotPlayer(t, k), franchise: t.team, pts, starter: true });
  changed.add(t.id).add(`${t.id}:${k}`);
}

// A bench touchdown: the row in the Bench tab moves, the total does not,
// and the announcement is refused by the rule above.
function scoreBenchTouchdown(t, k, changed) {
  const pts = r2(6 + Math.random() * 4);
  const key = `${t.id}:b${k}`;
  benchBump[key] = r2((benchBump[key] || 0) + pts);
  bumpStats(t, k, pts, true, true);
  scoreNfl(slotPlayer(t, k, true).tm);
  announceTouchdown({ player: slotPlayer(t, k, true), franchise: t.team, pts, starter: false });
  changed.add(key);
}

const randomBench = () => {
  // Week 18 members' benches also hold their unpicked starters; only true
  // bench players (bk) are bench scorers.
  const pool = scoringTeams().flatMap((t) => t.bench.map((p, k) => ({ t, k: p.bk ?? k, p })).filter(({ p }) => isLive(p) && p.pos !== "K" && (!duel || p.bk != null)));
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
  const bears = scoringTeams().flatMap((t) => t.starters.map((p, k) => ({ t, k: p.k ?? k, p })))
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

// Hands #2 exactly enough (plus a little) to pass #1, on one starter. In
// Week 18 the chaser is a side, so one of its managers takes the points.
document.getElementById("flip").addEventListener("click", () => {
  const chaser = teams[1].isSide
    ? (teams[1].members.find((m) => m.starters.some(isLive)) || teams[1].members[0])
    : teams[1];
  const live = chaser.starters.map((p, k) => (isLive(p) ? (p.k ?? k) : -1)).filter((k) => k >= 0);
  const k = live.length ? live[Math.floor(Math.random() * live.length)] : (chaser.starters[Math.floor(Math.random() * chaser.starters.length)].k ?? Math.floor(Math.random() * chaser.starters.length));
  const pts = r2(gaps[0] + 0.5 + Math.random() * 2.5);
  bump(chaser, k, pts);
  bumpStats(chaser, k, pts, pts >= 6);
  derive();
  render(new Set([chaser.id, `${chaser.id}:${k}`]));
});

/* ---------------- the postseason views (demo bar tags) ----------------
   Week 12 is the fixture as it is. Round 1, the Semifinal and the Fantasy
   Bowl seed from the real 2025 season and fold the earlier rounds from
   this board's live points; the Pro Bowl splits the same eleven franchises
   into Pakistan and the World. Switching views is a debut, not a lead
   change (no takeover), and the simulator keeps running on whoever is
   on the field in the new view. */

const REGULAR_WEEK = WEEK;
const viewTags = [...document.querySelectorAll(".devbar [data-view]")];

// Weeks 1-14 as played, then each earlier round scored by this board.
const weeksFor = (week) => SEASON_SCORES.filter((w) => w.week <= Playoffs.PLAYOFFS.regularSeasonWeeks).concat(
  ROUNDS.filter((r) => r.week < week).map((r) => ({ week: r.week, franchise: ROSTERS.map((t) => ({ id: t.id, score: r2(t.pts + (teamBump[t.id] || 0)) })) })));

function setView(week) {
  WEEK = week; post = null; duel = null;
  if (week === EXHIBITION.week) duel = Playoffs.exhibition();
  else if (Playoffs.round(week)) {
    const f = Playoffs.field(weeksFor(week), week);
    f.recordOf = new Map(f.seeds.map((s) => [s.id, s.record]));
    post = f;
  }
  viewTags.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.view) === week)));
  leaderId = null;
  rowsEl.innerHTML = "";   // a new board, not rows sliding to new slots
  derive();
  // A new view opens on its leader in the laptop pane; on a phone an open
  // team that is not in this view closes.
  if (desktop.matches) { open = teams[0].id; rosterEnter = true; }
  else if (open !== null && !byId(open)) closeTeam();
  silent = true;
  try { render(); } finally { silent = false; }
  markActive();
}
viewTags.forEach((b) => b.addEventListener("click", () => setView(Number(b.dataset.view))));

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
if (desktop.matches) openTeam(teams[0].id, false);   // shown, not yet lifted: pickOnLoad() lifts it after the cascade

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
  if (reducedMotion.matches) { pickOnLoad(); boardReady(); return; }
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
