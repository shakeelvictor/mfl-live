// INDOMEXPAK's scoring rules over Sleeper's stat vocabulary, for the
// Sleeper-computed number the page shows BESIDE MFL's (2026-09-10). A
// copy of fantasy-draft-assistant/public/scoring.js (the fflr rules at
// https://fflr.netlify.app/rules#scoring, one engine, three callers) plus
// scoreLine() at the bottom: exact mode, and special-teams tackles folded
// into the solo count, since MFL counts them toward IDP totals (that fold
// lifted escalator agreement from 93.0% to 96.1% across four 2025 weeks).
// This number never feeds a score: MFL's points are the points (CLAUDE.md,
// "Recomputing scores ourselves is disqualified"). It is a comparison.

'use strict';

const CV = {
  pass_yd: 0.30,
  rush_yd: 0.48,
  rec_yd: 0.52,
};

// Standard normal CDF (Abramowitz & Stegun approximation)
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

// Expected bonus points for tiered per-game yardage bonuses.
// tiers: [{min, pts}] ascending; a game in [tier.min, nextTier.min) earns tier.pts.
function expectedTierBonus(mean, cv, tiers) {
  if (!mean || mean <= 0) return 0;
  const sigma = Math.max(mean * cv, 1);
  let ev = 0;
  for (let i = 0; i < tiers.length; i++) {
    const lo = tiers[i].min;
    const hi = i + 1 < tiers.length ? tiers[i + 1].min : Infinity;
    const pLo = phi((lo - mean) / sigma);
    const pHi = hi === Infinity ? 1 : phi((hi - mean) / sigma);
    ev += tiers[i].pts * (pHi - pLo);
  }
  return ev;
}

// Same tiers applied to a stat line that is already final: no distribution,
// just the highest tier the game actually cleared.
function exactTierBonus(yards, tiers) {
  let pts = 0;
  for (const t of tiers) if (yards >= t.min) pts = t.pts;
  return pts;
}

const PASS_TIERS = [
  { min: 300, pts: 1 },
  { min: 325, pts: 3 },
  { min: 350, pts: 6 },
];
const RUSH_TIERS = [
  { min: 100, pts: 1 },
  { min: 125, pts: 3 },
  { min: 150, pts: 6 },
];
const REC_TIERS = [
  { min: 125, pts: 1 },
  { min: 150, pts: 3 },
  { min: 175, pts: 6 },
];

// IDP solo-tackle escalator (per game):
//   through 6.5 tackles: 1 pt each
//   at 7: 7.5 pts, then +0.75 per additional 0.5 through 9.5
//   at 10: 12.5 pts, then +1.0 per additional 0.5
function tackleEscalator(solo) {
  if (!solo || solo <= 0) return 0;
  if (solo < 7) return solo * 1;
  if (solo < 10) return 7.5 + (solo - 7) * (0.75 / 0.5);
  return 12.5 + (solo - 10) * (1.0 / 0.5);
}

// Score one week of projected (or actual) stats. `s` uses Sleeper stat keys.
// `exact` = the game is in the books, so yardage bonuses are a threshold check
// rather than an expectation.
function scoreWeek(s, exact) {
  if (!s) return 0;
  const g = (k) => Number(s[k]) || 0;
  const tierBonus = exact
    ? (mean, cv, tiers) => exactTierBonus(mean, tiers)
    : expectedTierBonus;
  let pts = 0;

  // Passing
  pts += g('pass_td') * 6;
  pts += g('pass_yd') * 0.04;
  pts += g('pass_int') * -2;
  pts += g('pass_2pt') * 2;
  pts += tierBonus(g('pass_yd'), CV.pass_yd, PASS_TIERS);

  // Rushing — 0.13333/yd (7.5 yds = 1 pt)
  pts += g('rush_td') * 6;
  pts += g('rush_yd') * (1 / 7.5);
  pts += g('rush_2pt') * 2;
  pts += tierBonus(g('rush_yd'), CV.rush_yd, RUSH_TIERS);

  // Receiving — half PPR
  pts += g('rec_td') * 6;
  pts += g('rec_yd') * 0.1;
  pts += g('rec') * 0.5;
  pts += g('rec_2pt') * 2;
  pts += tierBonus(g('rec_yd'), CV.rec_yd, REC_TIERS);

  // Kicking — one point per 10-yard band (fgm_50p treated as the 50–59 band;
  // 60+ attempts are too rare for projections to carry a bucket)
  pts += g('fgm_0_19') * 1;
  pts += g('fgm_20_29') * 2;
  pts += g('fgm_30_39') * 3;
  pts += g('fgm_40_49') * 4;
  pts += g('fgm_50p') * 5;
  // Final stat lines break out 50–59, so a 60-yarder (6 pts under the rules)
  // is recoverable as the remainder. Projections carry no such split.
  if (exact && s.fgm_50_59 != null) pts += Math.max(0, g('fgm_50p') - g('fgm_50_59')) * 1;
  pts += g('xpm') * 1;

  // Returns & fumbles
  pts += g('st_td') * 6;
  pts += (g('kr_yd') + g('pr_yd')) * 0.05;
  pts += g('fum_lost') * -2;
  pts += g('fum_rec_td') * 6;

  // IDP
  pts += tackleEscalator(g('idp_tkl_solo'));
  pts += g('idp_tkl_ast') * 0.5;
  pts += g('idp_sack') * 3;
  pts += g('idp_tkl_loss') * 1;
  pts += g('idp_int') * 3;
  pts += g('idp_pass_def') * 2;
  pts += g('idp_ff') * 3;
  pts += g('idp_fum_rec') * 3;
  pts += g('idp_def_td') * 6;
  pts += g('idp_safe') * 3;
  pts += g('idp_blk_kick') * 3;

  return pts;
}


// One Sleeper stat line, as it stands, under the league's rules.
function scoreLine(st) {
  if (!st) return 0;
  const solo = (Number(st.idp_tkl_solo) || 0) + (Number(st.st_tkl_solo) || 0);
  return scoreWeek({ ...st, idp_tkl_solo: solo }, true);
}

const API = { scoreWeek, scoreLine, tackleEscalator, expectedTierBonus, exactTierBonus };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.Scoring = API;
