import { GET } from "../../vercel-functions/cron/dispatch.js";

export { GET };

// One dynamic function for every /api/cron/* path (integrations, notifications,
// portal-digest, operator-alerts, auth-maintenance, service-order-emails);
// dispatch.js routes on the path segment. A vercel.json rewrite excludes the
// cron subtree from the Hono catch-all so these paths reach this function.
// Wrap the imported handler in a locally-declared fetch so the Vercel-managed
// Bun runtime accepts the default export (see api/index.js).
export default { fetch: (request) => GET(request) };
