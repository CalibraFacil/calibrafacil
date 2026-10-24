import type { Baseline } from "./rule-support.ts";

// Grandfathered references to the global `db` in apps/api/src/routes, as exact
// per-file counts (see rules/no-raw-db-in-routes.ts). A file may not gain one,
// and a count above the file's real number of references fails too: lower or
// delete the entry in the change that migrates the handlers to forOrg.
// Empty since P2-18j: every route is migrated (the portal routes in P2-18a, the
// rest in P2-18c to P2-18j). A route that needs a statement outside an organization
// calls a named lib function (identity, system path), never the raw handle.
export const RAW_DB_BASELINE: Baseline = new Map<string, number>([]);
