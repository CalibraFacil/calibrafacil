// Prints the generated row-level-security block (the per-table ENABLE ROW LEVEL
// SECURITY + tenant_isolation policy) from src/tenancy.ts and the schema:
//   pnpm --filter @calibra-facil/db gen:rls-sql
// Paste it into the new migration and into sql/schema-extras.sql.
import { rlsSqlBlock } from "../src/rls-sql";

console.log(rlsSqlBlock());
