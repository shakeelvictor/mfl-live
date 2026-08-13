// Offline test for canonical() — replays checked-in MFL responses, hits no
// network. Run it before the spike: a dry run against a completed week proves
// the harness fetches and writes, but it CANNOT prove change detection, because
// finished weeks never change. This covers that gap.
//
//   node spike/verify-canonical.mjs
//
// The stakes: if canonical() reports a change when none occurred, every poll
// logs CHANGED and the measured cadence is garbage that looks like a pass.

import fs from 'node:fs';
import path from 'node:path';
import { canonical } from './canonical.mjs';

const FIX = path.join(import.meta.dirname, 'fixtures');
const load = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')).liveScoring;

const w10 = load('liveScoring-2025-w10.json');
const w12 = load('liveScoring-2025-w12.json');

let failed = 0;
function check(name, pass, detail = '') {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!pass) failed++;
}

console.log('\ncanonical() — offline fixture replay\n');

const a = canonical(w10);

check(
  'different weeks hash differently',
  a.scoreHash !== canonical(w12).scoreHash,
  `${a.scoreHash} vs ${canonical(w12).scoreHash}`,
);

// The subtle one. MFL varies key order within player objects and is free to
// reorder arrays. Rebuild the same data "wrong way round" at every level and
// the fingerprint must not move.
const shuffled = {
  ...w10,
  franchise: [...w10.franchise].reverse().map((f) => {
    const ps = [...(Array.isArray(f.players.player) ? f.players.player : [f.players.player])]
      .reverse()
      .map((p) => Object.fromEntries(Object.entries(p).reverse()));
    return Object.fromEntries(Object.entries({ ...f, players: { player: ps } }).reverse());
  }),
};
check(
  'stable under key + array reordering',
  canonical(shuffled).scoreHash === a.scoreHash,
  '(no false CHANGED)',
);

const clone = () => JSON.parse(JSON.stringify(w10));

const edited = clone();
const p0 = edited.franchise[0].players.player[0];
p0.score = String(Number(p0.score) + 0.1);
check('detects a 0.1 point move', canonical(edited).scoreHash !== a.scoreHash);

const swap = clone();
const pl = swap.franchise[0].players.player;
const starter = pl.find((p) => p.status === 'starter');
const bench = pl.find((p) => p.status === 'nonstarter');
starter.status = 'nonstarter';
bench.status = 'starter';
const sc = canonical(swap);
check('detects a lineup swap', sc.starterHash !== a.starterHash);
check('lineup swap also moves scoreHash', sc.scoreHash !== a.scoreHash);

// MFL returns a bare object rather than a list when something has one member.
check(
  'tolerates single-franchise object form',
  canonical({ franchise: w10.franchise[0] }).franchiseCount === 1,
);

check('survives an empty response', canonical(undefined).franchiseCount === 0);

console.log(
  failed === 0
    ? '\nall checks passed — change detection is trustworthy\n'
    : `\n${failed} CHECK(S) FAILED — do not run the spike until fixed\n`,
);
process.exit(failed === 0 ? 0 : 1);
