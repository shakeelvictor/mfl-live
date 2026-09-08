// Stages a finished 2025 playoff week as if it were still being played, so
// the in-progress playoff board (cut line, In/Out, starters left, on now)
// can be looked at before the real one exists.
//
//   MFL_UA='imp19716' node spike/fake-round.mjs 15        -> spike/data/fake-w15/
//   MFL_SEASON=2025 MFL_FAKE_DIR=spike/data/fake-w15 node dev.mjs
//   open http://localhost:8770/?w=15
//
// Two of the week's late games are put back on the field: their clocks are
// set mid-game, every player in them keeps a share of his real score, and
// the franchise totals and starters-to-play counts are recomputed from
// the players, so the fake keeps the invariant the page relies on (team
// total == starters' sum). Everything else stays as MFL reported it. The
// fixture for the week must be checked in (spike/fixtures).

import fs from 'node:fs';
import path from 'node:path';

const W = Number(process.argv[2] || 15);
const UA = process.env.MFL_UA || 'imp19716';
const HERE = import.meta.dirname;
const OUT = path.join(HERE, 'data', `fake-w${W}`);
const toArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const r2 = (x) => Math.round(x * 100) / 100;

const live = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', `liveScoring-2025-w${W}.json`), 'utf8'));
const get = async (q) => (await fetch(`https://api.myfantasyleague.com/2025/export?JSON=1&${q}`, { headers: { 'User-Agent': UA } })).json();

// The week's slate, latest kickoffs first: the last two games go live.
const sched = await get(`TYPE=nflSchedule&W=${W}`);
const games = toArray(sched.nflSchedule?.matchup).sort((a, b) => Number(b.kickoff) - Number(a.kickoff));
const liveGames = games.slice(0, 2);
const clock = new Map();   // NFL team -> seconds remaining
liveGames.forEach((g, i) => {
  g.gameSecondsRemaining = String(i === 0 ? 2100 : 640);   // one in the third quarter, one late in the fourth
  for (const t of toArray(g.team)) clock.set(t.id, Number(g.gameSecondsRemaining));
  // The home side has the ball; in the first game it is in the red zone,
  // so the RZ markers (row, status, game strip) show mid-round.
  for (const t of toArray(g.team)) { t.hasPossession = t.isHome; t.inRedZone = i === 0 ? t.isHome : '0'; }
});

// Player -> NFL team, from MFL's player list for the ids in the fixture.
const ids = [...new Set(toArray(live.liveScoring.franchise).flatMap((f) => toArray(f.players?.player).map((p) => p.id)))];
const teamOf = new Map();
for (let i = 0; i < ids.length; i += 250) {
  const chunk = await get(`TYPE=players&L=19716&DETAILS=1&PLAYERS=${ids.slice(i, i + 250).join(',')}`);
  for (const p of toArray(chunk.players?.player)) teamOf.set(p.id, p.team);
}

let touched = 0;
for (const f of toArray(live.liveScoring.franchise)) {
  let total = 0, toPlay = 0;
  for (const p of toArray(f.players?.player)) {
    const secs = clock.get(teamOf.get(p.id));
    if (secs != null) {
      // A share of the real line proportional to the game played so far.
      p.score = r2(Number(p.score) * (1 - secs / 3600));
      p.gameSecondsRemaining = String(secs);
      touched++;
    }
    if (p.status === 'starter') {
      total += Number(p.score) || 0;
      if (Number(p.gameSecondsRemaining) > 0) toPlay++;
    }
  }
  if (toArray(f.players?.player).some((p) => p.status === 'starter')) {
    f.score = r2(total).toFixed(2);
    f.playersYetToPlay = String(toPlay);
  }
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `liveScoring-w${W}.json`), JSON.stringify(live));
fs.writeFileSync(path.join(OUT, `nflSchedule-w${W}.json`), JSON.stringify(sched));
console.log(`${OUT}: ${liveGames.map((g) => toArray(g.team).map((t) => t.id).join(' v ')).join(', ')} put back on the field; ${touched} players adjusted`);
