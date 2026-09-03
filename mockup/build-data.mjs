// Regenerates the ROSTERS and HEADSHOTS blobs inside leaderboard.html.
//
//   MFL_UA='imp19716' node mockup/build-data.mjs
//
// The mockup embeds its data so it stays a single self-contained file. That is
// not just tidiness: the Artifact CSP blocks runtime fetches AND external
// images from every host outside a narrow allowlist, and sleepercdn.com is not
// on it -- so headshots have to be inlined as data: URIs or they silently do
// not render. (On Netlify there is no such constraint; the real app would load
// them straight from the CDN.)
//
// Source of truth is spike/fixtures/liveScoring-2025-w12.json, which is
// committed. Everything else is fetched once and cached under mockup/.cache/.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const UA = process.env.MFL_UA;
if (!UA) {
  console.error("MFL_UA is not set. Use the registered client:\n\n  MFL_UA='imp19716' node mockup/build-data.mjs\n");
  process.exit(1);
}

const HERE = import.meta.dirname;
const CACHE = path.join(HERE, '.cache');
const SHOTS = path.join(CACHE, 'headshots');
fs.mkdirSync(SHOTS, { recursive: true });

const AVATAR_PX = 160;  // 4x for the 40px roster row, 1.2x for the 132px touchdown card
const AVATAR_Q  = 70;

async function cachedJson(name, url) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} fetching ${name}`);
  const body = await res.json();
  if (body.error) throw new Error(`MFL error on ${name}: ${JSON.stringify(body.error)}`);
  fs.writeFileSync(file, JSON.stringify(body));
  return body;
}

const B = 'https://api.myfantasyleague.com/2025/export';
const league  = await cachedJson('league.json',  `${B}?TYPE=league&L=19716&JSON=1`);
const players = await cachedJson('players.json', `${B}?TYPE=players&L=19716&DETAILS=1&JSON=1`);
const sleeper = await cachedJson('sleeper-players.json', 'https://api.sleeper.app/v1/players/nfl');
// Real Week 12 stat lines, keyed by Sleeper id. Context beside MFL's points,
// never a substitute for them (see CLAUDE.md: recomputing is disqualified).
const stats = await cachedJson('sleeper-stats-2025-w12.json', 'https://api.sleeper.app/v1/stats/nfl/regular/2025/12');

const ls = JSON.parse(fs.readFileSync('spike/fixtures/liveScoring-2025-w12.json', 'utf8')).liveScoring;

// MFL franchise names can carry trailing whitespace ("Reggaeton Forever ").
// Trim, exactly as src/mfl/client.mjs does in the records pipeline.
const names = Object.fromEntries(league.league.franchises.franchise
  .map((f) => [f.id, f.name.replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim()]));
const P = Object.fromEntries(players.players.player.map((p) => [p.id, p]));

// MFL -> Sleeper on rotowire_id. Verified 217/217 on this league's rosters;
// espn_id is NOT a usable join key (sparse on Sleeper's side).
const byRotowire = {};
for (const [sid, s] of Object.entries(sleeper)) {
  if (s.rotowire_id) byRotowire[String(s.rotowire_id)] = sid;
}

const nm = (s) => { const [l, f] = String(s).split(',').map((x) => x.trim()); return f ? `${f} ${l}` : l; };
// The subset of Sleeper's stat keys a stat line is built from; zeros dropped.
const STAT_KEYS = ['pass_cmp', 'pass_att', 'pass_yd', 'pass_td', 'pass_int', 'rush_att', 'rush_yd', 'rush_td',
  'rec', 'rec_tgt', 'rec_yd', 'rec_td', 'fum_lost', 'fgm', 'fga', 'xpm', 'xpa',
  'idp_tkl', 'idp_tkl_solo', 'idp_sack', 'idp_int', 'idp_ff', 'idp_fum_rec', 'idp_pass_def', 'idp_tkl_loss'];
const statLine = (sid) => {
  const src = (sid && stats[sid]) || {};
  const out = {};
  for (const k of STAT_KEYS) if (src[k]) out[k] = src[k];
  return out;
};
const POS = (p) => (p === 'PK' ? 'K' : p);

const rosters = ls.franchise.map((f) => {
  const list = Array.isArray(f.players.player) ? f.players.player : [f.players.player];
  const ps = list.map((p) => {
    const m = P[p.id];
    if (!m) throw new Error(`unresolved player id ${p.id}`);
    return {
      n: nm(m.name), pos: POS(m.position), tm: m.team, pts: Number(p.score),
      sid: (m.rotowire_id && byRotowire[String(m.rotowire_id)]) || null,
      s: p.status === 'starter',
    };
  });
  for (const p of ps) p.st = statLine(p.sid);
  const strip = ({ n, pos, tm, pts, sid, st }) => ({ n, pos, tm, pts, sid, st });
  return {
    id: f.id, team: names[f.id], pts: Number(f.score),
    starters: ps.filter((p) => p.s).map(strip),
    bench:    ps.filter((p) => !p.s).map(strip),
  };
}).sort((a, b) => b.pts - a.pts);

// Invariants worth failing on rather than shipping quietly wrong.
for (const t of rosters) {
  if (t.team !== t.team.trim()) throw new Error(`untrimmed name: ${JSON.stringify(t.team)}`);
  if (t.starters.length !== 12) throw new Error(`${t.team} has ${t.starters.length} starters, expected 12`);
  const s = t.starters.reduce((a, p) => a + p.pts, 0);
  if (Math.abs(s - t.pts) > 0.005) throw new Error(`${t.team}: starters sum ${s} != team ${t.pts}`);
}

/* ---------------- headshots ---------------- */

const everyone = rosters.flatMap((t) => [...t.starters, ...t.bench]);
const wanted = [...new Set(everyone.map((p) => p.sid).filter(Boolean))];

// Unknown ids return 403 (not 404), so treat any non-200 as "no headshot"
// and let the UI fall back to initials.
//
// Sleeper thumbs are landscape (250x181) head-and-shoulders crops. Scaling
// that straight down leaves a landscape image, and `object-fit: cover` on a
// round avatar then fits by height -- the head ends up filling only about
// two-thirds of the circle. Crop to a centred square FIRST so the face fills
// the frame, then downscale.
//
// The raw download is kept so re-processing (a different size or crop) never
// re-fetches 215 images.
async function ensureShot(sid) {
  const small = path.join(SHOTS, `${sid}.jpg`);
  const raw = path.join(SHOTS, `${sid}.raw.jpg`);

  if (!fs.existsSync(raw)) {
    const res = await fetch(`https://sleepercdn.com/content/nfl/players/thumb/${sid}.jpg`,
      { headers: { 'User-Agent': UA } });
    if (!res.ok) return false;
    fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  }
  if (fs.existsSync(small)) return true;

  const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', raw]).toString();
  const w = Number(/pixelWidth:\s*(\d+)/.exec(info)?.[1]);
  const h = Number(/pixelHeight:\s*(\d+)/.exec(info)?.[1]);
  if (!w || !h) return false;
  const side = Math.min(w, h);

  // Two passes on purpose: sips applies -Z BEFORE -c no matter the argument
  // order, so a combined call resizes first and then clamps the crop to the
  // shrunken image (250x181 -> 96x69 -> a 69x69 crop, not the 96x96 wanted).
  execFileSync('sips', ['-c', String(side), String(side), raw, '--out', small],
    { stdio: 'ignore' });
  execFileSync('sips', ['-Z', String(AVATAR_PX), '-s', 'format', 'jpeg',
    '-s', 'formatOptions', String(AVATAR_Q), small, '--out', small], { stdio: 'ignore' });
  return fs.existsSync(small);
}

let got = 0, missing = [];
for (let i = 0; i < wanted.length; i += 8) {
  const batch = wanted.slice(i, i + 8);
  const results = await Promise.all(batch.map(async (sid) => [sid, await ensureShot(sid)]));
  for (const [sid, ok] of results) { if (ok) got++; else missing.push(sid); }
}

const headshots = {};
for (const sid of wanted) {
  const f = path.join(SHOTS, `${sid}.jpg`);
  if (fs.existsSync(f)) headshots[sid] = 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64');
}

/* ---------------- team logos ---------------- */

// Sleeper serves NFL team logos at images/team_logos/nfl/<code>.png, keyed
// by its own lowercase codes. MFL uses different codes for eight teams.
const SLEEPER_TEAM = { SFO: "SF", NEP: "NE", GBP: "GB", KCC: "KC", TBB: "TB", NOS: "NO", LVR: "LV", JAC: "JAX" };
const LOGOS_DIR = path.join(CACHE, "logos");
fs.mkdirSync(LOGOS_DIR, { recursive: true });
const LOGO_PX = 96;

async function ensureLogo(tm) {
  const code = (SLEEPER_TEAM[tm] || tm).toLowerCase();
  const raw = path.join(LOGOS_DIR, `${tm}.raw.png`);
  const small = path.join(LOGOS_DIR, `${tm}.png`);
  if (!fs.existsSync(raw)) {
    const res = await fetch(`https://sleepercdn.com/images/team_logos/nfl/${code}.png`,
      { headers: { "User-Agent": UA } });
    // A wrong code should stop the build, not ship a blank badge.
    if (!res.ok) throw new Error(`${res.status} fetching logo for ${tm} (${code})`);
    fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  }
  if (!fs.existsSync(small)) {
    execFileSync("sips", ["-Z", String(LOGO_PX), raw, "--out", small], { stdio: "ignore" });
  }
  return "data:image/png;base64," + fs.readFileSync(small).toString("base64");
}

// Only teams that appear on a roster; free agents carry no logo.
const teamsSeen = [...new Set(everyone.map((p) => p.tm))]
  .filter((tm) => /^[A-Z]{2,3}$/.test(tm) && tm !== "FA").sort();
const logos = {};
for (const tm of teamsSeen) logos[tm] = await ensureLogo(tm);

/* ---------------- inject ---------------- */

const target = path.join(HERE, 'leaderboard.html');
let html = fs.readFileSync(target, 'utf8');

function inject(src, placeholder, re, label, blob) {
  const hasPlaceholder = src.includes(placeholder);
  // Test for the target BEFORE replacing. Comparing the result to the input
  // would report "not found" on a re-run where the data is byte-identical --
  // mistaking idempotency for failure.
  if (!hasPlaceholder && !re.test(src)) throw new Error(`no ${label} placeholder or blob in leaderboard.html`);
  return hasPlaceholder ? src.replace(placeholder, blob) : src.replace(re, blob);
}

const rostersBlob = JSON.stringify(rosters);
const shotsBlob = JSON.stringify(headshots);

html = inject(html, '/*__ROSTERS__*/[]', /const ROSTERS = \[.*?\];\n/s, 'ROSTERS',
  html.includes('/*__ROSTERS__*/[]') ? rostersBlob : `const ROSTERS = ${rostersBlob};\n`);
html = inject(html, '/*__HEADSHOTS__*/{}', /const HEADSHOTS = \{.*?\};\n/s, 'HEADSHOTS',
  html.includes('/*__HEADSHOTS__*/{}') ? shotsBlob : `const HEADSHOTS = ${shotsBlob};\n`);
const logosBlob = JSON.stringify(logos);
html = inject(html, '/*__LOGOS__*/{}', /const LOGOS = \{.*?\};\n/s, 'LOGOS',
  html.includes('/*__LOGOS__*/{}') ? logosBlob : `const LOGOS = ${logosBlob};\n`);

fs.writeFileSync(target, html);

const kb = (b) => (b / 1024).toFixed(0) + 'KB';
console.log(`ok: ${rosters.length} franchises, ${everyone.length} players`);
console.log(`    sleeper ids resolved : ${everyone.filter((p) => p.sid).length}/${everyone.length}`);
console.log(`    headshots embedded   : ${got}/${wanted.length}${missing.length ? '  missing: ' + missing.join(',') : ''}`);
console.log(`    stat lines           : ${everyone.filter((p) => Object.keys(p.st).length).length}/${everyone.length} non-empty`);
console.log(`    team logos embedded  : ${teamsSeen.length}`);
console.log(`    rosters ${kb(rostersBlob.length)}  headshots ${kb(shotsBlob.length)}  logos ${kb(logosBlob.length)}  file ${kb(html.length)}`);
