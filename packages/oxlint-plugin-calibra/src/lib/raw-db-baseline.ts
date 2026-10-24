import type { Baseline } from "./rule-support.ts";

// Grandfathered references to the global `db` in apps/api/src/routes, as exact
// per-file counts (see rules/no-raw-db-in-routes.ts). A file may not gain one,
// and a count above the file's real number of references fails too: lower or
// delete the entry in the change that migrates the handlers to forOrg.
// The portal routes (portal*.ts) are migrated and have no entry.
export const RAW_DB_BASELINE: Baseline = new Map<string, number>([
  ["apps/api/src/routes/email-domains.ts", 3],
  ["apps/api/src/routes/invitations.ts", 4],
  ["apps/api/src/routes/lab-setup.ts", 3],
  ["apps/api/src/routes/legal-metrology-regulations.ts", 1],
  ["apps/api/src/routes/magic-link.ts", 3],
  ["apps/api/src/routes/organization-lifecycle.ts", 1],
  ["apps/api/src/routes/organization-media.ts", 4],
  ["apps/api/src/routes/profile-media.ts", 1],
  ["apps/api/src/routes/public-signup.ts", 4],
  ["apps/api/src/routes/sessions.ts", 2],
  ["apps/api/src/routes/sso.ts", 5],
]);
