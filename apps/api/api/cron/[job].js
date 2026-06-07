import { GET } from "../../vercel-functions/cron/dispatch.js";

export { GET };

// One dynamic function for every /api/cron/* path (the vercel.json crons hit
// /api/cron/{integrations,notifications,operator-alerts}); dispatch.js routes on
// the path segment. Wrap the imported handler in a locally-declared fetch so the
// Vercel-managed Bun runtime accepts the default export (see api/index.js).
export default { fetch: (request) => GET(request) };
