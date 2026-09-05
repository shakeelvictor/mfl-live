/* The postseason as arithmetic. A classic script shared by the page (app.js)
   and the offline check (spike/verify-playoffs.mjs): it defines
   globalThis.Playoffs and nothing else. No DOM, no network, no clock.

   The league's playoffs are a scoring fold, not a bracket (rules:
   https://fflr.netlify.app/rules, "Playoffs"). MFL cannot represent a
   five-team round, so its playoffBrackets export is empty for this league
   and the fold lives here, mirroring fantasy-football-records/src/derive.mjs:

     Seeds        all-play record over Weeks 1-14: win pct, then points for.
     Week 15      Round 1: seeds 2-6 play, the bottom two are out.    5 -> 3
     Week 16      Semifinal: the three plus the No. 1 seed back from
                  its bye; the bottom two are out.                    4 -> 2
     Week 17      Fantasy Bowl: the higher score takes the title.

   Verified against 2025 (spike/verify-playoffs.mjs): the fold names exactly
   the franchises MFL scored in each of the three weeks.

   Input everywhere is the season's weekly franchise scores, as the proxy's
   seasonScores type returns them:
     [{ week: 1, franchise: [{ id: "0001", score: 119.19 }, ...] }, ...] */

(function (root) {
  const PLAYOFFS = {
    regularSeasonWeeks: 14,   // Weeks 1-14 seed the field
    teams: 6,
    byeSeeds: [1],            // only the regular-season winner sits out Round 1
    // `ref` is the name in a sentence ("Leading the Semifinal").
    rounds: [
      { week: 15, name: "Round 1",      ref: "Round 1",          drop: 2 },
      { week: 16, name: "Semifinal",    ref: "the Semifinal",    drop: 2 },
      { week: 17, name: "Fantasy Bowl", ref: "the Fantasy Bowl", drop: 1, bowl: true },
    ],
    // From the rules' Buy-In & Payouts table ($1,100 pool). The rounds
    // before the Bowl pay nothing; weekly-winner money stops at Week 14.
    purse: { champion: 275, runnerUp: 105 },
  };

  const round = (week) => PLAYOFFS.rounds.find((r) => r.week === Number(week)) || null;

  /* Week 18, Pakistan vs. the World: the league's Pro Bowl, $20 a head
     (rules, "Traditions & Side Games"). Each side fields one super lineup
     of its managers' players, declared before the week under the normal
     lineup rules. In MFL each manager starts only the players he
     contributes, so a side's score is the accumulation of its franchises'
     scores (2025: 124.31 v 147.63, matching the records site to the cent).
     Franchise ids are stable across seasons, team names are not; the split
     is the records repo's standing one (data/exhibition.json) and carries
     forward until the league re-picks sides. */
  const EXHIBITION = {
    week: 18, name: "Pro Bowl", perHead: 20,
    sides: [
      // `flag` picks the hero's flag (app.js draws them): Pakistan's, and the
      // Stars and Stripes for the World.
      { id: "side:pakistan", name: "Pakistan",  flag: "pk", franchises: ["0001", "0002", "0003", "0004", "0005", "0007"] },   // Shak, Ryaan, Samson, Imran, Hoss, Asher
      { id: "side:world",    name: "The World", flag: "us", franchises: ["0006", "0008", "0009", "0010", "0011"] },           // Andres, Dante, Vip, Anand, Laura
    ],
  };
  const exhibition = () => ({
    sides: EXHIBITION.sides,
    sideOf: new Map(EXHIBITION.sides.flatMap((s) => s.franchises.map((id) => [id, s]))),
  });
  // Side totals from franchise scores ([{ id, score }]): { "side:pakistan": 124.31, ... }
  const sideTotals = (scores) => Object.fromEntries(EXHIBITION.sides.map((s) =>
    [s.id, Math.round(scores.filter((f) => s.franchises.includes(f.id)).reduce((a, f) => a + (Number(f.score) || 0), 0) * 100) / 100]));

  const record = (r) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`;

  // All-play over the regular season: each week every franchise is scored
  // against every other, so a week is (n - 1) games. Ties count as ties.
  function allPlay(weeks) {
    const table = new Map();
    const row = (id) => {
      if (!table.has(id)) table.set(id, { id, w: 0, l: 0, t: 0, pf: 0 });
      return table.get(id);
    };
    for (const wk of weeks) {
      if (Number(wk.week) > PLAYOFFS.regularSeasonWeeks) continue;
      for (const a of wk.franchise) {
        const r = row(a.id);
        r.pf += Number(a.score) || 0;
        for (const b of wk.franchise) {
          if (a.id === b.id) continue;
          if (a.score > b.score) r.w++;
          else if (a.score < b.score) r.l++;
          else r.t++;
        }
      }
    }
    return [...table.values()].map((r) => {
      const games = r.w + r.l + r.t;
      return { ...r, pf: Math.round(r.pf * 100) / 100, games, pct: games ? (r.w + r.t / 2) / games : 0, record: record(r) };
    });
  }

  // Seeding: win pct, then points for, then id so the sort is total.
  // Points alone is a tempting misreading and wrong (see the records repo).
  const seeds = (weeks) => allPlay(weeks)
    .sort((a, b) => b.pct - a.pct || b.pf - a.pf || a.id.localeCompare(b.id))
    .map((r, i) => ({ ...r, seed: i + 1 }));

  // Within a playoff week: higher score first; a tie goes to the higher
  // seed. Never observed (decimal scoring), but the sort must be total.
  const rank = (scored, seedOf) =>
    [...scored].sort((a, b) => b.score - a.score || seedOf.get(a.id) - seedOf.get(b.id));

  /* The field for a playoff week: who plays it, who is resting, and how the
     earlier rounds went. `complete` is false when an earlier round's scores
     are not in `weeks` yet, in which case `alive` is only as far as the
     fold got and the page should not trust it. */
  function field(weeks, week) {
    const r = round(week);
    if (!r) return null;
    const S = seeds(weeks);
    const seedOf = new Map(S.map((s) => [s.id, s.seed]));
    const qualified = S.slice(0, PLAYOFFS.teams);
    const bye = new Set(PLAYOFFS.byeSeeds);
    let alive = qualified.filter((s) => !bye.has(s.seed)).map((s) => s.id);
    let resting = qualified.filter((s) => bye.has(s.seed)).map((s) => s.id);
    const prior = [];
    let complete = true;

    for (const rr of PLAYOFFS.rounds) {
      if (rr.week >= r.week) break;
      const wk = weeks.find((w) => Number(w.week) === rr.week);
      const scored = alive.map((id) => ({ id, score: Number(wk?.franchise?.find((f) => f.id === id)?.score) }));
      if (!wk || scored.some((s) => !Number.isFinite(s.score))) { complete = false; break; }
      const ranked = rank(scored, seedOf).map((s, i) => ({ ...s, seed: seedOf.get(s.id), through: i < scored.length - rr.drop }));
      prior.push({ week: rr.week, name: rr.name, ranked });
      // Survivors, then whoever sat this round out rejoins for the next.
      alive = ranked.filter((s) => s.through).map((s) => s.id).concat(resting);
      resting = [];
    }

    return { round: r, seeds: S, seedOf, alive, bye: resting, prior, complete };
  }

  root.Playoffs = { PLAYOFFS, round, allPlay, seeds, rank, field, EXHIBITION, exhibition, sideTotals };
})(globalThis);
