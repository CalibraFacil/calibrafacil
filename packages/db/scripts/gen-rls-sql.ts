// Prints a generated SQL block of the tenancy / evidence classification:
//   pnpm --filter @calibra-facil/db gen:rls-sql            the row-level-security block
//                                                          (ENABLE ROW LEVEL SECURITY + tenant_isolation policy)
//   pnpm --filter @calibra-facil/db gen:rls-sql evidence   the evidence grants block
//                                                          (REVOKE UPDATE/DELETE/TRUNCATE on the evidence tables)
// Paste it into the new migration and into sql/schema-extras.sql.
import { evidenceGrantsBlock, rlsSqlBlock } from "../src/rls-sql";

console.log(
  process.argv[2] === "evidence" ? evidenceGrantsBlock() : rlsSqlBlock(),
);
