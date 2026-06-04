import { GET } from "../../vercel-functions/cron/dispatch.js";

export { GET };

// One dynamic function for every /api/cron/* path (the vercel.json crons hit
// /api/cron/{integrations,notifications,operator-alerts}); dispatch.js routes on
// the path segment. Direct default export — Vercel's Bun runtime no longer
// follows a re-exported default (see api/index.js).
export default { fetch: GET };
