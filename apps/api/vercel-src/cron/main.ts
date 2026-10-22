import "../assert-config";
import { GET } from "./dispatch";

// The entry of the Vercel cron function (built to
// vercel-functions/cron/dispatch.js). The configuration is validated when the
// function cold-starts (assert-config.ts, imported first). dispatch.ts stays
// free of the check because the Bun entry (src/bun.ts) imports it too and
// validates the environment itself.
export { GET };
