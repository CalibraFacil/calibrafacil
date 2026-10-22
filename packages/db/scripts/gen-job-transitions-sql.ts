// Prints the generated calibration_job status guard (the function block) from
// packages/schemas/src/job-transitions.ts:
//   pnpm --filter @calibra-facil/db gen:job-transitions-sql
// Paste it into the new migration and into sql/schema-extras.sql.
import { jobTransitionsSqlBlock } from "../src/job-transitions-sql";

console.log(jobTransitionsSqlBlock());
