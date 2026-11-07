import { db } from "@calibra-facil/db";
import {
  appQueueJob,
  customer,
  customerAuditLog,
  organization,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { withStatusRepair } from "../../test/integration/state-fixtures";
import { notFound } from "./domain-errors";
import { withOrg } from "./org-context";

const LAB = "org-ctx";
const ACTOR = { userId: `user-${LAB}`, ipAddress: "203.0.113.7" };

async function seedCustomer(): Promise<number> {
  await withStatusRepair((tx) =>
    tx.insert(organization).values({
      id: "client-ctx",
      name: "Client",
      slug: "client-ctx",
      type: "CLIENT",
      status: "ACTIVE",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
  );
  const [row] = await db
    .insert(customer)
    .values({
      name: "Antes",
      authOrganizationId: "client-ctx",
      labOrganizationId: LAB,
    })
    .returning({ id: customer.id });
  if (!row) throw new Error("seedCustomer failed");
  return row.id;
}

describe("withOrg", () => {
  beforeEach(async () => {
    // Jobs travel through app_queue_job, as in production.
    vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
    await truncateAll();
    await seedOrg({ orgId: LAB });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("commits the change, its audit row and its queued job together, then runs the after-commit work", async () => {
    const id = await seedCustomer();
    const order: string[] = [];

    await withOrg(LAB, ACTOR, async (ctx) => {
      await ctx.o
        .update(customer)
        .set({ name: "Depois" })
        .where(eq(customer.id, id));
      await ctx.audit("customer", id, {
        action: "update",
        changes: { name: "Depois" },
      });
      await ctx.emit({ type: "SPC_RECOMPUTE" });
      ctx.afterCommit(() => {
        order.push("after-commit");
      });
      order.push("in-transaction");
    });

    expect(order).toEqual(["in-transaction", "after-commit"]);
    const [audit] = await db
      .select()
      .from(customerAuditLog)
      .where(eq(customerAuditLog.customerId, id));
    expect(audit).toMatchObject({
      organizationId: LAB,
      action: "update",
      performedBy: ACTOR.userId,
      ipAddress: ACTOR.ipAddress,
    });
    const jobs = await db.select().from(appQueueJob);
    expect(jobs.map((job) => job.type)).toContain("SPC_RECOMPUTE");
  });

  it("a thrown error rolls back the change, its audit row and its job, and skips the after-commit work", async () => {
    const id = await seedCustomer();
    let ran = false;

    await expect(
      withOrg(LAB, ACTOR, async (ctx) => {
        await ctx.o
          .update(customer)
          .set({ name: "Depois" })
          .where(eq(customer.id, id));
        await ctx.audit("customer", id, { action: "update" });
        await ctx.emit({ type: "SPC_RECOMPUTE" });
        ctx.afterCommit(() => {
          ran = true;
        });
        throw notFound("customer_not_found", "Cliente nao encontrado");
      }),
    ).rejects.toMatchObject({ status: 404 });

    expect(ran).toBe(false);
    const [row] = await db.select().from(customer).where(eq(customer.id, id));
    expect(row?.name).toBe("Antes");
    expect(
      await db
        .select()
        .from(customerAuditLog)
        .where(eq(customerAuditLog.customerId, id)),
    ).toEqual([]);
    expect(await db.select().from(appQueueJob)).toEqual([]);
  });

  it("an after-commit failure is logged, not thrown at the committed caller", async () => {
    const id = await seedCustomer();
    const result = await withOrg(LAB, ACTOR, async (ctx) => {
      await ctx.o
        .update(customer)
        .set({ name: "Depois" })
        .where(eq(customer.id, id));
      ctx.afterCommit(() => {
        throw new Error("smtp down");
      });
      return "ok";
    });
    expect(result).toBe("ok");
  });
});
