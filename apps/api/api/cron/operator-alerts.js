import { GET } from "../../vercel-functions/cron/operator-alerts.js";

export { GET };

// Direct default export: Vercel's Bun runtime no longer follows a re-exported
// default (`export { default } from …`) and rejects it at cold start.
export default { fetch: GET };
