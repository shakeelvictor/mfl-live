// Local dev server: serves app/ and answers /api/mfl with the same handler
// the Netlify function uses, so the page runs against the real league here.
//
//   node dev.mjs            -> http://localhost:8770/
//   PORT=9000 node dev.mjs
//
// Environment: MFL_UA (defaults to the registered client, see server/mfl.mjs),
// MFL_SEASON, MFL_LEAGUE. A .env file in the repo root is read if present.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, 'app');

// Minimal .env: KEY=VALUE lines, no quoting rules, never overrides the shell.
try {
  for (const line of fs.readFileSync(path.join(import.meta.dirname, '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2];
  }
} catch {}

const { handleMfl } = await import('./server/mfl.mjs');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/mfl') {
    const r = await handleMfl(Object.fromEntries(url.searchParams));
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }

  // Static, confined to app/.
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',   // dev: always revalidate, so edits show up
  });
  fs.createReadStream(file).pipe(res);
});

const port = Number(process.env.PORT) || 8770;
server.listen(port, () => {
  console.log(`mfl-live dev server  http://localhost:${port}/   (league ${process.env.MFL_LEAGUE || '19716'}, season ${process.env.MFL_SEASON || '2026'})`);
});
