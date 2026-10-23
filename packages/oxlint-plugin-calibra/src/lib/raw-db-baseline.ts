import type { Baseline } from "./rule-support.ts";

// Grandfathered references to the global `db` in apps/api/src/routes, as exact
// per-file counts (see rules/no-raw-db-in-routes.ts). A file may not gain one,
// and a count above the file's real number of references fails too: lower or
// delete the entry in the change that migrates the handlers to forOrg.
// The portal routes (portal*.ts) are migrated and have no entry.
export const RAW_DB_BASELINE: Baseline = new Map<string, number>([
  ["apps/api/src/routes/api-keys.ts", 7],
  ["apps/api/src/routes/email-domains.ts", 3],
  ["apps/api/src/routes/integrations.ts", 20],
  ["apps/api/src/routes/invitations.ts", 4],
  ["apps/api/src/routes/jobs.ts", 19],
  ["apps/api/src/routes/lab-setup.ts", 3],
  ["apps/api/src/routes/legal-metrology-regulations.ts", 1],
  ["apps/api/src/routes/magic-link.ts", 3],
  ["apps/api/src/routes/notifications.ts", 10],
  ["apps/api/src/routes/organization-lifecycle.ts", 1],
  ["apps/api/src/routes/organization-media.ts", 4],
  ["apps/api/src/routes/profile-media.ts", 1],
  ["apps/api/src/routes/public-api-v2/assets-create.ts", 5],
  ["apps/api/src/routes/public-api-v2/assets-read.ts", 3],
  ["apps/api/src/routes/public-api-v2/assets-update.ts", 7],
  ["apps/api/src/routes/public-api-v2/certificates.ts", 4],
  ["apps/api/src/routes/public-api-v2/customers.ts", 10],
  ["apps/api/src/routes/public-api-v2/jobs-decisions.ts", 1],
  ["apps/api/src/routes/public-api-v2/jobs-read.ts", 3],
  ["apps/api/src/routes/public-api-v2/reports.ts", 17],
  ["apps/api/src/routes/public-api-v2/requests-read.ts", 4],
  ["apps/api/src/routes/public-api-v2/requests-write.ts", 9],
  ["apps/api/src/routes/public-api-v2/resolvers.ts", 1],
  ["apps/api/src/routes/public-api-v2/services.ts", 3],
  ["apps/api/src/routes/public-api-v2/units.ts", 2],
  ["apps/api/src/routes/public-api-v2/webhooks.ts", 8],
  ["apps/api/src/routes/public-api.ts", 6],
  ["apps/api/src/routes/public-signup.ts", 4],
  ["apps/api/src/routes/sessions.ts", 2],
  ["apps/api/src/routes/sso.ts", 5],
  ["apps/api/src/routes/webhooks.ts", 1],
]);
