/**
 * automatic-send-audit-reason.int.spec.ts: the reason stored in
 * `automatic_send_audit_log` when the financial send throws.
 *
 * The audit table is readable by the laboratory; a failed query's message
 * carries the SQL and its bound row values, so the stored reason is the
 * scrubbed message: the statement stays, the values do not.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import {
  automaticSendAuditLog,
  automaticSendRule,
} from "@calibra-facil/db/schema";
import { truncateAll } from "../../../test/integration/db";
import {
  seedBillableOrder,
  seedBillingLab,
} from "../../../test/integration/billing-fixtures";
import { triggerAutomaticSendForMilestone } from "./automatic-send";

beforeEach(async () => {
  await truncateAll();
});

describe("triggerAutomaticSendForMilestone when the send throws", () => {
  it("stores the failure with the bound values scrubbed out of the reason", async () => {
    const lab = await seedBillingLab("lab-autosend-reason");
    const serviceOrderId = await seedBillableOrder(lab, { number: "OS-1" });
    await db.insert(automaticSendRule).values({
      organizationId: lab.orgId,
      milestone: "certificate_approved",
    });

    const result = await triggerAutomaticSendForMilestone({
      event: {
        event: "certificate_approved",
        organizationId: lab.orgId,
        serviceOrderId,
      },
      actorUserId: lab.userId,
      invoker: () =>
        Promise.reject(
          new Error(
            'Failed query: insert into "billing_document" ("customer_name") values ($1)\nparams: Maria Silva,maria@example.com',
          ),
        ),
    });

    expect(result.outcome).toBe("failed");
    const [row] = await db.select().from(automaticSendAuditLog);
    expect(row?.outcome).toBe("failed");
    expect(row?.reason).toContain('insert into "billing_document"');
    expect(row?.reason).not.toContain("Maria Silva");
    expect(row?.reason).not.toContain("maria@example.com");
    expect(result.reason).toBe(row?.reason);
  });
});
