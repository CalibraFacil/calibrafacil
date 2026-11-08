/**
 * sync-operation-permissions.int.spec.ts: per-operation RBAC on the desktop push,
 * against real Postgres and the real permission middleware (only the Better Auth
 * session, the queue and the notifications are faked).
 *
 *   REQ-SYNC-RBAC-3  an event the member's role may not send (the online route of the
 *                    same operation denies it) is refused with SYNC_PERMISSION_DENIED,
 *                    a permanent code, and nothing is written for it
 *   REQ-SYNC-RBAC-4  an event the role may send is not refused for permission (it
 *                    applies, or fails on its own merits), and a batch carries both
 */
import { CURRENT_DESKTOP_BUILD } from "../../../../test/integration/desktop-build";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  organizationEventLog,
  serviceOrder,
  syncAppliedEvent,
} from "@calibra-facil/db/schema";
import {
  SYNC_COMMAND_OPERATIONS,
  classifyOutboxRejection,
  syncPushResponseSchema,
} from "@calibra-facil/contracts";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedCustomer, seedOrg } from "../../../../test/integration/seed";
import { syncRouter } from "./";
import { withStatusRepair } from "../../../../test/integration/state-fixtures";

vi.mock("../../../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("@calibra-facil/notifications", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
  notifyNonConformanceCreated: vi.fn().mockResolvedValue(undefined),
  notifyServiceOrderCreated: vi.fn().mockResolvedValue(undefined),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const LAB = "org-rbac";

type Role = "owner" | "admin" | "technician" | "operator" | "member";
const ROLES: readonly Role[] = [
  "owner",
  "admin",
  "technician",
  "operator",
  "member",
];

const FIELD: readonly Role[] = ["owner", "admin", "technician", "operator"];

/** The roles the ONLINE route of each operation lets through (hand-written). */
const ALLOWED: Record<string, readonly Role[]> = {
  create_local_asset: FIELD,
  save_local_execution: FIELD,
  submit_local_execution: FIELD,
  create_local_service_order_intake: ["owner", "admin", "operator", "member"],
  create_local_attachment: FIELD,
};

async function seedWorld(role: Role) {
  const org = await seedOrg({ orgId: LAB, userId: `user-${role}`, role });
  const customerId = await seedCustomer({
    labOrganizationId: org.orgId,
    name: "Cliente RBAC",
  });
  const [type] = await db
    .insert(assetType)
    .values({ name: "Tipo RBAC", slug: "tipo-rbac", definition: [] })
    .returning({ id: assetType.id });
  const [instrument] = await withStatusRepair((tx) =>
    tx
      .insert(asset)
      .values({
        labOrganizationId: org.orgId,
        unitId: org.unitId,
        customerId,
        assetTypeId: type?.id ?? 0,
        name: "Instrumento RBAC",
        serialNumber: "SN-RBAC",
        tag: "TAG-RBAC",
      })
      .returning({ id: asset.id }),
  );
  return {
    org,
    userId: `user-${role}`,
    customerId,
    assetTypeId: type?.id ?? 0,
    assetId: instrument?.id ?? 0,
  };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

const ENTITY_TYPES: Record<string, string> = {
  create_local_asset: "asset",
  save_local_execution: "calibration_job",
  submit_local_execution: "calibration_job",
  create_local_service_order_intake: "service_order",
  create_local_attachment: "attachment",
};

/** Payloads that would apply for a permitted role where that is cheap to arrange. */
function payloadFor(world: World, operation: string): Record<string, unknown> {
  switch (operation) {
    case "create_local_asset":
      return {
        customerId: world.customerId,
        assetTypeId: world.assetTypeId,
        name: "Ativo offline",
        serialNumber: "SN-OFF-1",
        tag: "TAG-OFF-1",
      };
    case "create_local_service_order_intake":
      return {
        customerId: world.customerId,
        assetId: world.assetId,
        claimedDefect: "Nao liga",
        intakeCondition: "Riscos na carcaca",
      };
    default:
      return {};
  }
}

function eventFor(world: World, operation: string, index: number) {
  const eventId = `evt-rbac-${index}-${operation}`;
  return {
    eventId,
    entityType: ENTITY_TYPES[operation] ?? "unknown",
    entityId: `local-${index}`,
    operation,
    payload: payloadFor(world, operation),
    occurredAt: new Date().toISOString(),
    actorUserId: world.userId,
    organizationId: world.org.orgId,
    unitId: world.org.unitId,
    idempotencyKey: `idem-${eventId}`,
    localVersion: 0,
  };
}

async function pushBatch(world: World, operations: readonly string[]) {
  loginAs({ userId: world.userId, organizationId: world.org.orgId });
  const events = operations.map((operation, index) =>
    eventFor(world, operation, index),
  );
  const res = await syncRouter.request("/push", {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-active-unit-id": String(world.org.unitId) },
    body: JSON.stringify({
      deviceId: "device-rbac",
      clientBatchId: "batch-rbac",
      baseCursor: null,
      ...CURRENT_DESKTOP_BUILD,
      events,
    }),
  });
  expect(res.status).toBe(200);
  const body = syncPushResponseSchema.parse(await res.json());
  return {
    events,
    codeOf: (eventId: string) =>
      body.rejected.find((item) => item.eventId === eventId)?.code ?? null,
    accepted: new Set(body.accepted.map((item) => item.eventId)),
  };
}

describe("REQ-SYNC-RBAC-3/4: each desktop operation needs the right of its online route", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("the test table covers every operation of the protocol", () => {
    expect(Object.keys(ALLOWED).toSorted()).toEqual(
      SYNC_COMMAND_OPERATIONS.toSorted(),
    );
    expect(Object.keys(ENTITY_TYPES).toSorted()).toEqual(
      SYNC_COMMAND_OPERATIONS.toSorted(),
    );
  });

  it("SYNC_PERMISSION_DENIED is permanent: the desktop dead-letters it", () => {
    expect(classifyOutboxRejection("SYNC_PERMISSION_DENIED")).toBe("permanent");
  });

  it.each(ROLES)(
    "REQ-SYNC-RBAC-3: as %s, a denied operation is refused for good and nothing is written",
    async (role) => {
      const world = await seedWorld(role);
      const operations = [...SYNC_COMMAND_OPERATIONS];

      const pushed = await pushBatch(world, operations);

      const denied = pushed.events.filter(
        (event) => !ALLOWED[event.operation]?.includes(role),
      );
      const permitted = pushed.events.filter((event) =>
        ALLOWED[event.operation]?.includes(role),
      );
      for (const event of denied) {
        expect(
          pushed.codeOf(event.eventId),
          `${event.operation} as ${role}`,
        ).toBe("SYNC_PERMISSION_DENIED");
      }
      for (const event of permitted) {
        expect(
          pushed.codeOf(event.eventId),
          `${event.operation} as ${role}`,
        ).not.toBe("SYNC_PERMISSION_DENIED");
      }

      // Nothing was claimed or written for a denied event.
      const deniedIds = denied.map((event) => event.eventId);
      if (deniedIds.length > 0) {
        const claimed = await db
          .select({ eventId: syncAppliedEvent.eventId })
          .from(syncAppliedEvent)
          .where(inArray(syncAppliedEvent.eventId, deniedIds));
        expect(claimed).toEqual([]);
        // ... and no audit row: a row naming a denied event would make its retry
        // look applied.
        const audit = await db
          .select({ details: organizationEventLog.details })
          .from(organizationEventLog);
        const audited = audit.flatMap((row) => {
          const eventId = row.details?.eventId;
          return typeof eventId === "string" ? [eventId] : [];
        });
        expect(audited.filter((id) => deniedIds.includes(id))).toEqual([]);
      }
      const deniedOps = new Set(denied.map((event) => event.operation));
      if (deniedOps.has("create_local_service_order_intake")) {
        expect(
          await db.select({ id: serviceOrder.id }).from(serviceOrder),
        ).toEqual([]);
      }
      if (deniedOps.has("create_local_asset")) {
        const assets = await db
          .select({ id: asset.id })
          .from(asset)
          .where(eq(asset.tag, "TAG-OFF-1"));
        expect(assets).toEqual([]);
      }
    },
  );

  it("REQ-SYNC-RBAC-4: a permitted role still applies the operation, in the same batch as a denied one", async () => {
    const world = await seedWorld("member");

    const pushed = await pushBatch(world, [
      "create_local_asset", // member: denied
      "create_local_service_order_intake", // member: allowed
    ]);

    const [newAsset, intake] = pushed.events;
    expect(pushed.codeOf(newAsset?.eventId ?? "")).toBe(
      "SYNC_PERMISSION_DENIED",
    );
    expect(pushed.codeOf(intake?.eventId ?? "")).toBeNull();
    expect(pushed.accepted.has(intake?.eventId ?? "")).toBe(true);
    expect(
      await db.select({ id: serviceOrder.id }).from(serviceOrder),
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: asset.id })
        .from(asset)
        .where(eq(asset.tag, "TAG-OFF-1")),
    ).toEqual([]);
  });
});
