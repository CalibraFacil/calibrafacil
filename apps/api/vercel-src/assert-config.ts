import { loadApiConfig } from "@calibra-facil/config";
import { assertRlsStartup } from "@calibra-facil/db/rls-startup";

// Imported FIRST by every Vercel function entry (index, queue consumer, cron),
// so the configuration is validated when the function cold-starts, before the
// application graph loads: a bad deploy fails here with one error that lists
// every problem, not at first use deep inside a request.
loadApiConfig();
// The same start-up check as the Bun entry: with DATABASE_RLS_MODE=shadow (the
// default) a cold start as a role that row-level security binds fails here, not
// with empty results later (migration 0121; DEPLOYMENT.md, "Row-level security").
await assertRlsStartup();
