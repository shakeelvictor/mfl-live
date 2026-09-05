// Offline check for app/playoffs.js: replays the 2025 season from checked-in
// MFL responses and confirms the seeding and the round-by-round fold name
// exactly the franchises MFL scored in Weeks 15, 16 and 17. No network.
//
//   node spike/verify-playoffs.mjs
//
// The stakes: the page hides every franchise the fold says is not in the
// round. A fold that is off by one seed quietly drops a live team from the
// board and shows an eliminated one in its place, and both look like a
// normal Sunday.

import fs from 'node:fs';
import path from 'node:path';

await import('../app/playoffs.js');
const { Playoffs } = globalThis;

const FIX = path.join(import.meta.dirname, 'fixtures');
const load = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
const toArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const weeks = load('seasonScores-2025.json').weeks;
// Who MFL actually scored in a playoff week: everyone else sits at 0.00
// with no starters.
const scoredIn = (w) => toArray(load(`liveScoring-2025-w${w}.json`).liveScoring.franchise)
  .filter((f) => Number(f.score) > 0).map((f) => f.id).sort();
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

let failed = 0;
function check(name, pass, detail = '') {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!pass) failed++;
}

console.log('\nPlayoffs — 2025 replay from fixtures\n');

const seeds = Playoffs.seeds(weeks);
check('11 franchises seeded', seeds.length === 11, String(seeds.length));
check('No. 1 seed is 3rd and 1 (0003) at 116-24', seeds[0].id === '0003' && seeds[0].record === '116-24', `${seeds[0].id} ${seeds[0].record}`);
check('every regular-season record is 140 games', seeds.every((s) => s.games === 140));
// Seeds 3-6 in 2025 were separated by points for (71-69, 71-69, 69-71, 69-71).
check('ties on record break on points for', seeds[2].id === '0007' && seeds[3].id === '0004' && seeds[4].id === '0011' && seeds[5].id === '0001',
  seeds.slice(2, 6).map((s) => `${s.id} ${s.record} ${s.pf}`).join(', '));

const r15 = Playoffs.field(weeks, 15);
check('Week 15: seeds 2-6 play', same(r15.alive, seeds.slice(1, 6).map((s) => s.id)));
check('Week 15: the fold matches who MFL scored', same(r15.alive, scoredIn(15)), r15.alive.join(' '));
check('Week 15: the No. 1 seed rests', same(r15.bye, ['0003']));
check('Week 15: no earlier rounds', r15.prior.length === 0 && r15.complete);

const r16 = Playoffs.field(weeks, 16);
check('Week 16: three survivors plus the bye', same(r16.alive, scoredIn(16)), r16.alive.join(' '));
check('Week 16: nobody rests', r16.bye.length === 0);
check('Week 16: Round 1 sent 0001, 0004, 0011 through', same(r16.prior[0].ranked.filter((s) => s.through).map((s) => s.id), ['0001', '0004', '0011']));
check('Week 16: Round 1 dropped 0007 and 0005', same(r16.prior[0].ranked.filter((s) => !s.through).map((s) => s.id), ['0007', '0005']));

const r17 = Playoffs.field(weeks, 17);
check('Week 17: the Fantasy Bowl is 0001 v 0011', same(r17.alive, scoredIn(17)), r17.alive.join(' '));
check('Week 17: the Bowl is flagged', r17.round.bowl === true && r17.round.drop === 1);
const bowl = Playoffs.rank(r17.alive.map((id) => ({ id, score: weeks.find((w) => w.week === 17).franchise.find((f) => f.id === id).score })), r17.seedOf);
check('Week 17: Uncle Rico (0001) wins it', bowl[0].id === '0001', `${bowl[0].id} ${bowl[0].score} over ${bowl[1].id} ${bowl[1].score}`);

check('Week 14 is not a playoff week', Playoffs.field(weeks, 14) === null);
check('Week 18 is not a playoff week', Playoffs.field(weeks, 18) === null);
const partial = Playoffs.field(weeks.filter((w) => w.week <= 14), 16);
check('Week 16 without Week 15 scores is incomplete', partial.complete === false);

// Week 18: Pakistan vs. the World. Each manager starts only the players he
// contributes to his side's super lineup, so the side's score is the sum of
// its franchises' scores; the records site has 2025 at 124.31 v 147.63.
const w18 = toArray(load('liveScoring-2025-w18.json').liveScoring.franchise)
  .map((f) => ({ id: f.id, score: Number(f.score), starters: toArray(f.players?.player).filter((p) => p.status === 'starter').length }));
const sides = Playoffs.EXHIBITION.sides;
const onSides = sides.flatMap((s) => s.franchises);
check('Week 18: every franchise is on exactly one side', w18.every((f) => onSides.filter((id) => id === f.id).length === 1) && onSides.length === w18.length);
const totals = Playoffs.sideTotals(w18);
check('Week 18: Pakistan accumulates to 124.31', totals['side:pakistan'] === 124.31, String(totals['side:pakistan']));
check('Week 18: the World accumulates to 147.63', totals['side:world'] === 147.63, String(totals['side:world']));
const lineup = (s) => w18.filter((f) => s.franchises.includes(f.id)).reduce((a, f) => a + f.starters, 0);
check('Week 18: twelve starters a side', sides.every((s) => lineup(s) === 12), sides.map((s) => `${s.name} ${lineup(s)}`).join(', '));
check('Week 18 is the exhibition, not a round', Playoffs.round(18) === null && Playoffs.EXHIBITION.week === 18);

console.log(failed ? `\n${failed} check(s) FAILED\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
