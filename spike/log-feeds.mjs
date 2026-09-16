// Spike 3 (2026-09-15) — which feed credits a touchdown first, and by how much.
//
// The page leads the touchdown card with ESPN's play text and scores the day
// on Sleeper's stat lines (CLAUDE.md, "Which number is the number"). Whether
// ESPN's box score would make a faster estimate than Sleeper is an inference
// from how the feeds are built, not a measurement. This logs, for every
// scoring play in every live game, when each feed first showed it:
//
//   pbp       ESPN's play-by-play entry (the summary endpoint), which also
//             carries the play's own wall-clock time: the zero every other
//             column is measured from
//   lastPlay  ESPN's scoreboard situation, what the page reads
//   box       ESPN's box score crediting the scorer (and the passer)
//   sleeper   Sleeper's weekly stat line crediting them
//   mfl       MFL's liveScoring jumping six or more for them (the league's
//             rostered players only, since that is all liveScoring carries;
//             polled every third loop, 30s, the cadence the spike ran clean)
//
// Same constraints as log-cadence.mjs: nothing throws, every failure is an
// observation, and every event is appended to disk as it happens, so a
// killed run keeps what it saw. A summary prints on exit or Ctrl-C, and can
// be re-run from the file.
//
// Usage:
//   MFL_UA='imp19716' node spike/log-feeds.mjs                    # until Ctrl-C
//   MFL_UA='imp19716' node spike/log-feeds.mjs --minutes 210 --every 10
//   (it also stops on its own 25 minutes after the last live game ends;
//   .github/workflows/log-feeds.yml runs it on a GitHub runner instead)
//   node spike/log-feeds.mjs --analyze spike/data/feeds-<stamp>.jsonl
//   node spike/log-feeds.mjs --dry 401671715   # a finished game's summary, to check the parsing and the joins

import fs from 'node:fs';
import path from 'node:path';
import { playersMap } from '../server/mfl.mjs';   // the MFL -> Sleeper join the proxy uses

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt; };
const EVERY_S = Number(opt('every', 10));
const MINUTES = Number(opt('minutes', 0));      // 0: until Ctrl-C
const ANALYZE = opt('analyze', null);
const DRY = opt('dry', null);
const UA = process.env.MFL_UA || 'imp19716';
const LEAGUE = process.env.MFL_LEAGUE || '19716';
let SEASON = process.env.MFL_SEASON || null, WEEK = opt('week', null);

const OUT_DIR = path.join(import.meta.dirname, 'data');
fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = ANALYZE || path.join(OUT_DIR, `feeds-${stamp}.jsonl`);

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const toArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const now = () => new Date().toISOString();
const secs = (a, b) => (a && b ? Math.round((new Date(a) - new Date(b)) / 1000) : null);
const log = (ev) => { fs.appendFileSync(OUT, JSON.stringify({ t: now(), ...ev }) + '\n'); };
const say = (...xs) => console.log(new Date().toLocaleTimeString([], { hour12: false }), ...xs);

async function getJson(url, headers = {}, timeoutMs = 8000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 80)}`);
  return res.json();
}

/* ---------------- names and joins ----------------
   ESPN writes a player as "J.Warren" (or "Ja.Warren", "A.St. Brown") in a
   play; the box score names him in full with his athlete id. Sleeper names
   him in full with a team; MFL's rostered players carry an espn_id for
   most and a Sleeper id (through rotowire_id) for all. So: ESPN athlete ->
   Sleeper id by espn_id where MFL has it, else by (name, team). */

const ESPN_TO_SLEEPER_TEAM = { WSH: 'WAS' };
const ESPN_TO_MFL = { WSH: 'WAS', JAX: 'JAC', LV: 'LVR', NE: 'NEP', GB: 'GBP', KC: 'KCC', TB: 'TBB', NO: 'NOS', SF: 'SFO' };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim();
const lastName = (n) => { const w = norm(n).split(' ').filter(Boolean); return w[w.length - 1] || ''; };
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Where a play last names the athlete (the ball carrier is named last), or -1.
function nameAt(text, fullName) {
  const last = lastName(fullName), init = String(fullName).trim()[0];
  if (!last || !init) return -1;
  const re = new RegExp(`(^|[^A-Za-z])${escRe(init)}[a-z]*\\.\\s?(?:[A-Z][a-z]*\\.?\\s)?${escRe(last)}(?![A-Za-z])`, 'gi');
  let at = -1, m;
  while ((m = re.exec(text))) at = m.index + m[1].length;
  return at;
}

let sleeperPlayers = null;        // sid -> { name, team, espn }
let byEspn = new Map();           // espn id -> sid
let byNameTeam = new Map();       // "name|team" -> sid
let rostered = new Map();         // MFL id -> { sid, n, tm }
let rosteredSids = new Set();
let sidToMfl = new Map();

async function loadJoins() {
  const all = await getJson('https://api.sleeper.app/v1/players/nfl', {}, 30000);
  sleeperPlayers = new Map();
  for (const [sid, p] of Object.entries(all)) {
    if (!p.full_name) continue;
    sleeperPlayers.set(sid, { name: p.full_name, team: p.team || null, espn: p.espn_id != null ? String(p.espn_id) : null });
    if (p.espn_id != null) byEspn.set(String(p.espn_id), sid);
    if (p.team) byNameTeam.set(`${norm(p.full_name)}|${p.team}`, sid);
  }
  // The league's rostered players, with MFL's espn_id where it has one.
  try {
    const pm = await playersMap();
    if (pm.error) throw new Error(pm.error);
    rostered = new Map(Object.entries(pm.data.players).map(([id, p]) => [id, { sid: p.sid, n: p.n, tm: p.tm }]));
    for (const [id, p] of rostered) if (p.sid) { rosteredSids.add(p.sid); sidToMfl.set(p.sid, id); }
    const ids = [...rostered.keys()];
    for (let i = 0; i < ids.length; i += 250) {
      const url = `https://api.myfantasyleague.com/${SEASON}/export?TYPE=players&JSON=1&L=${LEAGUE}&DETAILS=1&PLAYERS=${ids.slice(i, i + 250).join(',')}`;
      const chunk = await getJson(url, {}, 15000);
      for (const p of toArray(chunk.players?.player)) {
        const r = rostered.get(p.id);
        if (r?.sid && p.espn_id) byEspn.set(String(p.espn_id), r.sid);   // MFL's join outranks Sleeper's sparse one
      }
    }
    say(`joins: ${sleeperPlayers.size} Sleeper players, ${rostered.size} rostered in the league, ${byEspn.size} ESPN ids resolved`);
  } catch (e) {
    log({ feed: 'join', error: String(e?.message || e) });
    say('rostered join unavailable, logging league-wide only:', e?.message || e);
  }
}
const sidOfAthlete = (id, name, team) => byEspn.get(String(id)) || byNameTeam.get(`${norm(name)}|${ESPN_TO_SLEEPER_TEAM[team] || team}`) || null;

/* ---------------- what has been seen ----------------
   Every first sighting is one line in the file: a scoring play (pbp, with
   its wall clock), the scoreboard's last play, a feed crediting an athlete
   with one more touchdown. The summary pairs credits with plays afterwards. */

const seenPlays = new Set();          // ESPN play id
const seenLastPlay = new Map();       // event id -> last play id
const boxTd = new Map();              // "eventId:athleteId" -> touchdowns credited so far
const sleeperTd = new Map();          // sid -> touchdowns on the line so far
const mflPts = new Map();             // MFL id -> points so far
let sleeperPrimed = false, mflPrimed = false;
const TD_KEYS = ['pass_td', 'rush_td', 'rec_td', 'idp_def_td', 'st_td', 'kr_td', 'pr_td', 'fum_rec_td', 'idp_td'];
const tdOf = (st) => TD_KEYS.reduce((a, k) => a + (Number(st?.[k]) || 0), 0);

async function pollScoreboard() {
  const j = await getJson(`${ESPN}/scoreboard`);
  const live = [];
  for (const e of toArray(j.events)) {
    const c = toArray(e.competitions)[0];
    if (!c) continue;
    if (c.status?.type?.state === 'in') live.push({ id: e.id, name: e.shortName });
    const lp = c.situation?.lastPlay;
    if (lp?.id && seenLastPlay.get(e.id) !== String(lp.id)) {
      seenLastPlay.set(e.id, String(lp.id));
      log({ feed: 'lastPlay', event: e.id, game: e.shortName, play: String(lp.id), text: lp.text?.slice(0, 200) || null,
        scoring: /TOUCHDOWN/i.test(lp.text || ''), athletes: toArray(lp.athletesInvolved).map((a) => ({ id: String(a.id), name: a.fullName, team: a.team?.abbreviation || null })) });
    }
  }
  return live;
}

function readSummary(j, eventId, gameName, dry = false) {
  // Plays: every scoring play, once, with its wall clock.
  const drives = [...toArray(j.drives?.previous), ...(j.drives?.current ? [j.drives.current] : [])];
  const athletes = [];   // this game's box-score athletes, for naming the play's scorer
  for (const side of toArray(j.boxscore?.players)) {
    const team = side.team?.abbreviation || null;
    for (const cat of toArray(side.statistics)) {
      const tdIdx = toArray(cat.keys).map((k, i) => (/touchdowns?$/i.test(k) ? i : -1)).filter((i) => i >= 0);
      for (const row of toArray(cat.athletes)) {
        const a = row.athlete || {};
        if (!a.id) continue;
        let ent = athletes.find((x) => x.id === String(a.id));
        if (!ent) { ent = { id: String(a.id), name: a.displayName || a.shortName || String(a.id), team, pos: a.position?.abbreviation || null, td: 0 }; athletes.push(ent); }
        for (const i of tdIdx) ent.td += Number(toArray(row.stats)[i]) || 0;
      }
    }
  }
  for (const d of drives) for (const p of toArray(d.plays)) {
    if (!p.scoringPlay || !p.id || seenPlays.has(String(p.id))) continue;
    if (!/TOUCHDOWN/i.test(p.text || '')) continue;   // field goals, safeties, tries: not this measurement
    seenPlays.add(String(p.id));
    const text = String(p.text || '');
    const head = text.slice(0, text.search(/TOUCHDOWN/i));
    const passAt = head.search(/\bpass\b/i), turnover = /INTERCEPT|FUMBLE|RECOVER|LATERAL/i.test(head);
    const named = athletes.map((a) => ({ a, at: nameAt(head, a.name) })).filter((x) => x.at >= 0).sort((x, y) => y.at - x.at);
    let scorer = null, passer = null;
    if (passAt >= 0 && !turnover) { scorer = named.find((x) => x.at > passAt)?.a || null; passer = named.find((x) => x.at < passAt)?.a || null; }
    else scorer = named[0]?.a || null;
    const who = (a) => (a ? { id: a.id, name: a.name, team: a.team, pos: a.pos, sid: sidOfAthlete(a.id, a.name, a.team), rostered: rosteredSids.has(sidOfAthlete(a.id, a.name, a.team)) } : null);
    log({ feed: 'pbp', event: eventId, game: gameName, play: String(p.id), wallclock: p.wallclock || null, period: p.period?.number ?? null, clock: p.clock?.displayValue ?? null,
      text: text.slice(0, 200), scorer: who(scorer), passer: who(passer), dry });
    say(`TD  ${gameName}  ${text.slice(0, 90)}  -> ${scorer?.name || '?'}${passer ? ` (from ${passer.name})` : ''}`);
  }
  // Box score credits: one more touchdown for an athlete than last time.
  for (const a of athletes) {
    const key = `${eventId}:${a.id}`, was = boxTd.get(key);
    boxTd.set(key, a.td);
    if (was == null) { if (dry && a.td > 0) log({ feed: 'box', event: eventId, athlete: a.id, name: a.name, team: a.team, td: a.td, from: 0, sid: sidOfAthlete(a.id, a.name, a.team), dry }); continue; }   // first sight primes
    if (a.td > was) log({ feed: 'box', event: eventId, athlete: a.id, name: a.name, team: a.team, td: a.td, from: was, sid: sidOfAthlete(a.id, a.name, a.team) });
  }
}

async function pollSummary(ev) {
  const j = await getJson(`${ESPN}/summary?event=${ev.id}`, {}, 10000);
  readSummary(j, ev.id, ev.name);
}

async function pollSleeper() {
  const all = await getJson(`https://api.sleeper.app/v1/stats/nfl/regular/${SEASON}/${WEEK}`, {}, 15000);
  for (const [sid, st] of Object.entries(all)) {
    const n = tdOf(st), was = sleeperTd.get(sid);
    if (n === 0 && was == null) continue;
    sleeperTd.set(sid, n);
    if (!sleeperPrimed || was == null) continue;
    if (n > was) { const p = sleeperPlayers?.get(sid); log({ feed: 'sleeper', sid, name: p?.name || sid, team: p?.team || null, td: n, from: was, rostered: rosteredSids.has(sid) }); }
  }
  sleeperPrimed = true;
}

async function pollMfl() {
  const j = await getJson(`https://api.myfantasyleague.com/${SEASON}/export?TYPE=liveScoring&JSON=1&L=${LEAGUE}&W=${WEEK}&DETAILS=1`, {}, 15000);
  if (j.error) throw new Error(j.error.$t || JSON.stringify(j.error));
  for (const f of toArray(j.liveScoring?.franchise)) for (const p of toArray(f.players?.player)) {
    const pts = Number(p.score) || 0, was = mflPts.get(p.id);
    mflPts.set(p.id, pts);
    if (!mflPrimed || was == null) continue;
    if (pts - was >= 6) { const r = rostered.get(p.id); log({ feed: 'mfl', mflId: p.id, sid: r?.sid || null, name: r?.n || p.id, team: r?.tm || null, delta: Math.round((pts - was) * 100) / 100, starter: p.status === 'starter' }); }
  }
  mflPrimed = true;
}

/* ---------------- the summary ----------------
   Every touchdown play, with each feed's first sighting in seconds after
   the play's wall clock; then the median and the mean per feed. A credit is
   matched to the earliest play by that athlete that feed has not covered. */

function analyze(file) {
  const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const errors = rows.filter((r) => r.error);
  if (errors.length) console.log(`${errors.length} errors logged (${[...new Set(errors.map((r) => r.feed))].join(', ')}); the last: ${errors[errors.length - 1].error}`);
  const plays = rows.filter((r) => r.feed === 'pbp').map((r) => ({ ...r, seen: { pbp: r.t }, credit: {} }));
  const byPlay = new Map(plays.map((p) => [p.play, p]));
  for (const r of rows.filter((r) => r.feed === 'lastPlay' && r.scoring)) { const p = byPlay.get(r.play); if (p && !p.seen.lastPlay) p.seen.lastPlay = r.t; }
  const claim = (feed, match, t) => {
    const cands = plays.filter((p) => !p.credit[feed]?.done && match(p)).sort((a, b) => new Date(a.wallclock || a.t) - new Date(b.wallclock || b.t));
    const p = cands.find((x) => new Date(t) >= new Date(x.wallclock || x.t) - 60e3);
    if (p) p.credit[feed] = { t, done: true };
  };
  for (const r of rows) {
    if (r.feed === 'box') claim('box', (p) => p.event === r.event && (p.scorer?.id === r.athlete || p.passer?.id === r.athlete), r.t);
    if (r.feed === 'sleeper') claim('sleeper', (p) => (p.scorer?.sid && p.scorer.sid === r.sid) || (p.passer?.sid && p.passer.sid === r.sid), r.t);
    if (r.feed === 'mfl' && r.sid) claim('mfl', (p) => (p.scorer?.sid === r.sid) || (p.passer?.sid === r.sid), r.t);
  }
  const cols = ['pbp', 'lastPlay', 'box', 'sleeper', 'mfl'];
  const cell = (p, c) => { const t = c === 'pbp' || c === 'lastPlay' ? p.seen[c] : p.credit[c]?.t; const s = secs(t, p.wallclock); return s == null ? '   —' : String(s).padStart(4) + 's'; };
  console.log(`\n${plays.length} touchdown plays in ${path.basename(file)}; seconds after the play's wall clock (— = never seen; mfl covers rostered players only)\n`);
  console.log(['when (ET)  ', 'game     ', ...cols.map((c) => c.padStart(8)), '  scorer / play'].join(' '));
  const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  for (const p of plays.sort((a, b) => new Date(a.wallclock || a.t) - new Date(b.wallclock || b.t))) {
    console.log([ET.format(new Date(p.wallclock || p.t)).padEnd(11), String(p.game || '').padEnd(9), ...cols.map((c) => cell(p, c).padStart(8)),
      `  ${p.scorer?.name || '?'}${p.scorer?.rostered ? '*' : ''}: ${String(p.text).slice(0, 60)}`].join(' '));
  }
  const stat = (c) => {
    const xs = plays.map((p) => secs(c === 'pbp' || c === 'lastPlay' ? p.seen[c] : p.credit[c]?.t, p.wallclock)).filter((x) => x != null).sort((a, b) => a - b);
    if (!xs.length) return `${c}: no samples`;
    const med = xs[Math.floor(xs.length / 2)], mean = Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    return `${c}: median ${med}s, mean ${mean}s, n=${xs.length}`;
  };
  console.log('\n' + cols.map(stat).join('\n'));
  console.log('\n* = rostered in the league. pbp and lastPlay are sightings of the play itself; box, sleeper and mfl are the scorer (or passer) being credited.');
  console.log(`Polled every ${EVERY_S}s, so each column carries up to that much sampling delay; the differences between columns are what matter.`);
}

/* ---------------- main ---------------- */

async function main() {
  if (ANALYZE) { analyze(ANALYZE); return; }
  if (!SEASON || !WEEK) {
    try { const st = await getJson('https://api.sleeper.app/v1/state/nfl'); SEASON = SEASON || String(st.season); WEEK = WEEK || String(st.week); }
    catch (e) { say('Sleeper state unavailable:', e?.message || e); SEASON = SEASON || String(new Date().getFullYear()); WEEK = WEEK || '1'; }
  }
  say(`season ${SEASON} week ${WEEK}, every ${EVERY_S}s${MINUTES ? ` for ${MINUTES} minutes` : ' until Ctrl-C'} -> ${OUT}`);
  fs.appendFileSync(OUT, '');   // the file exists from the start, so a quiet run still has one to analyse
  await loadJoins();

  if (DRY) {
    // One finished game, read as if every play and credit arrived at once:
    // checks the play parsing, the scorer naming and the joins, not timing.
    const j = await getJson(`${ESPN}/summary?event=${DRY}`, {}, 15000);
    readSummary(j, DRY, j.header?.competitions?.[0]?.competitors?.map((c) => c.team?.abbreviation).join('@') || DRY, true);
    const rows = fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const tds = rows.filter((r) => r.feed === 'pbp');
    say(`${tds.length} touchdown plays; scorer named on ${tds.filter((r) => r.scorer).length}, Sleeper id for ${tds.filter((r) => r.scorer?.sid).length} scorers; ${rows.filter((r) => r.feed === 'box').length} athletes with a box-score touchdown`);
    for (const r of tds.filter((r) => !r.scorer)) say('  unnamed:', r.text.slice(0, 100));
    return;
  }

  const stopAt = MINUTES ? Date.now() + MINUTES * 60e3 : Infinity;
  const IDLE_MS = 25 * 60e3;   // once a game has been seen, stop this long after the last one ends: the late credits are in by then
  let loop = 0, stopping = false, sawGame = false, lastLiveAt = 0;
  process.on('SIGINT', () => { stopping = true; say('stopping'); });
  while (!stopping && Date.now() < stopAt) {
    const t0 = Date.now();
    let live = [];
    try { live = await pollScoreboard(); } catch (e) { log({ feed: 'scoreboard', error: String(e?.message || e) }); }
    if (live.length) { sawGame = true; lastLiveAt = Date.now(); }
    else if (sawGame && Date.now() - lastLiveAt > IDLE_MS) { say('no live game for 25 minutes, done'); break; }
    for (const ev of live) { try { await pollSummary(ev); } catch (e) { log({ feed: 'summary', event: ev.id, error: String(e?.message || e) }); } }
    try { await pollSleeper(); } catch (e) { log({ feed: 'sleeper', error: String(e?.message || e) }); }
    if (loop % Math.max(1, Math.round(30 / EVERY_S)) === 0) { try { await pollMfl(); } catch (e) { log({ feed: 'mfl', error: String(e?.message || e) }); } }
    if (loop % 30 === 0) say(`loop ${loop}: ${live.length} live game${live.length === 1 ? '' : 's'}${live.length ? ` (${live.map((g) => g.name).join(', ')})` : ''}, ${seenPlays.size} touchdown plays so far`);
    loop++;
    const wait = EVERY_S * 1000 - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  analyze(OUT);
}

main().catch((e) => { log({ feed: 'fatal', error: String(e?.stack || e) }); console.error(e); });
