// Illustrative mid-slate framing. The fixture is a finished week, so the
// clock, starters yet to play and "on now" are staged to show the board
// in progress. liveScoring supplies the real values (playersYetToPlay,
// gameSecondsRemaining) once the feed is wired.
let WEEK = 12;   // the demo bar's view tags move it into the postseason
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
const hot = (g) => g !== undefined && tier(g) !== "settled";
const TIER_LABEL = { critical: "Coin flip", live: "Live", settled: "Settled" };

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
  const sizes = [...new Set(teams.map((t) => t.starters.length))];
  document.getElementById("franchise-count").textContent = duel ? (sizes.length === 1 ? `${sizes[0]} a side` : teams.map((t) => t.starters.length).join(" v ") + " players")
    : !post ? `${n} franchises`
    : post.round.bowl ? `${n} play, 1 wins it`
    : `${n} play, ${n - post.round.drop} advance`;
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
  const within = new Set(gaps.flatMap((g, i) => (g < WITHIN ? [i, i + 1] : []))).size;
  const atStake = gaps.filter((g) => g < WITHIN).length;
  const startersLeft = teams.reduce((s, t) => s + t.toPlay, 0);
  const left = `<span class="capsule"><b class="accent">${startersLeft}</b>starters left</span>`;
  // Pakistan vs. the World: the margin, in the gap's tier.
  if (duel) {
    caps.innerHTML =
      `<span class="capsule"><b class="${tier(gaps[0])}">${fmt(gaps[0])}</b>margin</span>` + left +
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
      (cut === undefined ? "" : `<span class="capsule"><b class="${tier(cut)}">${fmt(cut)}</b>cut line</span>`) + left;
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
  const lead = teams[0], chaser = teams[1], lt = tier(gaps[0]);
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
      `<span class="tier ${lt}">${TIER_LABEL[lt]}</span>` +
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
    const fuseTop = i > 1 && hot(above), fuseBottom = hot(below);

    // Rank circle takes the hotter of the two gaps the row touches.
    const tiers = [above, below].filter((g) => g !== undefined).map(tier);
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
    const gt = tier(below);
    const cut = i === cutAt;
    // A coin-flip pill flashes when either score beside it moved.
    const pillFlash = gt === "critical" && (changed.has(t.id) || changed.has(teams[i + 1].id));
    return row +
      `<div class="gap ${gt}${cut ? " cut" : ""}" aria-label="${cut ? "Cut line, " : ""}Gap ${fmt(below)}${gt === "critical" ? ", coin flip" : ""}">` +
        `<span class="line"></span>` +
        `<span class="pill${pillFlash ? " flash" : ""}"><span data-tween="gap:${t.id}:${teams[i + 1].id}">${fmt(below)}</span>` +
          (cut ? `<span class="flip">${gt === "critical" ? "Cut &middot; coin flip" : "Cut line"}</span>`
            : gt === "critical" ? `<span class="flip">Coin flip</span>` : "") +
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

// The NFL slate behind the rows, for the expanded row's game strip: the
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
const tile = (l, v, always = false) => ({ l, v, always });
const rate = (yd, n) => (n > 0 ? (yd / n).toFixed(1) : null);
function statTiles(pos, st) {
  st = st || {};
  const n = (k) => st[k] || 0;
  const frac = (a, b) => `${n(a)}/${n(b) || n(a)}`;
  let tiles;
  if (pos === "QB") tiles = [
    tile("CMP/ATT", frac("pass_cmp", "pass_att"), true), tile("PASS YDS", n("pass_yd"), true),
    tile("PASS TD", n("pass_td"), true), tile("INT", n("pass_int"), true),
    tile("Y/A", rate(n("pass_yd"), n("pass_att"))),
    tile("RUSH", n("rush_att")), tile("RUSH YDS", n("rush_yd")), tile("RUSH TD", n("rush_td")),
    tile("FUM LOST", n("fum_lost")),
  ];
  else if (pos === "RB") tiles = [
    tile("CAR", n("rush_att"), true), tile("RUSH YDS", n("rush_yd"), true), tile("RUSH TD", n("rush_td"), true),
    tile("Y/C", rate(n("rush_yd"), n("rush_att"))),
    tile("REC/TGT", frac("rec", "rec_tgt"), true), tile("REC YDS", n("rec_yd"), true), tile("REC TD", n("rec_td")),
    tile("FUM LOST", n("fum_lost")),
  ];
  else if (pos === "WR" || pos === "TE") tiles = [
    tile("REC/TGT", frac("rec", "rec_tgt"), true), tile("REC YDS", n("rec_yd"), true), tile("REC TD", n("rec_td"), true),
    tile("Y/R", rate(n("rec_yd"), n("rec"))),
    tile("CAR", n("rush_att")), tile("RUSH YDS", n("rush_yd")), tile("RUSH TD", n("rush_td")),
    tile("FUM LOST", n("fum_lost")),
  ];
  else if (pos === "K") tiles = [
    tile("FG", frac("fgm", "fga"), true), tile("XP", frac("xpm", "xpa"), true),
  ];
  else tiles = [
    tile("TKL", n("idp_tkl"), true), tile("SOLO", n("idp_tkl_solo"), true), tile("AST", n("idp_tkl_ast"), true),
    tile("TFL", n("idp_tkl_loss")), tile("SACK", n("idp_sack")), tile("INT", n("idp_int")),
    tile("FF", n("idp_ff")), tile("FR", n("idp_fum_rec")), tile("PD", n("idp_pass_def")),
    tile("BLK", n("idp_blk_kick")), tile("SAF", n("idp_safe")),
    tile("ST TKL", n("st_tkl_solo")), tile("ST FF", n("st_ff")), tile("ST FR", n("st_fum_rec")),
    tile("TD", n("idp_td") + n("idp_def_td") + n("st_td")),
  ];
  const zero = (v) => v === null || v === 0 || /^0\/0$/.test(String(v));
  return tiles.filter((t) => t.always || !zero(t.v)).map((t) => ({ ...t, zero: zero(t.v) }));
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
  const all = teams.flatMap((t) => liveStarters(t, new Set()).map((p) => ({ ...p, franchise: p.from || t.team })));
  let pool, label, when;
  if (slate.nextWeek) return { top: null, key: "none" };            // new week, nothing final yet
  if (weekIsFinal()) { pool = all; label = post ? `\u2605 MVP of ${post.round.ref}` : duel ? "\u2605 MVP of the Pro Bowl" : "\u2605 MVP of the week"; when = `${post ? post.round.name : duel ? EXHIBITION.name : `Week ${WEEK}`} final`; }
  else if (slate.sunFinal) { pool = all.filter((p) => !THU_NFL.has(p.tm)); label = "Top scorer"; when = "Sunday"; }
  else return { top: null, key: "none" };                             // Sunday is in progress
  const top = pool.reduce((a, p) => (p.pts > a.pts ? p : a), pool[0]);
  return { top, label, when, mvp: weekIsFinal(), key: `${when}:${top?.key}` };
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

// Which rows are expanded, by slot key, so a tick's re-render keeps them open.
const expanded = new Set();
const detailKey = (p) => p.key;

// The player's NFL game across the top of the card: away @ home with
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

const detailHtml = (p) => {
  const tiles = Object.keys(p.st || {}).length ? statTiles(p.pos, p.st) : [];
  return `<div class="pdetail" aria-hidden="${expanded.has(detailKey(p)) ? "false" : "true"}"><div>` +
    gameStrip(p) +
    (tiles.length
      ? `<div class="ptiles">${tiles.map((t) => `<span class="ptile${t.zero ? " zero" : ""}"><b>${esc(t.v)}</b><span>${esc(t.l)}</span></span>`).join("")}</div>`
      : `<p class="pnone">No stats yet</p>`) +
  `</div></div>`;
};

// top: the team's highest-scoring starter gets a gold ring (MVP echo).
// The row is a button: tap (or Enter/Space) opens the game strip and stat
// breakdown under it; the chevron under the points says so.
const playerRow = (p, bench, top = false, enter = -1) =>
  `<div class="prow${bench ? " bench" : ""}${p.pts === 0 ? " zero" : ""}${isLive(p) ? " live" : ""}${inRedZone(p) ? " rz" : ""}${top ? " top" : ""}${enter >= 0 ? " enter" : ""}${expanded.has(detailKey(p)) ? " open" : ""}"${enter >= 0 ? ` style="--i:${enter}"` : ""}` +
    ` role="button" tabindex="0" aria-expanded="${expanded.has(detailKey(p))}" data-pk="${esc(detailKey(p))}"${inRedZone(p) ? ` title="In the red zone"` : ""}>` +
    `<span class="pface">${avatar(p)}${logoBadge(p.tm)}${tdBadge(p.st)}</span>` +
    `<span class="pos ${posClass(p.pos)}">${esc(p.pos)}</span>` +
    `<span class="pname"><b>${esc(p.n)}</b>` +
      `<span class="pmeta">${esc(p.tm)}<span aria-hidden="true">·</span>` +
        (isLive(p) ? `<span class="clock"><span class="dot"></span>${clockFor(p)}</span>` : `<span>Final</span>`) +

        (p.from ? `<span aria-hidden="true">·</span><span class="pfrom">${esc(p.from)}</span>` : "") +
      `</span>` +
      `<span class="pstat">${esc(statLine(p.pos, p.st))}</span>` +
    `</span>` +
    `<span class="pright">` +
      `<span class="ppts${p.pts === 0 ? " zero" : ""}${p.flash ? " flash" : ""}"${p.key ? ` data-tween="p:${p.key}" data-delta` : ""}>${fmt(p.pts)}</span>` +
      `<span class="pchev" aria-hidden="true"></span>` +
    `</span>` +
    detailHtml(p) +
  `</div>`;

const page = document.getElementById("team");
const rosterEl = document.getElementById("roster");
const tabs = [...page.querySelectorAll(".tab")];
let open = null;       // team id
let picked = null;     // the team last opened: its row stays lifted on the board (on a phone,
                       // after the page closes too, so the board shows where you have been)
let tab = "starters";
let lastFocus = null;

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
}

// Laptop and up: the team panel is always in view, so "opening" a team is
// selecting it. The selected row becomes a tab into the panel.
const desktop = matchMedia("(min-width: 1024px)");

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
  page.dataset.open = "true";
  page.scrollTop = 0;
  document.body.classList.add("team-open");   // board keeps its scroll position
  fitName(document.getElementById("team-name"));   // measurable now that the page is displayed
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
tabs.forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; rosterEnter = true; renderTeam(); }));

// Expand or collapse a player's breakdown in place (no re-render, so the
// panel's height transition plays); the next render keeps the state.
// The panel's height cannot transition to auto, so the script tweens it
// to its measured height (or back to 0) and, once there, clears the
// inline size: an open panel is then a plain block, natural height, no
// overflow clip, nothing for a browser's paint cache to get wrong (Safari
// left the tile labels unpainted inside an animated, clipped grid track).
function setPlayer(row, on) {
  if (row.classList.contains("open") === on) return;
  const d = row.querySelector(".pdetail");
  const tween = d && !reducedMotion.matches;
  if (tween) { d.classList.add("tween"); d.style.height = `${on ? 0 : d.scrollHeight}px`; d.getBoundingClientRect(); }
  row.classList.toggle("open", on);
  row.setAttribute("aria-expanded", String(on));
  d?.setAttribute("aria-hidden", String(!on));
  if (tween) d.style.height = `${on ? d.scrollHeight : 0}px`;
  if (on) expanded.add(row.dataset.pk); else expanded.delete(row.dataset.pk);
  markMore();
}
// One breakdown at a time: opening a row closes whichever was open.
function togglePlayer(row) {
  const on = !row.classList.contains("open");
  if (on) for (const other of rosterEl.querySelectorAll(".prow.open")) if (other !== row) setPlayer(other, false);
  setPlayer(row, on);
}
function closePlayers() {
  for (const row of rosterEl.querySelectorAll(".prow.open")) setPlayer(row, false);
  expanded.clear();   // a poll's re-render must not bring it back
}
rosterEl.addEventListener("click", (e) => {
  const row = e.target.closest(".prow");
  if (row) togglePlayer(row);
});
// A tap anywhere else puts the open breakdown away. Capture phase, so it
// runs before a tab or a row handler re-renders the roster: those rows
// then render closed instead of opening and closing.
document.addEventListener("click", (e) => {
  if (expanded.size && !e.target.closest(".prow")) closePlayers();
}, true);
rosterEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const row = e.target.closest(".prow");
  if (!row) return;
  e.preventDefault();   // Space would scroll the roster
  togglePlayer(row);
});
rosterEl.addEventListener("transitionend", (e) => {
  if (!e.target.classList.contains("pdetail") || e.propertyName !== "height") return;
  e.target.style.height = "";
  e.target.classList.remove("tween");
  markMore();
});
// Once a row's swing has settled, drop .enter: its will-change and
// backface-visibility keep the row on its own compositor layer, and in
// Safari text opened inside such a layer later (the breakdown's tile
// labels) went unpainted.
rosterEl.addEventListener("animationend", (e) => {
  if (e.animationName !== "fflr-sway") return;
  e.target.classList.remove("enter");
  e.target.style.removeProperty("--i");
});
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
    `<span class="td-for">for <b>${esc(ev.franchise)}</b></span>` +
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
  if (reducedMotion.matches) { pickOnLoad(); return; }
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
    pickOnLoad();
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
