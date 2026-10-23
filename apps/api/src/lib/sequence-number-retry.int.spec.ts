/**
 * sequence-number-retry.int.spec.ts - P2-18d [HIGH RISK].
 *
 * CAPA and NC numbers are sequential per laboratory and year; two creators that
 * read the same last number collide on the unique index. The retry loop must
 * recognise the violation Drizzle wraps (`Failed query: ...`, SQLSTATE 23505 in
 * `.cause`) and try again with the next number, on the org-scoped path (each
 * attempt a savepoint of the caller's transaction) and on the plain `db` path.
 *
 *   REQ-18D-SEQ-1  n concurrent CAPA creators through orgDb(lab).transaction all
 *                  succeed with distinct numbers.
 *   REQ-18D-SEQ-2  Same for NC.
 *   REQ-18D-SEQ-3  Same on the plain `db` path (no handle), both libs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { correctiveAction, nonConformance } from "@calibra-facil/db/schema";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { createCorrectiveActionRecord } from "./corrective-actions";
import { createNonConformanceRecord } from "./non-conformances";
import { orgDb } from "./org-db";

vi.mock("@calibra-facil/notifications", () => ({
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
}));

const CONCURRENT = 3;

function capaParams(orgId: string, userId: string, index: number) {
  return {
    organizationId: orgId,
    actorUserId: userId,
    source: "internal_audit" as const,
    title: `CAPA concorrente ${index}`,
    description: "Criação concorrente",
  };
}

function ncParams(orgId: string, userId: string, index: number) {
  return {
    organizationId: orgId,
    actorUserId: userId,
    type: "work" as const,
    description: `NC concorrente ${index}`,
    detectedAt: new Date(),
  };
}

describe("sequential numbers under concurrent creators (P2-18d)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-18D-SEQ-1: concurrent CAPA creators through the org-scoped path all get distinct numbers", async () => {
    const org = await seedOrg({ orgId: "org-a" });
    const created = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, index) =>
        orgDb(org.orgId).transaction((tx) =>
          createCorrectiveActionRecord(
            capaParams(org.orgId, org.userId, index),
            tx,
          ),
        ),
      ),
    );

    const numbers = created.map((row) => row.capaNumber);
    expect(new Set(numbers).size).toBe(CONCURRENT);
    const stored = await db
      .select({ id: correctiveAction.id })
      .from(correctiveAction)
      .where(eq(correctiveAction.organizationId, org.orgId));
    expect(stored).toHaveLength(CONCURRENT);
  });

  it("REQ-18D-SEQ-2: concurrent NC creators through the org-scoped path all get distinct numbers", async () => {
    const org = await seedOrg({ orgId: "org-a" });
    const created = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, index) =>
        orgDb(org.orgId).transaction((tx) =>
          createNonConformanceRecord(ncParams(org.orgId, org.userId, index), {
            executor: tx,
            afterCommit: () => undefined,
          }),
        ),
      ),
    );

    const numbers = created.map((row) => row.ncNumber);
    expect(new Set(numbers).size).toBe(CONCURRENT);
    const stored = await db
      .select({ id: nonConformance.id })
      .from(nonConformance)
      .where(eq(nonConformance.organizationId, org.orgId));
    expect(stored).toHaveLength(CONCURRENT);
  });

  it("REQ-18D-SEQ-3: the plain `db` path retries the same way, for both libs", async () => {
    const org = await seedOrg({ orgId: "org-a" });
    const capas = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, index) =>
        createCorrectiveActionRecord(capaParams(org.orgId, org.userId, index)),
      ),
    );
    const ncs = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, index) =>
        createNonConformanceRecord(ncParams(org.orgId, org.userId, index)),
      ),
    );

    expect(new Set(capas.map((row) => row.capaNumber)).size).toBe(CONCURRENT);
    expect(new Set(ncs.map((row) => row.ncNumber)).size).toBe(CONCURRENT);
  });
});
