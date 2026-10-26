/**
 * sync-push-scope.int.spec.ts: who may reach POST /api/sync/push at all, and under
 * which unit role (P0-2 follow-ups), against real Postgres and the real permission
 * middleware (only the Better Auth sessions, the queue and notifications are faked).
 *
 *   REQ-SYNC-RBAC-5  the unit role is the member's role in the EVENT's unit, not in the
 *                    active one (the desktop sends no x-active-unit-id header)
 *   REQ-SYNC-RBAC-6  a CLIENT-organization session and a portal session are refused
 *   REQ-SYNC-RBAC-7  a retry of an event that was applied is acknowledged after a role
 *                    downgrade; a new event of the same operation is denied
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  member,
  memberUnitAssignment,
  organizationEventLog,
  organizationUnit,
  syncAppliedEvent,
} from "@calibra-facil/db/schema";
import { syncPushResponseSchema } from "@calibra-facil/contracts";
import { loginAs, loginAsPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import {
  seedCustomer,
  seedOrg,
  seedPortalContext,
} from "../../test/integration/seed";
import {
  seedLab,
  seedMember,
  seedUser,
} from "../../test/integration/identity-fixtures";
import { syncRouter } from "./sync";

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobSubmittedForReview: vi.fn().mockResolvedValue(undefined),
  notifyJobApproved: vi.fn().mockResolvedValue(undefined),
  notifyJobRejected: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyCertificateAmended: vi.fn().mockResolvedValue(undefined),
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const LAB = "org-scope";
const USER = "user-scope";

/** A lab with two units, "Alfa" (sorts first: the desktop's active unit) and "Matriz". */
async function seedTwoUnitLab(role: "member" | "operator") {
  const org = await seedOrg({ orgId: LAB, userId: USER, role });
  const [alfa] = await db
    .insert(organizationUnit)
    .values({
      organizationId: LAB,
      name: "Alfa",
      slug: "alfa",
      status: "ACTIVE",
      isDefault: false,
      createdBy: USER,
    })
    .returning({ id: organizationUnit.id });
  if (!alfa) throw new Error("seed: unit missing");
  const customerId = await seedCustomer({
    labOrganizationId: LAB,
    name: "Cliente",
  });
  const [type] = await db
    .insert(assetType)
    .values({ name: "Tipo", slug: "tipo-scope", definition: [] })
    .returning({ id: assetType.id });
  return {
    org,
    alfaId: alfa.id,
    matrizId: org.unitId,
    customerId,
    assetTypeId: type?.id ?? 0,
  };
}

type World = Awaited<ReturnType<typeof seedTwoUnitLab>>;

function assetEvent(
  world: World,
  eventId: string,
  unitId: number | null,
  tag: string,
) {
  return {
    eventId,
    entityType: "asset",
    entityId: `local-${eventId}`,
    operation: "create_local_asset",
    payload: {
      customerId: world.customerId,
      assetTypeId: world.assetTypeId,
      name: `Ativo ${tag}`,
      serialNumber: `SN-${tag}`,
      tag,
    },
    occurredAt: new Date().toISOString(),
    actorUserId: USER,
    organizationId: LAB,
    unitId,
    idempotencyKey: `idem-${eventId}`,
    localVersion: 0,
  };
}

/** The desktop's push: NO x-active-unit-id header. */
async function pushWithoutUnitHeader(events: Array<Record<string, unknown>>) {
  loginAs({ userId: USER, organizationId: LAB });
  const res = await syncRouter.request("/push", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      deviceId: "device-scope",
      clientBatchId: "batch-scope",
      baseCursor: null,
      protocolVersion: 4,
      events,
    }),
  });
  expect(res.status).toBe(200);
  const body = syncPushResponseSchema.parse(await res.json());
  return {
    codeOf: (eventId: string) =>
      body.rejected.find((item) => item.eventId === eventId)?.code ?? null,
    accepted: (eventId: string) =>
      body.accepted.some((item) => item.eventId === eventId),
  };
}

async function auditedEventIds() {
  const rows = await db
    .select({ details: organizationEventLog.details })
    .from(organizationEventLog);
  return rows.flatMap((row) => {
    const eventId = row.details?.eventId;
    return typeof eventId === "string" ? [eventId] : [];
  });
}

describe("REQ-SYNC-RBAC-5: the unit role is the one of the event's unit", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("allows an event in the unit where the member is technician and denies it in the unit where they are a plain member", async () => {
    const world = await seedTwoUnitLab("member");
    await db.insert(memberUnitAssignment).values([
      {
        organizationId: LAB,
        memberId: world.org.memberId,
        unitId: world.alfaId,
        role: "technician",
      },
      {
        organizationId: LAB,
        memberId: world.org.memberId,
        unitId: world.matrizId,
        role: "member",
      },
    ]);

    // No header: the active unit is Alfa (first by name), where the member is a technician.
    const pushed = await pushWithoutUnitHeader([
      assetEvent(world, "evt-in-alfa", world.alfaId, "TAG-ALFA"),
      assetEvent(world, "evt-in-matriz", world.matrizId, "TAG-MATRIZ"),
      assetEvent(world, "evt-no-unit", null, "TAG-NONE"),
    ]);

    expect(pushed.codeOf("evt-in-alfa")).toBeNull();
    expect(pushed.accepted("evt-in-alfa")).toBe(true);
    expect(pushed.codeOf("evt-in-matriz")).toBe("SYNC_PERMISSION_DENIED");
    expect(pushed.accepted("evt-in-matriz")).toBe(false);
    // An event naming no unit is applied to the active unit (Alfa) and judged by it.
    expect(pushed.accepted("evt-no-unit")).toBe(true);

    // Nothing was written for the denied one: no asset, no claim, no audit row.
    expect(
      await db
        .select({ id: asset.id })
        .from(asset)
        .where(eq(asset.tag, "TAG-MATRIZ")),
    ).toEqual([]);
    expect(
      await db
        .select({ id: syncAppliedEvent.id })
        .from(syncAppliedEvent)
        .where(eq(syncAppliedEvent.eventId, "evt-in-matriz")),
    ).toEqual([]);
    expect(await auditedEventIds()).not.toContain("evt-in-matriz");
    expect(await auditedEventIds()).toContain("evt-in-alfa");
  });

  it("is judged the other way round when the active unit is the one where the member has no elevation", async () => {
    const world = await seedTwoUnitLab("member");
    await db.insert(memberUnitAssignment).values([
      {
        organizationId: LAB,
        memberId: world.org.memberId,
        unitId: world.alfaId,
        role: "member",
      },
      {
        organizationId: LAB,
        memberId: world.org.memberId,
        unitId: world.matrizId,
        role: "technician",
      },
    ]);

    // The active unit is still Alfa (a plain member): Matriz's technician role applies to Matriz events.
    const pushed = await pushWithoutUnitHeader([
      assetEvent(world, "evt-alfa", world.alfaId, "TAG-A"),
      assetEvent(world, "evt-matriz", world.matrizId, "TAG-M"),
    ]);

    expect(pushed.codeOf("evt-alfa")).toBe("SYNC_PERMISSION_DENIED");
    expect(pushed.accepted("evt-matriz")).toBe(true);
  });
});

describe("REQ-SYNC-RBAC-6: only a LAB organization's lab session may push", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function rawPush() {
    return syncRouter.request("/push", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        deviceId: "device-x",
        clientBatchId: "batch-x",
        baseCursor: null,
        events: [],
      }),
    });
  }

  it("refuses a session whose active organization is a CLIENT organization, whatever its role", async () => {
    await seedUser("user-client");
    await seedLab("org-client", "CLIENT");
    await seedMember("org-client", "user-client", new Date(), "admin");
    loginAs({ userId: "user-client", organizationId: "org-client" });

    expect((await rawPush()).status).toBe(403);
  });

  it("refuses a portal session (the lab sessions are the only ones this route reads)", async () => {
    const portal = await seedPortalContext();
    loginAsPortal({
      userId: portal.portalUserId,
      organizationId: portal.clientOrgId,
    });

    expect((await rawPush()).status).toBe(401);
  });
});

describe("REQ-SYNC-RBAC-7: a retry of an applied event after a role downgrade", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("is acknowledged, while a new event of the same operation is denied", async () => {
    const world = await seedTwoUnitLab("operator");
    const applied = assetEvent(world, "evt-applied", world.matrizId, "TAG-1");
    expect(
      (await pushWithoutUnitHeader([applied])).accepted("evt-applied"),
    ).toBe(true);

    await db
      .update(member)
      .set({ role: "member" })
      .where(and(eq(member.id, world.org.memberId)));

    const retried = await pushWithoutUnitHeader([
      applied,
      assetEvent(world, "evt-new", world.matrizId, "TAG-2"),
    ]);

    expect(retried.codeOf("evt-applied")).toBeNull();
    expect(retried.accepted("evt-applied")).toBe(true);
    expect(retried.codeOf("evt-new")).toBe("SYNC_PERMISSION_DENIED");
  });
});
