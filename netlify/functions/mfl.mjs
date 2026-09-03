// Netlify Function: GET /api/mfl?type=...  ->  server/mfl.mjs
// Set MFL_UA (and optionally MFL_SEASON, MFL_LEAGUE) in the site's
// environment; see server/mfl.mjs for what each type returns.

import { handleMfl } from '../../server/mfl.mjs';

export default async (req) => {
  const query = Object.fromEntries(new URL(req.url).searchParams);
  const r = await handleMfl(query);
  return new Response(r.body, { status: r.status, headers: r.headers });
};

export const config = { path: '/api/mfl' };
