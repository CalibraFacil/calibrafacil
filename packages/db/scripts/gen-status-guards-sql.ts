// Prints the generated status guards (function blocks and triggers) of every
// column in STATUS_GUARDED_COLUMNS:
//   pnpm --filter @calibra-facil/db gen:status-guards-sql
// Paste the output into the new migration and into sql/schema-extras.sql.
import { statusGuardsSql } from "../src/status-guard-sql";
import { STATUS_GUARDED_COLUMNS } from "../src/status-machines";

console.log(statusGuardsSql(STATUS_GUARDED_COLUMNS));
