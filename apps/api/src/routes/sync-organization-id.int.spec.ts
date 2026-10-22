/**
 * sync-organization-id.int.spec.ts: REQ-ORG-5 for the desktop sync apply path.
 *
 * Every desktop sync operation that inserts a tenant child or audit row writes the
 * laboratory of the device's organization on it (migration 0118,
 * docs/architecture/tenancy.md). Each test pushes ONE operation through POST /push
 * (real RBAC, real database; only the Better Auth session is mocked), then re-queries
 * the rows the operation created and asserts they carry the pushing lab's
 * organization, with a second laboratory seeded alongside so a mis-attribution would
 * show.
 */
import { insertJobs } from "../../test/integration/job-fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationMethod,
  referenceStandard,
  service,
} from "@calibra-facil/db/schema";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedCustomer, seedOrg } from "../../test/integration/seed";
import { executableMethodSnapshot } from "../../test/integration/executable-method";
import { ENGINE_VERSION } from "@calibra-facil/math-engine";
import { getExecuteRows } from "../lib/db";
import { syncRouter } from "./sync";

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
      const { organization } = await import("@calibra-facil/db/schema");
      const id = `client-${params.slug}`;
      await database.insert(organization).values({
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

const JSON_HEADERS = { "content-type": "application/json" };
const LAB = "org-sync-a";
const OTHER = "org-sync-b";

type World = Awaited<ReturnType<typeof seedWorld>>;

/** A PUBLISHED method whose compiled artifact satisfies createCalibrationJob. */
async function seedPublishedMethod(params: {
  organizationId: string;
  assetTypeId: number;
  createdBy: string;
}): Promise<number> {
  const fingerprint = "test-fp-0000000000000001";
  const optionsFingerprint = "test-opts-fp-00000001";
  const [row] = await db
    .insert(calibrationMethod)
    .values({
      organizationId: params.organizationId,
      assetTypeId: params.assetTypeId,
      name: `Metodo ${params.organizationId}`,
      version: 1,
      status: "PUBLISHED",
      dataFields: [],
      variableBindings: [],
      formulas: [],
      measurementModels: [],
      validations: [],
      uncertaintyParams: [],
      methodFingerprint: fingerprint,
      compiledMethod: {
        methodFingerprint: fingerprint,
        normalizedMethodJson: "{}",
        engine: { version: ENGINE_VERSION, optionsFingerprint },
      },
      methodEngine: { version: ENGINE_VERSION, optionsFingerprint },
      publicationEvidence: { publishedAt: "2026-01-01T00:00:00.000Z" },
      createdBy: params.createdBy,
    })
    .returning({ id: calibrationMethod.id });
  if (!row) throw new Error("seedPublishedMethod: insert failed");
  return row.id;
}

async function seedLab(orgId: string, userId: string, tag: string) {
  const org = await seedOrg({ orgId, userId, role: "admin" });
  const customerId = await seedCustomer({
    labOrganizationId: org.orgId,
    name: `Cliente ${tag}`,
  });
  const [type] = await db
    .insert(assetType)
    .values({ name: `Tipo ${tag}`, slug: `tipo-${tag}`, definition: [] })
    .returning({ id: assetType.id });
  const [instrument] = await db
    .insert(asset)
    .values({
      labOrganizationId: org.orgId,
      unitId: org.unitId,
      customerId,
      assetTypeId: type?.id ?? 0,
      name: `Instrumento ${tag}`,
      serialNumber: `SN-${tag}`,
      tag: `TAG-${tag}`,
    })
    .returning({ id: asset.id });
  const methodId = await seedPublishedMethod({
    organizationId: org.orgId,
    assetTypeId: type?.id ?? 0,
    createdBy: org.userId,
  });
  const [svc] = await db
    .insert(service)
    .values({
      organizationId: org.orgId,
      unitId: org.unitId,
      name: `Calibracao ${tag}`,
      isActive: true,
      methodId,
    })
    .returning({ id: service.id });
  return {
    org,
    customerId,
    assetTypeId: type?.id ?? 0,
    assetId: instrument?.id ?? 0,
    serviceId: svc?.id ?? 0,
  };
}

async function seedWorld() {
  const lab = await seedLab(LAB, "user-sync-a", "A");
  // A second laboratory with rows of its own: nothing the device pushes may land there.
  await seedLab(OTHER, "user-sync-b", "B");

  const [job] = await insertJobs({
    jobId: "CAL-SYNC-1",
    organizationId: lab.org.orgId,
    unitId: lab.org.unitId,
    customerId: lab.customerId,
    assetId: lab.assetId,
    serviceId: lab.serviceId,
    createdBy: lab.org.userId,
    status: "IN_PROGRESS",
    methodSnapshot: executableMethodSnapshot(),
    assetSnapshot: {
      assetId: lab.assetId,
      assetTypeId: lab.assetTypeId,
      assetTypeName: "Tipo A",
      assetTypeSlug: "tipo-A",
      baseMeasurementUnit: null,
      name: "Instrumento A",
      tag: "TAG-A",
      serialNumber: "SN-A",
      manufacturer: null,
      model: null,
      specifications: null,
      capturedAt: "2026-01-01T00:00:00.000Z",
    },
    certificateName: "CAL-SYNC-1",
  });
  const [standard] = await db
    .insert(referenceStandard)
    .values({
      organizationId: lab.org.orgId,
      unitId: lab.org.unitId,
      createdBy: lab.org.userId,
      name: "Massa Padrao",
      kind: "generic_scalar",
      serialNumber: "SN-STD-SYNC",
      certificateNumber: "CERT-SYNC",
      calibrationDate: new Date("2026-01-10T15:00:00.000Z"),
      nextCalibrationDate: new Date("2030-01-10T00:00:00.000Z"),
      coverageFactor: 2,
      distribution: "normal",
      status: "ACTIVE",
      referenceValue: 1,
      uncertainty: 0.01,
    })
    .returning({ id: referenceStandard.id });
  return { ...lab, jobId: job?.id ?? 0, standardId: standard?.id ?? 0 };
}

let counter = 0;

/** Pushes one event and returns whether it was accepted (with the reason when not). */
async function push(
  world: World,
  event: {
    entityType: string;
    entityId: string;
    operation: string;
    payload: Record<string, unknown>;
  },
): Promise<{ accepted: boolean; reason: string }> {
  counter += 1;
  loginAs({ userId: world.org.userId, organizationId: world.org.orgId });
  const eventId = `evt-org-${counter}`;
  const res = await syncRouter.request("/push", {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-active-unit-id": String(world.org.unitId) },
    body: JSON.stringify({
      deviceId: "device-org-1",
      clientBatchId: `batch-${eventId}`,
      baseCursor: null,
      events: [
        {
          ...event,
          eventId,
          occurredAt: new Date().toISOString(),
          actorUserId: world.org.userId,
          organizationId: world.org.orgId,
          unitId: world.org.unitId,
          idempotencyKey: `idem-${eventId}`,
          localVersion: 0,
        },
      ],
    }),
  });
  expect(res.status).toBe(200);
  const body: {
    accepted: Array<{ eventId: string }>;
    rejected: Array<{ eventId: string; code: string; reason: string }>;
  } = await res.json();
  const rejected = body.rejected[0];
  return {
    accepted: body.accepted.length === 1,
    reason: rejected ? `${rejected.code}: ${rejected.reason}` : "",
  };
}

async function pushOk(
  world: World,
  event: Parameters<typeof push>[1],
): Promise<void> {
  const result = await push(world, event);
  expect(result.reason).toBe("");
  expect(result.accepted).toBe(true);
}

/** The organizations of every row of `table` (optionally filtered), as a sorted unique list. */
async function organizationsOf(
  table: string,
  where = sql`true`,
): Promise<{ owners: Array<string | null>; rows: number }> {
  const rows = getExecuteRows<{ organization_id: string | null }>(
    await db.execute(
      sql`select organization_id from ${sql.identifier(table)} where ${where}`,
    ),
  );
  return {
    owners: [...new Set(rows.map((row) => row.organization_id))],
    rows: rows.length,
  };
}

async function expectOnlyLab(table: string, where = sql`true`) {
  const { owners, rows } = await organizationsOf(table, where);
  expect(rows, `${table} has rows`).toBeGreaterThan(0);
  expect(owners, table).toEqual([LAB]);
}

const SERVICE_ORDER_PAYLOAD = (world: World) => ({
  customerId: world.customerId,
  assetId: world.assetId,
  claimedDefect: "Nao liga",
  intakeCondition: "Riscos na carcaca",
});

/** Creates a service order through sync and returns its local id (the mapping key). */
async function createServiceOrder(world: World, localId: string) {
  await pushOk(world, {
    entityType: "service_order",
    entityId: localId,
    operation: "create_local_service_order_intake",
    payload: SERVICE_ORDER_PAYLOAD(world),
  });
}

describe("REQ-ORG-5: desktop sync operations write the lab organization on tenant child and audit rows", () => {
  let world: World;

  beforeEach(async () => {
    await truncateAll();
    world = await seedWorld();
  });

  it("REQ-ORG-5: create_local_asset writes asset_audit_log with the lab org", async () => {
    await pushOk(world, {
      entityType: "asset",
      entityId: "local-asset-1",
      operation: "create_local_asset",
      payload: {
        customerId: world.customerId,
        assetTypeId: world.assetTypeId,
        name: "Ativo novo",
        serialNumber: "SN-NEW-1",
        tag: "TAG-NEW-1",
      },
    });
    await expectOnlyLab("asset_audit_log", sql`action = 'create'`);
  });

  it("REQ-ORG-5: update_local_asset writes asset_audit_log with the lab org", async () => {
    await pushOk(world, {
      entityType: "asset",
      entityId: "local-asset-2",
      operation: "update_local_asset",
      payload: { remoteId: world.assetId, name: "Renomeado" },
    });
    await expectOnlyLab("asset_audit_log", sql`action <> 'create'`);
  });

  it("REQ-ORG-5: create_local_customer writes customer_audit_log with the lab org", async () => {
    await pushOk(world, {
      entityType: "customer",
      entityId: "local-customer-1",
      operation: "create_local_customer",
      payload: { name: "Cliente Desktop Ltda" },
    });
    await expectOnlyLab("customer_audit_log", sql`action = 'create'`);
  });

  it("REQ-ORG-5: update_local_customer writes customer_audit_log with the lab org", async () => {
    await pushOk(world, {
      entityType: "customer",
      entityId: "local-customer-2",
      operation: "update_local_customer",
      payload: { remoteId: world.customerId, name: "Cliente Renomeado" },
    });
    await expectOnlyLab("customer_audit_log", sql`action = 'update'`);
  });

  it("REQ-ORG-5: update_local_customer_compliance writes customer_audit_log with the lab org", async () => {
    await pushOk(world, {
      entityType: "customer",
      entityId: "local-customer-3",
      operation: "update_local_customer_compliance",
      payload: {
        remoteId: world.customerId,
        compliance: { qualificationStatus: "qualified" },
        reason: "Auditoria de qualificacao",
      },
    });
    await expectOnlyLab(
      "customer_audit_log",
      sql`action = 'compliance_change'`,
    );
  });

  it("REQ-ORG-5: create_local_job_draft writes the job's job_audit_log row with the lab org", async () => {
    await pushOk(world, {
      entityType: "calibration_job",
      entityId: "local-job-draft-1",
      operation: "create_local_job_draft",
      payload: { assetId: world.assetId, serviceId: world.serviceId },
    });
    await expectOnlyLab("job_audit_log", sql`action = 'create'`);
  });

  it("REQ-ORG-5: submit_local_execution writes job_audit_log and the job_standard links with the lab org", async () => {
    await pushOk(world, {
      entityType: "calibration_job",
      entityId: "local-job-exec-1",
      operation: "submit_local_execution",
      payload: {
        remoteId: world.jobId,
        status: "REVIEW",
        data: { indication: "10", reference: "9" },
        standardsSnapshot: [
          {
            id: world.standardId,
            name: "Massa Padrao",
            certificateNumber: "CERT-SYNC",
            calibrationDate: "2026-01-10T00:00:00.000Z",
            nextCalibrationDate: "2030-01-10T00:00:00.000Z",
            uncertainty: 0.01,
            uncertaintyUnit: "g",
            coverageFactor: 2,
            distribution: "normal",
            drift: null,
            certifiedValues: null,
          },
        ],
        calibrationLocationSnapshot: {
          type: "lab",
          addressText: "Laboratorio",
        },
      },
    });
    await expectOnlyLab("job_audit_log", sql`job_id = ${world.jobId}`);
    await expectOnlyLab("job_standard", sql`job_id = ${world.jobId}`);
  });

  it("REQ-ORG-5: create_local_non_conformance writes non_conformance_audit_log with the lab org", async () => {
    await pushOk(world, {
      entityType: "non_conformance",
      entityId: "local-nc-1",
      operation: "create_local_non_conformance",
      payload: {
        type: "work",
        description: "Desvio no procedimento de calibracao",
        detectedAt: new Date().toISOString(),
      },
    });
    await expectOnlyLab("non_conformance_audit_log");
  });

  it("REQ-ORG-5: create_local_service_order_intake writes service_order_asset_snapshot with the lab org", async () => {
    await createServiceOrder(world, "local-so-1");
    await expectOnlyLab("service_order_asset_snapshot");
  });

  it("REQ-ORG-5: create_local_service_order_quote_draft writes the quote and its items with the lab org", async () => {
    await createServiceOrder(world, "local-so-2");
    await pushOk(world, {
      entityType: "service_order_quote",
      entityId: "local-quote-1",
      operation: "create_local_service_order_quote_draft",
      payload: {
        serviceOrderId: "local-so-2",
        items: [
          {
            type: "service",
            description: "Mao de obra",
            quantity: 1,
            unit: "un",
            unitPriceCents: 10000,
          },
        ],
      },
    });
    await expectOnlyLab("service_order_quote");
    await expectOnlyLab("service_order_quote_item");
  });

  it("REQ-ORG-5: save_local_service_order_execution_notes writes the execution and its items with the lab org", async () => {
    await createServiceOrder(world, "local-so-3");
    await pushOk(world, {
      entityType: "service_order_execution",
      entityId: "local-exec-1",
      operation: "save_local_service_order_execution_notes",
      payload: {
        serviceOrderId: "local-so-3",
        technicalNotes: "Troca de celula",
        items: [
          {
            type: "service",
            description: "Reparo",
            quantity: 1,
            unit: "un",
            unitPriceCents: 5000,
          },
        ],
      },
    });
    await expectOnlyLab("service_order_execution");
    await expectOnlyLab("service_order_execution_item");
  });

  it("REQ-ORG-5: create_local_service_order_delivery_document_draft writes the delivery document with the lab org", async () => {
    await createServiceOrder(world, "local-so-4");
    await pushOk(world, {
      entityType: "service_order_delivery_document",
      entityId: "local-delivery-1",
      operation: "create_local_service_order_delivery_document_draft",
      payload: { serviceOrderId: "local-so-4" },
    });
    await expectOnlyLab("service_order_delivery_document");
  });

  it("REQ-ORG-5: nothing a lab's device pushes is attributed to another laboratory", async () => {
    await createServiceOrder(world, "local-so-5");
    await pushOk(world, {
      entityType: "asset",
      entityId: "local-asset-9",
      operation: "create_local_asset",
      payload: {
        customerId: world.customerId,
        assetTypeId: world.assetTypeId,
        name: "Ativo isolado",
        serialNumber: "SN-ISO-1",
        tag: "TAG-ISO-1",
      },
    });
    for (const table of ["asset_audit_log", "service_order_asset_snapshot"]) {
      // eslint-disable-next-line no-await-in-loop
      const { owners } = await organizationsOf(table);
      expect(owners, table).not.toContain(OTHER);
      expect(owners, table).not.toContain(null);
    }
  });
});
