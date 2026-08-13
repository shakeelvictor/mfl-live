// Reduce an MFL liveScoring response to a stable fingerprint of its scoring
// state. This is the load-bearing logic of the cadence spike: if it reports
// "changed" when nothing changed, the measurement is worthless.
//
// MFL's JSON is NOT stable between calls. Observed against league 19716:
// player objects come back with their keys in different orders, and array
// order is a display setting MFL is free to vary. Hashing the raw response
// body would therefore report a change on essentially every poll.
//
// So we project the response down to the facts we care about, sort everything,
// and hash that. Verified by verify-canonical.mjs.

import crypto from 'node:crypto';

/** Always an array — MFL returns a bare object where a list has one member. */
export const toArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

/**
 * Two hashes, because they answer different questions:
 *   scoreHash   — did any POINTS move? this is the cadence signal.
 *   starterHash — did anyone's LINEUP change? catches late swaps.
 */
export function canonical(ls) {
  const franchises = toArray(ls?.franchise);
  const scoreRows = [];
  const starterRows = [];
  let currentlyPlaying = 0;
  let yetToPlay = 0;
  const byFranchise = {};

  for (const f of franchises) {
    const players = toArray(f?.players?.player);
    currentlyPlaying += Number(f?.playersCurrentlyPlaying) || 0;
    yetToPlay += Number(f?.playersYetToPlay) || 0;
    byFranchise[f.id] = Number(f.score) || 0;

    const ps = players.map((p) => `${p.id}:${Number(p.score) || 0}:${p.status}`).sort();
    scoreRows.push(`${f.id}:${Number(f.score) || 0}|${ps.join(',')}`);

    const starters = players.filter((p) => p.status === 'starter').map((p) => p.id).sort();
    starterRows.push(`${f.id}|${starters.join(',')}`);
  }

  const h = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
  return {
    scoreHash: h(scoreRows.sort().join('\n')),
    starterHash: h(starterRows.sort().join('\n')),
    currentlyPlaying,
    yetToPlay,
    byFranchise,
    franchiseCount: franchises.length,
  };
}
