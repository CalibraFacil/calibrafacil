import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The multi-column lifecycle invariants of migration 0141: the migration adds
// each CHECK (NOT VALID) and sql/schema-extras.sql carries it for new databases.
const CONSTRAINTS = [
  "service_order_closed_xor_canceled",
  "service_order_quote_single_approver",
  "service_order_email_outbox_processed_xor_dead_letter",
  "oot_email_outbox_processed_xor_dead_letter",
  "organization_signing_certificate_revoked_inactive",
  "organization_signing_certificate_default_active",
];

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("lifecycle invariants (migration 0141)", () => {
  it("the migration adds every constraint NOT VALID and schema-extras carries it", () => {
    const migration = read("../drizzle/0141_lifecycle_invariants.sql");
    const extras = read("../sql/schema-extras.sql");
    for (const name of CONSTRAINTS) {
      expect(migration).toMatch(
        new RegExp(`ADD CONSTRAINT ${name} CHECK \\(.+\\) NOT VALID;`),
      );
      expect(extras).toMatch(new RegExp(`ADD CONSTRAINT ${name} CHECK \\(`));
    }
  });
});
