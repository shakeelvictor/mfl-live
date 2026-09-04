// Assembles the single-file build the Artifact needs.
//
//   node mockup/bundle.mjs            -> mockup/dist/leaderboard.html
//
// The Artifact CSP admits no local files, so styles.css, data.js and app.js
// are inlined back into index.html. Locally, index.html loads them by
// reference and is what the preview server serves; dist/ is gitignored.
// build-data.mjs calls this at the end, so a data refresh also rebundles.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = import.meta.dirname;

export function bundle() {
  const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');
  let html = read('index.html');

  // Images too: the header mark and the favicon become data: URIs, and the
  // larger icons (only a home-screen install would use them) are dropped.
  const dataUri = (f, type = 'image/png') => `data:${type};base64,${fs.readFileSync(path.join(HERE, f)).toString('base64')}`;
  const swaps = [
    ['<link rel="stylesheet" href="styles.css">', () => `<style>\n${read('styles.css')}</style>`],
    ['src="logo.png"', () => `src="${dataUri('logo.png')}"`],
    ['src="loader.webp"', () => `src="${dataUri('loader.webp', 'image/webp')}"`],
    ['href="favicon-32.png?v=2"', () => `href="${dataUri('favicon-32.png')}"`],
    ['<link rel="icon" type="image/png" sizes="192x192" href="favicon-192.png?v=2">\n', () => ''],
    ['<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png?v=2">\n', () => ''],
    ['<script src="data.js"></script>', () => `<script>\n${read('data.js')}</script>`],
    ['<script src="app.js"></script>', () => `<script>\n${read('app.js')}</script>`],
  ];
  for (const [tag, inline] of swaps) {
    // Fail loudly if index.html stops referencing a file; a bundle that
    // silently drops the script would look like a broken page, not a build error.
    if (!html.includes(tag)) throw new Error(`index.html no longer contains ${tag}`);
    html = html.replace(tag, inline());
  }

  const out = path.join(HERE, 'dist', 'leaderboard.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`bundled ${path.relative(process.cwd(), out)}  ${(html.length / 1024).toFixed(0)}KB`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) bundle();
