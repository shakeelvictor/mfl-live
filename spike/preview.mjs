// One local command for every state the page can wear: the playoff rounds,
// the Fantasy Bowl and the Pro Bowl, each final and mid-game, the regular
// season, the holidays, both themes. Dev only; nothing here reaches Netlify.
//
//   node spike/preview.mjs            -> http://localhost:8770/preview
//   PORT=9000 node spike/preview.mjs  (the mid-game server takes PORT+1, or LIVE_PORT)
//
// Two dev servers on the 2025 archive: one as MFL has it (every week final),
// one with Weeks 15-18 staged mid-game (spike/fake-round.mjs: the week's two
// latest games put back on the field). Both serve the preview page, which
// links to the right one for each state. A week not staged yet is staged
// here on first run (it asks MFL for the week's schedule, so it needs the
// network once); the staged files are kept in spike/data (gitignored).

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const ROOT = path.join(HERE, '..');
const PORT = Number(process.env.PORT) || 8770;
const LIVE_PORT = Number(process.env.LIVE_PORT) || PORT + 1;
const LIVE_DIR = path.join(HERE, 'data', 'preview-live');

// Stage Weeks 15-18 mid-game, then gather them into one directory: the fake
// files are named by week, so one server can serve all four.
fs.mkdirSync(LIVE_DIR, { recursive: true });
for (const w of [15, 16, 17, 18]) {
  const dir = path.join(HERE, 'data', `fake-w${w}`);
  const files = [`liveScoring-w${w}.json`, `nflSchedule-w${w}.json`];
  if (!files.every((f) => fs.existsSync(path.join(dir, f)))) {
    console.log(`staging Week ${w} mid-game...`);
    const r = spawnSync(process.execPath, [path.join(HERE, 'fake-round.mjs'), String(w)], { stdio: 'inherit', cwd: ROOT });
    if (r.status !== 0) { console.error(`could not stage Week ${w}; its mid-game links will show MFL's final instead`); continue; }
  }
  for (const f of files) fs.copyFileSync(path.join(dir, f), path.join(LIVE_DIR, f));
}

const kids = [];
const start = (port, env, label) => {
  const kid = spawn(process.execPath, [path.join(ROOT, 'dev.mjs')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, PORT: String(port), MFL_SEASON: '2025', PREVIEW_LIVE_PORT: String(LIVE_PORT), ...env },
  });
  kid.stdout.on('data', (d) => process.stdout.write(`[${label}] ${d}`));
  kid.on('exit', (code) => { if (code) console.error(`[${label}] exited ${code}`); });
  kids.push(kid);
};
start(PORT, {}, 'final');
start(LIVE_PORT, { MFL_FAKE_DIR: LIVE_DIR }, 'mid-game');

setTimeout(() => console.log(`\npreview: http://localhost:${PORT}/preview\n`), 400);
const stop = () => { for (const k of kids) k.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
