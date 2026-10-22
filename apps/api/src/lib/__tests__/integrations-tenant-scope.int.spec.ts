import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import {
  integrationEventLog,
  organizationIntegration,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { markContaAzulReconnectRequired } from "../../modules/integrations";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";

// REQ-TENANT-SQL-001 (tenant SQL guard finding): markContaAzulReconnectRequired
// takes an organizationId but used to update the integration by id alone, so a
// caller handing it another tenant's integration id flipped THAT tenant's
// integration to ACTION_REQUIRED. The write is now organization-scoped.

async function seedContaAzulIntegration(orgId: string, userId: string) {
  const id = `int-${orgId}`;
  await db.insert(organizationIntegration).values({
    id,
    organizationId: orgId,
    type: "financial_erp",
    provider: "conta_azul",
    name: "Conta Azul",
    status: "ACTIVE",
    createdBy: userId,
    updatedBy: userId,
  });
  return id;
}

async function statusOf(integrationId: string) {
  const [row] = await db
    .select({ status: organizationIntegration.status })
    .from(organizationIntegration)
    .where(eq(organizationIntegration.id, integrationId));
  return row?.status;
}

describe("markContaAzulReconnectRequired — tenant scope", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-TENANT-SQL-001: flags the caller's own integration", async () => {
    const orgA = await seedOrg({ orgId: "org-a" });
    const integrationId = await seedContaAzulIntegration(
      orgA.orgId,
      orgA.userId,
    );

    await markContaAzulReconnectRequired({
      integrationId,
      organizationId: orgA.orgId,
      message: "reconnect",
    });

    expect(await statusOf(integrationId)).toBe("ACTION_REQUIRED");
    const events = await db
      .select({ id: integrationEventLog.id })
      .from(integrationEventLog)
      .where(eq(integrationEventLog.integrationId, integrationId));
    expect(events).toHaveLength(1);
  });

  it("REQ-TENANT-SQL-001: leaves another tenant's integration untouched", async () => {
    const orgA = await seedOrg({ orgId: "org-a" });
    const orgB = await seedOrg({ orgId: "org-b" });
    const foreignId = await seedContaAzulIntegration(orgB.orgId, orgB.userId);

    // The follow-up event insert is rejected by the composite
    // (integration_id, organization_id) FK; only the foreign row's state matters.
    await markContaAzulReconnectRequired({
      integrationId: foreignId,
      organizationId: orgA.orgId,
      message: "reconnect",
    }).catch(() => undefined);

    expect(await statusOf(foreignId)).toBe("ACTIVE");
  });
});
