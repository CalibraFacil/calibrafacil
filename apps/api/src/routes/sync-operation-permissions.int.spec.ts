/**
 * sync-operation-permissions.int.spec.ts: P0-2, per-operation RBAC on the desktop push,
 * against real Postgres and the real permission middleware (only the Better Auth
 * session, the queue and the notifications are faked).
 *
 *   REQ-SYNC-RBAC-3  an event the member's role may not send (the online route of the
 *                    same operation denies it) is refused with SYNC_PERMISSION_DENIED,
 *                    a permanent code, and nothing is written for it
 *   REQ-SYNC-RBAC-4  an event the role may send is not refused for permission (it
 *                    applies, or fails on its own merits), and a batch carries both
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  customer,
  nonConformance,
  organization,
  organizationEventLog,
  serviceOrder,
  syncAppliedEvent,
} from "@calibra-facil/db/schema";
import {
  SYNC_COMMAND_OPERATIONS,
  classifyOutboxRejection,
  syncPushResponseSchema,
} from "@calibra-facil/contracts";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedCustomer, seedOrg } from "../../test/integration/seed";
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
  notifyNonConformanceCreated: vi.fn().mockResolvedValue(undefined),
  notifyServiceOrderCreated: vi.fn().mockResolvedValue(undefined),
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
}));

// The CLIENT organization of a new customer is created through Better Auth (not
// available here): replace only that call with a plain organization row.
vi.mock("../lib/portal-service-account", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/portal-service-account")>();
  return {
    ...actual,
    createClientOrganizationAsServiceOwner: async (params: {
      name: string;
      slug: string;
    }) => {
      const { db: database } = await import("@calibra-facil/db");
      const { organization: organizationTable } =
        await import("@calibra-facil/db/schema");
      const id = `client-${params.slug}`;
      await database.insert(organizationTable).values({
        id,
        name: params.name,
        slug: params.slug,
        type: "CLIENT",
        status: "ACTIVE",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      return { id };
    },
  };
});

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
const MANAGER: readonly Role[] = ["owner", "admin"];

/** The roles the ONLINE route of each operation lets through (hand-written). */
const ALLOWED: Record<string, readonly Role[]> = {
  create_local_job_draft: FIELD,
  create_local_asset: FIELD,
  update_local_asset: FIELD,
  create_local_customer: FIELD,
  update_local_customer: FIELD,
  update_local_customer_compliance: FIELD,
  save_local_execution: FIELD,
  submit_local_execution: FIELD,
  create_local_service_order_intake: ["owner", "admin", "operator", "member"],
  create_local_non_conformance: ["owner", "admin", "technician"],
  create_local_service_order_quote_draft: MANAGER,
  save_local_service_order_execution_notes: FIELD,
  create_local_service_order_delivery_document_draft: MANAGER,
  create_local_attachment: FIELD,
  create_local_certificate_draft: FIELD,
  generate_local_certificate_pdf: MANAGER,
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
  const [instrument] = await db
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
    .returning({ id: asset.id });
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
  create_local_job_draft: "calibration_job",
  create_local_asset: "asset",
  update_local_asset: "asset",
  create_local_customer: "customer",
  update_local_customer: "customer",
  update_local_customer_compliance: "customer",
  save_local_execution: "calibration_job",
  submit_local_execution: "calibration_job",
  create_local_service_order_intake: "service_order",
  create_local_non_conformance: "non_conformance",
  create_local_service_order_quote_draft: "service_order_quote",
  save_local_service_order_execution_notes: "service_order_execution",
  create_local_service_order_delivery_document_draft:
    "service_order_delivery_document",
  create_local_attachment: "attachment",
  create_local_certificate_draft: "certificate_draft",
  generate_local_certificate_pdf: "certificate_pdf",
};

/** Payloads that would apply for a permitted role where that is cheap to arrange. */
function payloadFor(world: World, operation: string): Record<string, unknown> {
  switch (operation) {
    case "create_local_customer":
      return { name: "Cliente Offline Ltda" };
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
    case "create_local_non_conformance":
      return {
        type: "work",
        description: "Desvio no procedimento de calibracao",
        detectedAt: new Date().toISOString(),
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
      const customersBefore = await db
        .select({ id: customer.id })
        .from(customer);
      const organizationsBefore = await db
        .select({ id: organization.id })
        .from(organization);

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
      if (deniedOps.has("create_local_customer")) {
        expect(await db.select({ id: customer.id }).from(customer)).toEqual(
          customersBefore,
        );
        // ... and no CLIENT organization was provisioned as a side effect.
        expect(
          await db.select({ id: organization.id }).from(organization),
        ).toEqual(organizationsBefore);
      }
      if (deniedOps.has("create_local_service_order_intake")) {
        expect(
          await db.select({ id: serviceOrder.id }).from(serviceOrder),
        ).toEqual([]);
      }
      if (deniedOps.has("create_local_non_conformance")) {
        expect(
          await db.select({ id: nonConformance.id }).from(nonConformance),
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
    const world = await seedWorld("operator");

    const pushed = await pushBatch(world, [
      "create_local_non_conformance", // operator: denied
      "create_local_service_order_intake", // operator: allowed
      "create_local_asset", // operator: allowed
      "create_local_customer", // operator: allowed
    ]);

    const [nc, intake, newAsset, newCustomer] = pushed.events;
    expect(pushed.codeOf(nc?.eventId ?? "")).toBe("SYNC_PERMISSION_DENIED");
    for (const event of [intake, newAsset, newCustomer]) {
      expect(pushed.codeOf(event?.eventId ?? "")).toBeNull();
      expect(pushed.accepted.has(event?.eventId ?? "")).toBe(true);
    }
    expect(
      await db.select({ id: serviceOrder.id }).from(serviceOrder),
    ).toHaveLength(1);
    expect(
      await db.select({ id: nonConformance.id }).from(nonConformance),
    ).toEqual([]);
  });
});
