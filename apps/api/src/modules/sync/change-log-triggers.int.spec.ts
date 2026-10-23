/**
 * change-log-triggers.int.spec.ts: the triggers that fill `sync_change_log`, against
 * real Postgres (REQ-CS-1: exactly the entities the desktop pull and bootstrap carry;
 * REQ-CS-2: deletes and scope moves are entries of their own).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  calibrationMethod,
  customer,
  environmentalLimits,
  massCompositionProfile,
  organization,
  organizationUnit,
  referenceStandard,
  referenceStandardCertificateDocument,
  service,
  serviceOrder,
} from "@calibra-facil/db/schema";
import {
  SYNC_CHANGE_ENTITY_ORDER,
  SYNC_CHANGE_LOG_TABLES,
} from "@calibra-facil/db/sync-change-log";
import { truncateAll } from "../../../test/integration/db";
import {
  seedCustomer,
  seedOrg,
  seedService,
  seedStandard,
} from "../../../test/integration/seed";
import { seedJobForOrg } from "../../../test/integration/tenant-refs";
import { getExecuteRows } from "../../lib/db";
import { SYNC_ENTITY_SOURCES } from "./entity-sources";

type Entry = {
  entity_type: string;
  entity_id: number;
  op: string;
  unit_id: number | null;
  organization_id: string;
};

async function entries(organizationId?: string): Promise<Entry[]> {
  const result = await db.execute(
    organizationId === undefined
      ? sql`SELECT entity_type, entity_id, op, unit_id, organization_id FROM sync_change_log ORDER BY seq`
      : sql`SELECT entity_type, entity_id, op, unit_id, organization_id FROM sync_change_log
            WHERE organization_id = ${organizationId} ORDER BY seq`,
  );
  return getExecuteRows<Entry>(result).map((row) => ({
    ...row,
    entity_id: Number(row.entity_id),
  }));
}

async function clearLog() {
  await db.execute(sql`DELETE FROM sync_change_log`);
}

function shape(rows: Entry[]) {
  return rows.map(
    (row) => `${row.entity_type}:${row.entity_id}:${row.op}:${row.unit_id}`,
  );
}

const ORG = "org-trg-a";

describe("sync change log triggers", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-CS-1: every table of the sync entity list has its insert/delete and update triggers in the database", async () => {
    const rows = getExecuteRows<{ tgname: string; relname: string }>(
      await db.execute(sql`
        SELECT t.tgname, c.relname FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND t.tgname LIKE 'sync_change_log_%'`),
    );
    const found = rows.map((row) => `${row.relname}:${row.tgname}`).toSorted();
    const expected = SYNC_CHANGE_LOG_TABLES.flatMap((entry) => [
      `${entry.table}:sync_change_log_${entry.table}_write`,
      `${entry.table}:sync_change_log_${entry.table}_update`,
    ]).toSorted();
    expect(found).toEqual(expected);
  });

  it("REQ-CS-1: the API's entity sources are exactly the entities the triggers log (no entity pulled without a trigger, none logged without a source)", () => {
    expect(SYNC_ENTITY_SOURCES.map((source) => source.entityType)).toEqual([
      ...SYNC_CHANGE_ENTITY_ORDER,
    ]);
    expect(
      new Set(SYNC_CHANGE_LOG_TABLES.map((entry) => entry.entityType)),
    ).toEqual(new Set(SYNC_CHANGE_ENTITY_ORDER));
  });

  it("REQ-CS-2: a customer is an upsert entry when inserted or changed and a delete entry when removed", async () => {
    const org = await seedOrg({ orgId: ORG });
    const id = await seedCustomer({
      labOrganizationId: org.orgId,
      name: "Cliente",
    });
    expect(shape(await entries(org.orgId))).toEqual([
      `customer:${id}:upsert:null`,
    ]);

    await clearLog();
    await db.update(customer).set({ name: "Outro" }).where(eq(customer.id, id));
    expect(shape(await entries(org.orgId))).toEqual([
      `customer:${id}:upsert:null`,
    ]);

    await clearLog();
    await db.delete(customer).where(eq(customer.id, id));
    expect(shape(await entries(org.orgId))).toEqual([
      `customer:${id}:delete:null`,
    ]);
  });

  it("REQ-CS-1: an update that changes nothing writes no entry, and a transaction that touches a row five times writes one", async () => {
    const org = await seedOrg({ orgId: ORG });
    const id = await seedCustomer({
      labOrganizationId: org.orgId,
      name: "Cliente",
    });
    await clearLog();

    await db.execute(sql`UPDATE customer SET name = name WHERE id = ${id}`);
    expect(await entries(org.orgId)).toEqual([]);

    await db.transaction(async (tx) => {
      for (let index = 0; index < 5; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        await tx
          .update(customer)
          .set({ name: `Nome ${index}` })
          .where(eq(customer.id, id));
      }
    });
    expect(shape(await entries(org.orgId))).toEqual([
      `customer:${id}:upsert:null`,
    ]);
  });

  it("REQ-CS-1: a rolled back transaction leaves no entry", async () => {
    const org = await seedOrg({ orgId: ORG });
    await clearLog();
    await db
      .transaction(async (tx) => {
        await tx.insert(service).values({
          organizationId: org.orgId,
          unitId: org.unitId,
          name: "Desfeito",
        });
        throw new Error("rollback");
      })
      .catch(() => undefined);
    expect(await entries()).toEqual([]);
  });

  it("REQ-CS-2: an asset that moves to another unit leaves an entry for the unit it left and one for the unit it joined; a soft delete is an upsert entry (the pull resolves it to a delete)", async () => {
    const org = await seedOrg({ orgId: ORG });
    const [second] = await db
      .insert(organizationUnit)
      .values({
        organizationId: org.orgId,
        name: "Filial",
        slug: "filial",
        status: "ACTIVE",
        isDefault: false,
        createdBy: org.userId,
      })
      .returning({ id: organizationUnit.id });
    if (!second) throw new Error("unit seed failed");
    const { assetId } = await seedJobForOrg({
      orgId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });
    await clearLog();

    await db
      .update(asset)
      .set({ unitId: second.id })
      .where(eq(asset.id, assetId));
    expect(shape(await entries(org.orgId)).toSorted()).toEqual(
      [
        `asset:${assetId}:upsert:${second.id}`,
        `asset:${assetId}:delete:${org.unitId}`,
      ].toSorted(),
    );

    await clearLog();
    await db
      .update(asset)
      .set({ deletedAt: new Date() })
      .where(eq(asset.id, assetId));
    expect(shape(await entries(org.orgId))).toEqual([
      `asset:${assetId}:upsert:${second.id}`,
    ]);
  });

  it("REQ-CS-1: service, standard, environmental limit, job and service order are logged with their unit", async () => {
    const org = await seedOrg({ orgId: ORG });
    await clearLog();
    const serviceId = await seedService({
      organizationId: org.orgId,
      unitId: org.unitId,
      name: "Calibração",
    });
    const standardId = await seedStandard({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });
    const [limit] = await db
      .insert(environmentalLimits)
      .values({
        organizationId: org.orgId,
        unitId: org.unitId,
        limits: {},
      })
      .returning({ id: environmentalLimits.id });
    const { jobId, assetId } = await seedJobForOrg({
      orgId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });
    const [order] = await db
      .insert(serviceOrder)
      .values({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId:
          (
            await db
              .select({ id: calibrationJob.customerId })
              .from(calibrationJob)
              .where(eq(calibrationJob.id, jobId))
          )[0]?.id ?? 0,
        assetId,
        openedByUserId: org.userId,
        serviceOrderNumber: "OS-TRG-1",
        status: "awaiting_tech_evaluation",
        claimedDefect: "x",
        intakeCondition: "y",
        intakeType: "counter",
        deliveryMethod: "pickup_at_lab",
        priority: "normal",
        totalQuotedCents: 0,
        totalApprovedCents: 0,
        evaluationFeeCents: 0,
        evaluationFeeApplied: false,
        isExternalService: false,
      })
      .returning({ id: serviceOrder.id });
    if (!limit || !order) throw new Error("seed failed");

    const logged = shape(await entries(org.orgId));
    for (const expected of [
      `service:${serviceId}:upsert:${org.unitId}`,
      `reference_standard:${standardId}:upsert:${org.unitId}`,
      `environmental_limit:${limit.id}:upsert:${org.unitId}`,
      `calibration_job:${jobId}:upsert:${org.unitId}`,
      `service_order:${order.id}:upsert:${org.unitId}`,
    ]) {
      expect(logged).toContain(expected);
    }

    await clearLog();
    await db.delete(service).where(eq(service.id, serviceId));
    await db
      .delete(environmentalLimits)
      .where(eq(environmentalLimits.id, limit.id));
    expect(shape(await entries(org.orgId)).toSorted()).toEqual(
      [
        `service:${serviceId}:delete:${org.unitId}`,
        `environmental_limit:${limit.id}:delete:${org.unitId}`,
      ].toSorted(),
    );
  });

  it("REQ-CS-1: a new certificate document of a standard is a change of the standard", async () => {
    const org = await seedOrg({ orgId: ORG });
    const standardId = await seedStandard({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });
    await clearLog();
    await db.insert(referenceStandardCertificateDocument).values({
      standardId,
      organizationId: org.orgId,
      unitId: org.unitId,
      certificateNumber: "CERT-1",
      calibrationDate: new Date(Date.UTC(2026, 0, 1)),
      nextCalibrationDate: new Date(Date.UTC(2027, 0, 1)),
      fileName: "c.pdf",
      contentType: "application/pdf",
      fileSize: 10,
      sha256: "a".repeat(64),
      r2Key: "k/c.pdf",
    });
    expect(shape(await entries(org.orgId))).toEqual([
      `reference_standard:${standardId}:upsert:${org.unitId}`,
    ]);
    expect(
      (await db.select({ id: referenceStandard.id }).from(referenceStandard))
        .length,
    ).toBe(1);
  });

  it("REQ-CS-1: only PUBLISHED methods are mirrored: publishing is an upsert, leaving PUBLISHED a delete, a draft nothing", async () => {
    const org = await seedOrg({ orgId: ORG });
    const [type] = await db
      .insert(assetType)
      .values({ name: "Tipo", slug: "tipo-trg", definition: [] })
      .returning({ id: assetType.id });
    if (!type) throw new Error("seed failed");
    await clearLog();
    const [method] = await db
      .insert(calibrationMethod)
      .values({
        organizationId: org.orgId,
        assetTypeId: type.id,
        name: "Método",
        version: 1,
        status: "DRAFT",
        dataFields: [],
        variableBindings: [],
        formulas: [],
        measurementModels: [],
        validations: [],
        uncertaintyParams: [],
        createdBy: org.userId,
      })
      .returning({ id: calibrationMethod.id });
    if (!method) throw new Error("seed failed");
    expect(await entries(org.orgId)).toEqual([]);

    await db
      .update(calibrationMethod)
      .set({ status: "PUBLISHED" })
      .where(eq(calibrationMethod.id, method.id));
    expect(shape(await entries(org.orgId))).toEqual([
      `published_method:${method.id}:upsert:null`,
    ]);

    await clearLog();
    await db
      .update(calibrationMethod)
      .set({ status: "ARCHIVED" })
      .where(eq(calibrationMethod.id, method.id));
    expect(shape(await entries(org.orgId))).toEqual([
      `published_method:${method.id}:delete:null`,
    ]);
  });

  it("REQ-CS-1: a mass composition profile is logged", async () => {
    const org = await seedOrg({ orgId: ORG });
    await clearLog();
    const [profile] = await db
      .insert(massCompositionProfile)
      .values({
        organizationId: org.orgId,
        profileKey: "1kg-M1",
        profileClass: "M1",
        nominalG: 1000,
        nominal: "1 kg",
        value: 1000,
        uncertainty: 0.001,
      })
      .returning({ id: massCompositionProfile.id });
    if (!profile) throw new Error("seed failed");
    expect(shape(await entries(org.orgId))).toEqual([
      `mass_composition_profile:${profile.id}:upsert:null`,
    ]);
  });

  it("REQ-CS-5: a change of the global asset type catalog is logged once for each laboratory (and for no client organization)", async () => {
    const a = await seedOrg({ orgId: "org-trg-a" });
    const b = await seedOrg({ orgId: "org-trg-b", userId: "user-trg-b" });
    await db.insert(organization).values({
      id: "client-trg",
      name: "Client",
      slug: "client-trg",
      type: "CLIENT",
      status: "ACTIVE",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await clearLog();
    const [type] = await db
      .insert(assetType)
      .values({ name: "Global", slug: "global-trg", definition: [] })
      .returning({ id: assetType.id });
    if (!type) throw new Error("seed failed");

    const logged = await entries();
    expect(
      logged
        .map((row) => `${row.organization_id}:${row.entity_type}:${row.op}`)
        .toSorted(),
    ).toEqual([`${a.orgId}:asset_type:upsert`, `${b.orgId}:asset_type:upsert`]);

    await clearLog();
    await db.delete(assetType).where(eq(assetType.id, type.id));
    expect(
      (await entries())
        .map((row) => `${row.organization_id}:${row.op}`)
        .toSorted(),
    ).toEqual([`${a.orgId}:delete`, `${b.orgId}:delete`]);
  });
});
