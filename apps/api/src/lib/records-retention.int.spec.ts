/**
 * records-retention.int.spec.ts — Real-Postgres proof of the retention of
 * regulated records (decision Q16, migration 0117, docs/architecture/records-retention.md).
 *
 *   REQ-RET-2  deleting an organization / customer / asset that has evidence is
 *              refused; evidence never cascades away; SET NULL on actors stays
 *   REQ-RET-3  a LAB organization is soft-deleted; Postgres refuses its hard
 *              DELETE without the purge-only (or seed) escape hatch; the
 *              soft-deleted organization is hidden from sign-in and membership;
 *              provisioning cleanup proves the organization is empty first;
 *              customer / client-organization deletion keeps working only when
 *              the customer has no evidence
 *   REQ-RET-4  retention_years (default 10, CHECK >= 5), legal_hold,
 *              calibra_retain_until
 *   REQ-RET-5  the purge job: disabled by default, dry-run unless
 *              RECORDS_PURGE_MODE=execute, selects exactly the eligible
 *              organizations, never touches legal-hold or in-retention ones,
 *              writes the platform audit event first
 */
import { insertJobs } from "../../test/integration/job-fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { organizationOf } from "../../test/integration/organization-of";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetAuditLog,
  assetOotEvent,
  assetType,
  calibrationJob,
  customer,
  customerAuditLog,
  invitation,
  jobAuditLog,
  member,
  nonConformance,
  organization,
  organizationApiKey,
  organizationEventLog,
  platformEventLog,
  referenceStandard,
  service,
  user,
  verification,
} from "@calibra-facil/db/schema";
import {
  OWNED_PART_EDGES,
  listEvidenceTables,
} from "@calibra-facil/db/records-retention";
import { createHash, randomBytes } from "node:crypto";
import { findDefaultActiveOrganizationId } from "@calibra-facil/auth";
import {
  hasActiveLabMembership,
  hasPendingLabInvitation,
} from "@calibra-facil/auth/lab-access";
import { magicLinkRouter } from "../routes/magic-link";
import { publicApiRouter } from "../routes/public-api";
import { publicApiV2Router } from "../routes/public-api-v2";
import { verifyRouter } from "../routes/verify";
import { customersRouter } from "../routes/customers";
import { loginAs } from "../../test/integration/setup";
import { asApplicationRole } from "../../test/integration/application-role";
import { truncateAll } from "../../test/integration/db";
import {
  seedApiKey,
  seedOrg,
  type SeededOrg,
} from "../../test/integration/seed";
import { hardDeleteOrganizationAsPurge } from "../../test/integration/records-retention";
import { getExecuteRows } from "./db";
import {
  evidenceTablesHoldingRecords,
  removeLabOrganization,
  softDeleteLabOrganization,
} from "./records-retention";
import {
  evaluatePurgeCandidates,
  readPurgeConfig,
  runRecordsPurge,
} from "./records-purge";
import { cleanupFailedLabProvisioning } from "../services/lab-provisioning";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type PgFailure = { code: string | null; message: string };

/** Runs a write and returns the Postgres error it raised (walking drizzle's wrapper). */
async function failureOf(run: () => PromiseLike<unknown>): Promise<PgFailure> {
  try {
    await run();
  } catch (error) {
    let current: unknown = error;
    let last: PgFailure | null = null;
    for (let depth = 0; depth < 5 && isRecord(current); depth += 1) {
      const code = typeof current.code === "string" ? current.code : null;
      const message =
        typeof current.message === "string" ? current.message : "";
      if (code !== null) last = { code, message };
      current = current.cause;
    }
    if (last) return last;
    throw error;
  }
  throw new Error("expected the statement to be rejected by Postgres");
}

const REFERENCED_ROW_CODES = ["23001", "23503"];

const METHOD_SNAPSHOT = {
  methodId: 1,
  methodName: "Test Method",
  methodVersion: 1,
  dataFields: [],
  variableBindings: [],
  formulas: [],
  measurementModels: [],
  validations: [],
  uncertaintyParams: [],
} satisfies Record<string, unknown>;

type LabOptions = {
  orgId: string;
  /** Date of every evidence row the lab holds; null = the lab holds none. */
  evidenceAt?: Date | null;
};

/**
 * A laboratory with a customer (and its CLIENT organization), an asset, an
 * APPROVED job, reference standard and audit trail, all dated `evidenceAt`.
 */
async function seedLab(options: LabOptions): Promise<LabFixture> {
  const { orgId } = options;
  const evidenceAt = options.evidenceAt ?? null;
  const org = await seedOrg({ orgId, userId: `user-${orgId}`, role: "admin" });
  const clientId = `client-${orgId}`;
  await db.insert(organization).values({
    id: clientId,
    name: `Client ${orgId}`,
    slug: clientId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type: "CLIENT",
    status: "ACTIVE",
  });
  const [cust] = await db
    .insert(customer)
    .values({
      name: `Customer ${orgId}`,
      labOrganizationId: orgId,
      authOrganizationId: clientId,
    })
    .returning({ id: customer.id });
  const [type] = await db
    .insert(assetType)
    .values({ name: `AT ${orgId}`, slug: `at-${orgId}`, definition: [] })
    .returning({ id: assetType.id });
  if (!cust || !type) throw new Error("seedLab: customer/type failed");
  const [instrument] = await db
    .insert(asset)
    .values({
      labOrganizationId: orgId,
      unitId: org.unitId,
      customerId: cust.id,
      assetTypeId: type.id,
      name: "Instrumento",
      serialNumber: `SN-${orgId}`,
      tag: `TAG-${orgId}`,
    })
    .returning({ id: asset.id });
  const [svc] = await db
    .insert(service)
    .values({
      organizationId: orgId,
      unitId: org.unitId,
      name: "Calibração",
      isActive: true,
    })
    .returning({ id: service.id });
  if (!instrument || !svc) throw new Error("seedLab: asset/service failed");

  const fixture: LabFixture = {
    ...org,
    clientId,
    customerId: cust.id,
    assetId: instrument.id,
    serviceId: svc.id,
    jobId: null,
  };
  if (evidenceAt) await seedEvidence(fixture, evidenceAt);
  return fixture;
}

type LabFixture = SeededOrg & {
  clientId: string;
  customerId: number;
  assetId: number;
  serviceId: number;
  jobId: number | null;
};

async function seedJob(
  fixture: LabFixture,
  at: Date,
  overrides: Partial<typeof calibrationJob.$inferInsert> = {},
) {
  const [job] = await insertJobs({
    jobId: `CAL-${fixture.orgId}`,
    organizationId: fixture.orgId,
    unitId: fixture.unitId,
    customerId: fixture.customerId,
    assetId: fixture.assetId,
    serviceId: fixture.serviceId,
    createdBy: fixture.userId,
    status: "APPROVED",
    methodSnapshot: METHOD_SNAPSHOT,
    data: { indication: "10" },
    results: { value: 10.01, expandedUncertainty: 0.02, k: 2 },
    performedAt: at,
    approvedBy: fixture.userId,
    approvedAt: at,
    certificateUrl: "https://files.test/c.pdf",
    createdAt: at,
    updatedAt: at,
    ...overrides,
  });
  if (!job) throw new Error("seedJob: insert failed");
  fixture.jobId = job.id;
  return job.id;
}

async function seedStandard(fixture: LabFixture, at: Date) {
  const [standard] = await db
    .insert(referenceStandard)
    .values({
      unitId: fixture.unitId,
      organizationId: fixture.orgId,
      name: "Padrão",
      serialNumber: `STD-${fixture.orgId}`,
      certificateNumber: "CERT-1",
      calibrationDate: new Date("2025-01-01T00:00:00.000Z"),
      nextCalibrationDate: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: fixture.userId,
      createdAt: at,
      updatedAt: at,
    })
    .returning({ id: referenceStandard.id });
  if (!standard) throw new Error("seedStandard: insert failed");
  return standard.id;
}

async function seedNonConformance(fixture: LabFixture, at: Date) {
  await db.insert(nonConformance).values({
    ncNumber: `NC-${fixture.orgId}`,
    organizationId: fixture.orgId,
    type: "calibration",
    description: "desvio",
    detectedBy: fixture.userId,
    detectedAt: at,
    createdBy: fixture.userId,
    createdAt: at,
    updatedAt: at,
  });
}

/** Every evidence family the purge scenarios look at, all dated `at`. */
async function seedEvidence(fixture: LabFixture, at: Date) {
  const jobId = await seedJob(fixture, at);
  await db.insert(jobAuditLog).values({
    organizationId: organizationOf("calibration_job", jobId),
    jobId,
    action: "approve",
    performedBy: fixture.userId,
    performedAt: at,
  });
  await db.insert(assetAuditLog).values({
    organizationId: organizationOf("asset", fixture.assetId),
    assetId: fixture.assetId,
    action: "create",
    performedBy: fixture.userId,
    performedAt: at,
  });
  await db.insert(customerAuditLog).values({
    organizationId: organizationOf("customer", fixture.customerId),
    customerId: fixture.customerId,
    action: "create",
    performedBy: fixture.userId,
    performedAt: at,
  });
  await db.insert(organizationEventLog).values({
    organizationId: fixture.orgId,
    actorUserId: fixture.userId,
    action: "unit.created",
    entityType: "unit",
    createdAt: at,
  });
  await seedStandard(fixture, at);
  await seedNonConformance(fixture, at);
}

/** Soft-deletes `orgId` directly, with a chosen date (the app stamps now). */
async function markSoftDeleted(
  orgId: string,
  at: Date,
  extra: { retentionYears?: number; legalHold?: boolean } = {},
) {
  await db
    .update(organization)
    .set({
      deletedAt: at,
      status: "SUSPENDED",
      suspendedAt: at,
      ...(extra.retentionYears === undefined
        ? {}
        : { retentionYears: extra.retentionYears }),
      ...(extra.legalHold === undefined ? {} : { legalHold: extra.legalHold }),
    })
    .where(eq(organization.id, orgId));
}

async function organizationExists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, id));
  return rows.length === 1;
}

async function count(table: string, where = sql`true`): Promise<number> {
  const rows = getExecuteRows<{ n: number }>(
    await db.execute(
      sql`select count(*)::int as n from ${sql.identifier(table)} where ${where}`,
    ),
  );
  return rows[0]?.n ?? 0;
}

const NOW = new Date("2026-10-21T00:00:00.000Z");

// ---------------------------------------------------------------------------
// REQ-RET-2
// ---------------------------------------------------------------------------

describe("REQ-RET-2: evidence is never reached by a cascading foreign key", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-RET-2 [HIGH RISK]: in the built database no evidence table has a CASCADE foreign key unless it is a listed owned part", async () => {
    const rows = getExecuteRows<{ tbl: string; col: string; parent: string }>(
      await db.execute(sql`
        select c.conrelid::regclass::text as tbl,
               a.attname as col,
               c.confrelid::regclass::text as parent
          from pg_constraint c
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and c.confdeltype = 'c'`),
    );
    const evidence = new Set(listEvidenceTables());
    const owned = new Set(
      OWNED_PART_EDGES.map((e) => `${e.table}.${e.column}>${e.parent}`),
    );
    const offenders = rows
      .filter((row) => evidence.has(row.tbl))
      .map((row) => `${row.tbl}.${row.col}>${row.parent}`)
      .filter((edge) => !owned.has(edge));
    expect(offenders).toEqual([]);
    // The owned parts really are cascades in the database (not just in schema.ts).
    const found = new Set(
      rows.map((row) => `${row.tbl}.${row.col}>${row.parent}`),
    );
    for (const edge of owned) expect(found.has(edge), edge).toBe(true);
  });

  it("REQ-RET-2 [HIGH RISK]: deleting an organization that holds evidence is refused, whatever the escape hatch", async () => {
    const lab = await seedLab({
      orgId: "org-held",
      evidenceAt: new Date("2025-03-01T00:00:00.000Z"),
    });

    // The purge-only hatch gets past the DELETE guard: the foreign keys decide.
    const failure = await failureOf(() =>
      hardDeleteOrganizationAsPurge(lab.orgId),
    );
    expect(REFERENCED_ROW_CODES).toContain(failure.code);

    expect(await organizationExists(lab.orgId)).toBe(true);
    expect(
      await count("calibration_job", sql`organization_id = ${lab.orgId}`),
    ).toBe(1);
    expect(
      await count("reference_standard", sql`organization_id = ${lab.orgId}`),
    ).toBe(1);
    expect(
      await count("non_conformance", sql`organization_id = ${lab.orgId}`),
    ).toBe(1);
  });

  it.each([
    "calibration_job",
    "reference_standard",
    "non_conformance",
  ] as const)(
    "REQ-RET-2: a single %s row keeps the organization from being deleted",
    async (family) => {
      const lab = await seedLab({ orgId: `org-${family}` });
      const at = new Date("2025-03-01T00:00:00.000Z");
      if (family === "calibration_job") await seedJob(lab, at);
      if (family === "reference_standard") await seedStandard(lab, at);
      if (family === "non_conformance") await seedNonConformance(lab, at);

      const failure = await failureOf(() =>
        hardDeleteOrganizationAsPurge(lab.orgId),
      );
      expect(REFERENCED_ROW_CODES).toContain(failure.code);
      expect(await organizationExists(lab.orgId)).toBe(true);
    },
  );

  it("REQ-RET-2: deleting a customer that has jobs is refused and nothing is erased", async () => {
    const lab = await seedLab({
      orgId: "org-cust",
      evidenceAt: new Date("2025-03-01T00:00:00.000Z"),
    });

    const failure = await failureOf(() =>
      db.delete(customer).where(eq(customer.id, lab.customerId)),
    );
    expect(REFERENCED_ROW_CODES).toContain(failure.code);
    expect(await count("customer", sql`id = ${lab.customerId}`)).toBe(1);
    expect(await count("asset", sql`id = ${lab.assetId}`)).toBe(1);
    expect(await count("calibration_job")).toBe(1);
  });

  it("REQ-RET-2: deleting an asset that has a job is refused", async () => {
    const lab = await seedLab({
      orgId: "org-asset",
      evidenceAt: new Date("2025-03-01T00:00:00.000Z"),
    });

    const failure = await failureOf(() =>
      db.delete(asset).where(eq(asset.id, lab.assetId)),
    );
    expect(REFERENCED_ROW_CODES).toContain(failure.code);
    expect(await count("asset", sql`id = ${lab.assetId}`)).toBe(1);
  });

  it("REQ-RET-2: deleting an asset with an OOT event is refused (the event used to cascade away)", async () => {
    const lab = await seedLab({ orgId: "org-oot" });
    const jobId = await seedJob(lab, new Date("2025-03-01T00:00:00.000Z"));
    await db.insert(assetOotEvent).values({
      jobId,
      assetId: lab.assetId,
      customerId: lab.customerId,
      labOrganizationId: lab.orgId,
      detectedAt: new Date("2025-03-01T00:00:00.000Z"),
    });

    const failure = await failureOf(() =>
      db.delete(asset).where(eq(asset.id, lab.assetId)),
    );
    expect(REFERENCED_ROW_CODES).toContain(failure.code);
    expect(await count("asset_oot_event")).toBe(1);
  });

  it("REQ-RET-2: deleting the reference standard a job used is refused", async () => {
    const lab = await seedLab({
      orgId: "org-std",
      evidenceAt: new Date("2025-03-01T00:00:00.000Z"),
    });
    const [standard] = await db
      .select({ id: referenceStandard.id })
      .from(referenceStandard)
      .where(eq(referenceStandard.organizationId, lab.orgId));
    if (!standard || lab.jobId === null) throw new Error("fixture");
    await db.execute(
      sql`insert into job_standard (organization_id, job_id, standard_id) values (${lab.orgId}, ${lab.jobId}, ${standard.id})`,
    );

    const failure = await failureOf(() =>
      db.delete(referenceStandard).where(eq(referenceStandard.id, standard.id)),
    );
    expect(REFERENCED_ROW_CODES).toContain(failure.code);
    expect(await count("job_standard")).toBe(1);
  });

  it("REQ-RET-2: SET NULL on an actor column stays: deleting the technician keeps the approved job", async () => {
    const lab = await seedLab({ orgId: "org-actor" });
    await db
      .insert(user)
      .values({ id: "tech-1", name: "Tech", email: "tech@lab.test" });
    await seedEvidence(lab, new Date("2025-03-01T00:00:00.000Z"));
    if (lab.jobId === null) throw new Error("fixture");
    // technician_id may only be nulled by the foreign key, never edited: set it
    // while the job is still a draft would need a status change; insert instead.
    await db.execute(sql`
      select set_config('calibra.allow_audit_rewrite', 'on', false)`);
    await db
      .update(calibrationJob)
      .set({ technicianId: "tech-1" })
      .where(eq(calibrationJob.id, lab.jobId));
    await db.execute(sql`
      select set_config('calibra.allow_audit_rewrite', 'off', false)`);

    await db.delete(user).where(eq(user.id, "tech-1"));

    const [job] = await db
      .select({ technicianId: calibrationJob.technicianId })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, lab.jobId));
    expect(job).toEqual({ technicianId: null });
  });
});

// ---------------------------------------------------------------------------
// REQ-RET-3
// ---------------------------------------------------------------------------

describe("REQ-RET-3: a LAB organization is soft-deleted, never hard-deleted", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-RET-3 [HIGH RISK]: DELETE of a LAB organization is refused without the escape hatch, even when it is empty", async () => {
    await seedOrg({ orgId: "org-empty" });

    const failure = await failureOf(() =>
      db.delete(organization).where(eq(organization.id, "org-empty")),
    );
    expect(failure.code).toBe("P0001");
    expect(failure.message).toContain("cannot be hard-deleted");
    expect(await organizationExists("org-empty")).toBe(true);
  });

  it("REQ-RET-3: the purge-only setting lifts the guard for one transaction only", async () => {
    await seedOrg({ orgId: "org-a", userId: "user-a" });
    await seedOrg({ orgId: "org-b", userId: "user-b" });

    await hardDeleteOrganizationAsPurge("org-a");
    expect(await organizationExists("org-a")).toBe(false);

    // The setting was transaction-local: the next plain DELETE is refused again.
    const failure = await failureOf(() =>
      db.delete(organization).where(eq(organization.id, "org-b")),
    );
    expect(failure.code).toBe("P0001");
    expect(await organizationExists("org-b")).toBe(true);
  });

  it("REQ-RET-3: the existing seed escape hatch (calibra.allow_audit_rewrite) also lifts the guard", async () => {
    await seedOrg({ orgId: "org-seed", userId: "user-seed" });

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('calibra.allow_audit_rewrite', 'on', true)`,
      );
      await tx.delete(organization).where(eq(organization.id, "org-seed"));
    });

    expect(await organizationExists("org-seed")).toBe(false);
  });

  it("REQ-RET-3: a CLIENT organization can still be deleted without the hatch", async () => {
    const lab = await seedLab({ orgId: "org-client" });
    await db.delete(customer).where(eq(customer.id, lab.customerId));
    await db.delete(organization).where(eq(organization.id, lab.clientId));
    expect(await organizationExists(lab.clientId)).toBe(false);
  });

  it("REQ-RET-3: soft delete stamps who/when/why, suspends the organization and keeps every row", async () => {
    const lab = await seedLab({
      orgId: "org-soft",
      evidenceAt: new Date("2025-03-01T00:00:00.000Z"),
    });

    const outcome = await softDeleteLabOrganization({
      organizationId: lab.orgId,
      deletedBy: lab.userId,
      reason: "Encerramento das atividades",
    });
    expect(outcome.status).toBe("soft_deleted");

    const [row] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, lab.orgId));
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(row?.deletedBy).toBe(lab.userId);
    expect(row?.deletionReason).toBe("Encerramento das atividades");
    expect(row?.status).toBe("SUSPENDED");
    expect(row?.suspendedAt).toBeInstanceOf(Date);

    // Nothing was erased and the deletion itself is on the organization trail.
    expect(await count("calibration_job")).toBe(1);
    expect(await count("customer")).toBe(1);
    expect(
      await count(
        "organization_event_log",
        sql`organization_id = ${lab.orgId} and action = 'organization.soft_deleted'`,
      ),
    ).toBe(1);

    // Idempotent: a second call changes nothing.
    const again = await softDeleteLabOrganization({
      organizationId: lab.orgId,
      deletedBy: "someone-else",
      reason: "again",
    });
    expect(again.status).toBe("already_deleted");
    const [after] = await db
      .select({ by: organization.deletedBy })
      .from(organization)
      .where(eq(organization.id, lab.orgId));
    expect(after?.by).toBe(lab.userId);
  });

  it("REQ-RET-3: soft delete only applies to LAB organizations that exist", async () => {
    const lab = await seedLab({ orgId: "org-kind" });
    expect(
      (
        await softDeleteLabOrganization({
          organizationId: lab.clientId,
          deletedBy: null,
          reason: "x",
        })
      ).status,
    ).toBe("not_lab");
    expect(
      (
        await softDeleteLabOrganization({
          organizationId: "missing",
          deletedBy: null,
          reason: "x",
        })
      ).status,
    ).toBe("not_found");
  });

  it("REQ-RET-3: a soft-deleted organization must be suspended (CHECK), so requireOrganization locks it", async () => {
    await seedOrg({ orgId: "org-check" });

    const failure = await failureOf(() =>
      db
        .update(organization)
        .set({ deletedAt: new Date() })
        .where(eq(organization.id, "org-check")),
    );
    expect(failure.code).toBe("23514");
    expect(failure.message).toContain("organization_soft_delete_suspended");
  });

  it("REQ-RET-3 [HIGH RISK]: a soft-deleted laboratory is locked out of every authenticated route", async () => {
    const lab = await seedOrg({ orgId: "org-locked", role: "admin" });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });
    const before = await customersRouter.request("/?page=1&limit=10", {
      method: "GET",
    });
    expect(before.status).toBe(200);

    await softDeleteLabOrganization({
      organizationId: lab.orgId,
      deletedBy: lab.userId,
      reason: "teste",
    });

    const after = await customersRouter.request("/?page=1&limit=10", {
      method: "GET",
    });
    expect(after.status).toBe(403);
  });

  it("REQ-RET-3: a soft-deleted laboratory is not an active membership for sign-in", async () => {
    const lab = await seedOrg({ orgId: "org-signin", userId: "owner-1" });
    expect(await hasActiveLabMembership("owner-1@lab.test")).toBe(true);

    await softDeleteLabOrganization({
      organizationId: lab.orgId,
      deletedBy: lab.userId,
      reason: "teste",
    });

    expect(await hasActiveLabMembership("owner-1@lab.test")).toBe(false);
    // The membership row itself stays (retention), it just stops counting.
    expect(await count("member", sql`organization_id = ${lab.orgId}`)).toBe(1);
  });

  it("REQ-RET-3: a soft-deleted laboratory is never the default active organization of a session", async () => {
    const older = await seedOrg({ orgId: "org-older", userId: "multi-user" });
    await seedOrg({ orgId: "org-newer", userId: "other-owner" });
    await db.insert(member).values({
      id: "member-newer",
      organizationId: "org-newer",
      userId: older.userId,
      role: "admin",
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(await findDefaultActiveOrganizationId(older.userId, "LAB")).toBe(
      "org-older",
    );

    await softDeleteLabOrganization({
      organizationId: "org-older",
      deletedBy: null,
      reason: "teste",
    });

    expect(await findDefaultActiveOrganizationId(older.userId, "LAB")).toBe(
      "org-newer",
    );
  });

  it("REQ-RET-3: a pending invitation to a soft-deleted laboratory no longer counts", async () => {
    const lab = await seedOrg({ orgId: "org-invite", userId: "inviter" });
    await db.insert(invitation).values({
      id: "inv-1",
      organizationId: lab.orgId,
      email: "guest@lab.test",
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
      inviterId: lab.userId,
    });
    expect(await hasPendingLabInvitation("guest@lab.test")).toBe(true);

    await softDeleteLabOrganization({
      organizationId: lab.orgId,
      deletedBy: null,
      reason: "teste",
    });

    expect(await hasPendingLabInvitation("guest@lab.test")).toBe(false);
  });

  it("REQ-RET-3: the magic-link preview does not name a soft-deleted laboratory", async () => {
    const lab = await seedOrg({ orgId: "org-preview", userId: "preview-user" });
    const token = randomBytes(24).toString("base64url");
    await db.insert(verification).values({
      id: "ver-1",
      identifier: createHash("sha256").update(token).digest("base64url"),
      value: JSON.stringify({ email: "preview-user@lab.test", name: null }),
      expiresAt: new Date(Date.now() + 600_000),
    });
    const preview = async () => {
      const res = await magicLinkRouter.request(`/preview?token=${token}`);
      return res.json();
    };
    expect(await preview()).toMatchObject({
      found: true,
      organizationName: "Lab org-preview",
    });

    await softDeleteLabOrganization({
      organizationId: lab.orgId,
      deletedBy: null,
      reason: "teste",
    });

    expect(await preview()).toMatchObject({
      found: true,
      organizationName: null,
    });
  });

  it("REQ-RET-3: provisioning cleanup hard-deletes a just-created organization after proving it holds no records", async () => {
    await seedOrg({ orgId: "org-fresh", userId: "user-fresh" });

    await cleanupFailedLabProvisioning({ organizationId: "org-fresh" });

    expect(await organizationExists("org-fresh")).toBe(false);
    expect(await count("member")).toBe(0);
    expect(await count("organization_unit")).toBe(0);
  });

  it("REQ-RET-3 [HIGH RISK]: provisioning cleanup soft-deletes instead when the organization holds any record", async () => {
    const lab = await seedLab({
      orgId: "org-used",
      evidenceAt: new Date("2025-03-01T00:00:00.000Z"),
    });

    await cleanupFailedLabProvisioning({ organizationId: lab.orgId });

    const [row] = await db
      .select({ deletedAt: organization.deletedAt })
      .from(organization)
      .where(eq(organization.id, lab.orgId));
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(await count("calibration_job")).toBe(1);
  });

  it("REQ-RET-3: removeLabOrganization names the evidence tables that kept the organization", async () => {
    const lab = await seedLab({
      orgId: "org-proof",
      evidenceAt: new Date("2025-03-01T00:00:00.000Z"),
    });
    const held = await evidenceTablesHoldingRecords(lab.orgId);
    expect(held).toEqual(
      expect.arrayContaining([
        "asset_audit_log",
        "calibration_job",
        "customer_audit_log",
        "job_audit_log",
        "non_conformance",
        "organization_event_log",
        "reference_standard",
      ]),
    );

    const outcome = await removeLabOrganization({
      organizationId: lab.orgId,
      deletedBy: null,
      reason: "x",
    });
    expect(outcome.status).toBe("soft_deleted");
  });

  it("REQ-RET-3: DELETE /customers/:id answers 409 and erases nothing when the customer has evidence", async () => {
    const lab = await seedLab({
      orgId: "org-409",
      evidenceAt: new Date("2025-03-01T00:00:00.000Z"),
    });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });
    const auditBefore = await count(
      "customer_audit_log",
      sql`customer_id = ${lab.customerId} and action = 'delete'`,
    );

    const res = await customersRouter.request(`/${lab.customerId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "customer_has_retained_records",
    });
    expect(await count("customer", sql`id = ${lab.customerId}`)).toBe(1);
    expect(await organizationExists(lab.clientId)).toBe(true);
    expect(await count("asset", sql`id = ${lab.assetId}`)).toBe(1);
    expect(await count("calibration_job")).toBe(1);
    // The refused delete leaves no misleading "delete" audit row behind.
    expect(
      await count(
        "customer_audit_log",
        sql`customer_id = ${lab.customerId} and action = 'delete'`,
      ),
    ).toBe(auditBefore);
    expect(
      await count(
        "asset_audit_log",
        sql`asset_id = ${lab.assetId} and action = 'delete'`,
      ),
    ).toBe(0);
  });

  it("REQ-RET-3: DELETE /customers/:id still deletes a customer without evidence, with its client organization and an audit trail", async () => {
    const lab = await seedLab({ orgId: "org-del" });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    const res = await customersRouter.request(`/${lab.customerId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await count("customer", sql`id = ${lab.customerId}`)).toBe(0);
    expect(await organizationExists(lab.clientId)).toBe(false);
    expect(
      await count(
        "customer_audit_log",
        sql`customer_id = ${lab.customerId} and action = 'delete'`,
      ),
    ).toBe(1);
    expect(
      await count(
        "asset_audit_log",
        sql`asset_id = ${lab.assetId} and action = 'delete'`,
      ),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// REQ-RET-4
// ---------------------------------------------------------------------------

describe("REQ-RET-4: retention period, legal hold and calibra_retain_until", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-RET-4: a new organization retains for 10 years and is not under legal hold", async () => {
    await seedOrg({ orgId: "org-default" });
    const [row] = await db
      .select({
        years: organization.retentionYears,
        hold: organization.legalHold,
        deletedAt: organization.deletedAt,
      })
      .from(organization)
      .where(eq(organization.id, "org-default"));
    expect(row).toEqual({ years: 10, hold: false, deletedAt: null });
  });

  it("REQ-RET-4 [HIGH RISK]: retention_years below 5 is rejected by a CHECK, on insert and on update", async () => {
    await seedOrg({ orgId: "org-years" });

    const update = await failureOf(() =>
      db
        .update(organization)
        .set({ retentionYears: 4 })
        .where(eq(organization.id, "org-years")),
    );
    expect(update.code).toBe("23514");
    expect(update.message).toContain("organization_retention_years_min");

    const insert = await failureOf(() =>
      db.insert(organization).values({
        id: "org-years-2",
        name: "x",
        slug: "org-years-2",
        createdAt: new Date(),
        retentionYears: 0,
      }),
    );
    expect(insert.code).toBe("23514");

    await db
      .update(organization)
      .set({ retentionYears: 5 })
      .where(eq(organization.id, "org-years"));
    const [row] = await db
      .select({ years: organization.retentionYears })
      .from(organization)
      .where(eq(organization.id, "org-years"));
    expect(row?.years).toBe(5);
  });

  it("REQ-RET-4: calibra_retain_until adds the organization's retention to the record date", async () => {
    await seedOrg({ orgId: "org-ten", userId: "u-ten" });
    await seedOrg({ orgId: "org-five", userId: "u-five" });
    await db
      .update(organization)
      .set({ retentionYears: 5 })
      .where(eq(organization.id, "org-five"));

    const [rows] = getExecuteRows<{
      ten: string;
      five: string;
      unknown_org: string;
      no_date: string | null;
    }>(
      await db.execute(sql`
        select to_char(calibra_retain_until('org-ten', '2020-02-29 12:00:00'::timestamp), 'YYYY-MM-DD HH24:MI:SS') as ten,
               to_char(calibra_retain_until('org-five', '2020-02-29 12:00:00'::timestamp), 'YYYY-MM-DD HH24:MI:SS') as five,
               to_char(calibra_retain_until('nobody', '2020-01-01 00:00:00'::timestamp), 'YYYY-MM-DD HH24:MI:SS') as unknown_org,
               to_char(calibra_retain_until('org-ten', null), 'YYYY-MM-DD') as no_date`),
    );
    expect(rows?.ten).toBe("2030-02-28 12:00:00");
    expect(rows?.five).toBe("2025-02-28 12:00:00");
    // Unknown organization: the platform default of 10 years.
    expect(rows?.unknown_org).toBe("2030-01-01 00:00:00");
    expect(rows?.no_date).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// REQ-RET-5
// ---------------------------------------------------------------------------

const OLD = new Date("2010-06-01T00:00:00.000Z");

/** The mix the purge scenarios share. */
async function seedPurgeScenario() {
  const labs = {
    // soft-deleted in 2012, newest evidence 2010: past 10 years -> eligible
    eligible: await seedLab({ orgId: "org-eligible", evidenceAt: OLD }),
    // soft-deleted, evidence from 2020: inside the 10 years
    recent: await seedLab({
      orgId: "org-recent",
      evidenceAt: new Date("2020-01-01T00:00:00.000Z"),
    }),
    // old evidence but under legal hold
    hold: await seedLab({ orgId: "org-hold", evidenceAt: OLD }),
    // old evidence but NOT soft-deleted
    active: await seedLab({ orgId: "org-active", evidenceAt: OLD }),
    // retention shortened to 5 years: 2018 evidence is past it
    short: await seedLab({
      orgId: "org-short",
      evidenceAt: new Date("2018-01-01T00:00:00.000Z"),
    }),
    // soft-deleted in 2012, never held a record
    empty: await seedLab({ orgId: "org-empty-lab" }),
    // old evidence, but the deletion itself is recent: the clock runs from it
    freshlyDeleted: await seedLab({
      orgId: "org-fresh-del",
      evidenceAt: OLD,
    }),
  };
  const deletedLong = new Date("2012-01-01T00:00:00.000Z");
  await markSoftDeleted("org-eligible", deletedLong);
  await markSoftDeleted("org-recent", new Date("2021-01-01T00:00:00.000Z"));
  await markSoftDeleted("org-hold", deletedLong, { legalHold: true });
  await markSoftDeleted("org-short", new Date("2019-01-01T00:00:00.000Z"), {
    retentionYears: 5,
  });
  await markSoftDeleted("org-empty-lab", deletedLong);
  await markSoftDeleted("org-fresh-del", new Date("2024-01-01T00:00:00.000Z"));
  return labs;
}

const ELIGIBLE = ["org-eligible", "org-empty-lab", "org-short"];
const UNTOUCHED = ["org-recent", "org-hold", "org-active", "org-fresh-del"];

async function snapshotCounts(orgIds: string[]) {
  const result: Record<string, number> = {};
  for (const orgId of orgIds) {
    result[orgId] =
      (await count("calibration_job", sql`organization_id = ${orgId}`)) +
      (await count("reference_standard", sql`organization_id = ${orgId}`)) +
      (await count("non_conformance", sql`organization_id = ${orgId}`)) +
      (await count("organization_event_log", sql`organization_id = ${orgId}`)) +
      (await count("customer", sql`lab_organization_id = ${orgId}`)) +
      (await count(
        "asset_audit_log",
        sql`asset_id in (select id from asset where lab_organization_id = ${orgId})`,
      ));
  }
  return result;
}

// Seeding seven laboratories and scanning ~70 evidence tables per organization is
// heavy next to the other specs, and this tier runs many files in parallel.
const PURGE_TEST_TIMEOUT_MS = 240_000;

describe(
  "REQ-RET-5: the records purge job",
  { timeout: PURGE_TEST_TIMEOUT_MS },
  () => {
    beforeEach(async () => {
      await truncateAll();
    });

    it("REQ-RET-5: disabled and dry-run by default, execute only when asked for exactly", () => {
      expect(readPurgeConfig({})).toEqual({ enabled: false, mode: "dry-run" });
      expect(readPurgeConfig({ RECORDS_PURGE_ENABLED: "false" })).toEqual({
        enabled: false,
        mode: "dry-run",
      });
      expect(
        readPurgeConfig({
          RECORDS_PURGE_ENABLED: "yes",
          RECORDS_PURGE_MODE: "x",
        }),
      ).toEqual({ enabled: false, mode: "dry-run" });
      expect(readPurgeConfig({ RECORDS_PURGE_ENABLED: "true" })).toEqual({
        enabled: true,
        mode: "dry-run",
      });
      expect(
        readPurgeConfig({
          RECORDS_PURGE_ENABLED: "true",
          RECORDS_PURGE_MODE: "execute",
        }),
      ).toEqual({ enabled: true, mode: "execute" });
    });

    it("REQ-RET-5 [HIGH RISK]: the verdict selects exactly the eligible organizations", async () => {
      await seedPurgeScenario();

      const decisions = await evaluatePurgeCandidates(NOW);
      const verdicts = Object.fromEntries(
        decisions.map((d) => [d.organizationId, d.verdict]),
      );

      expect(verdicts).toEqual({
        "org-eligible": "eligible",
        "org-empty-lab": "eligible",
        "org-short": "eligible",
        "org-recent": "in_retention",
        "org-hold": "legal_hold",
        "org-fresh-del": "in_retention",
      });
      // An organization that is not soft-deleted is not even a candidate.
      expect(verdicts["org-active"]).toBeUndefined();

      const eligible = decisions.find(
        (d) => d.organizationId === "org-eligible",
      );
      expect(eligible?.newestEvidenceAt?.toISOString()).toBe(
        "2010-06-01T00:00:00.000Z",
      );
      // The clock starts at the newest record, and the laboratory's own deletion
      // (2012-01-01) is a record: 2012 + 10 years.
      expect(eligible?.retainUntil?.toISOString()).toBe(
        "2022-01-01T00:00:00.000Z",
      );
    });

    it("REQ-RET-5: the verdict flips at the retention boundary", async () => {
      await seedLab({
        orgId: "org-edge",
        evidenceAt: new Date("2016-10-21T00:00:00.000Z"),
      });
      await markSoftDeleted("org-edge", new Date("2016-10-21T00:00:00.000Z"));

      const before = await evaluatePurgeCandidates(
        new Date("2026-10-20T23:59:59.000Z"),
      );
      const after = await evaluatePurgeCandidates(
        new Date("2026-10-21T00:00:00.000Z"),
      );
      expect(before.map((d) => d.verdict)).toEqual(["in_retention"]);
      expect(after.map((d) => d.verdict)).toEqual(["eligible"]);
    });

    it("REQ-RET-5 [HIGH RISK]: disabled, the job does nothing", async () => {
      await seedPurgeScenario();
      const before = await snapshotCounts([...ELIGIBLE, ...UNTOUCHED]);

      const result = await runRecordsPurge({
        config: { enabled: false, mode: "execute" },
        now: NOW,
      });

      expect(result).toEqual({
        enabled: false,
        mode: "execute",
        evaluated: 0,
        eligible: [],
        outcomes: [],
      });
      expect(await snapshotCounts([...ELIGIBLE, ...UNTOUCHED])).toEqual(before);
      expect(await count("platform_event_log")).toBe(0);
    });

    it("REQ-RET-5 [HIGH RISK]: enabled in dry-run mode it lists the eligible organizations and deletes and writes nothing", async () => {
      await seedPurgeScenario();
      const before = await snapshotCounts([...ELIGIBLE, ...UNTOUCHED]);
      const organizations = await count("organization");

      const result = await runRecordsPurge({
        config: { enabled: true, mode: "dry-run" },
        now: NOW,
      });

      expect(result.mode).toBe("dry-run");
      expect(result.eligible).toEqual(ELIGIBLE.toSorted());
      expect(result.outcomes.map((o) => o.status)).toEqual([
        "would_purge",
        "would_purge",
        "would_purge",
      ]);
      expect(await snapshotCounts([...ELIGIBLE, ...UNTOUCHED])).toEqual(before);
      expect(await count("organization")).toBe(organizations);
      expect(await count("platform_event_log")).toBe(0);
    });

    it("REQ-18J-PURGE-1 [HIGH RISK]: as calibra_app the purge runs on the system path: same verdicts (it reads each laboratory's evidence), same erasure", async () => {
      const labs = await seedPurgeScenario();
      const untouchedBefore = await snapshotCounts(UNTOUCHED);

      // The evidence probe reads every evidence table of each laboratory. Run on
      // the application role it would see none (no organization named) and
      // report no newest evidence: the verdict below proves it is the owner.
      const decisions = await asApplicationRole(() =>
        evaluatePurgeCandidates(NOW),
      );
      expect(
        decisions
          .find((d) => d.organizationId === "org-eligible")
          ?.newestEvidenceAt?.toISOString(),
      ).toBe("2010-06-01T00:00:00.000Z");
      expect(
        decisions.find((d) => d.organizationId === "org-recent")?.verdict,
      ).toBe("in_retention");

      const result = await asApplicationRole(() =>
        runRecordsPurge({
          config: { enabled: true, mode: "execute" },
          now: NOW,
        }),
      );
      expect(result.outcomes.map((o) => o.status)).toEqual([
        "purged",
        "purged",
        "purged",
      ]);
      for (const orgId of ELIGIBLE) {
        expect(await organizationExists(orgId), orgId).toBe(false);
      }
      // The portal login organization of a purged laboratory goes with it, in the
      // same transaction, and nobody else lost a row.
      expect(await organizationExists(labs.eligible.clientId)).toBe(false);
      expect(await snapshotCounts(UNTOUCHED)).toEqual(untouchedBefore);
      expect(await organizationExists(labs.hold.clientId)).toBe(true);
    });

    it("REQ-RET-5 [HIGH RISK]: execute mode purges exactly the eligible organizations, audit event first, and nobody else", async () => {
      const labs = await seedPurgeScenario();
      const untouchedBefore = await snapshotCounts(UNTOUCHED);
      expect(Object.values(untouchedBefore).every((n) => n > 0)).toBe(true);

      const result = await runRecordsPurge({
        config: { enabled: true, mode: "execute" },
        now: NOW,
      });

      expect(result.outcomes.map((o) => o.status)).toEqual([
        "purged",
        "purged",
        "purged",
      ]);

      for (const orgId of ELIGIBLE) {
        expect(await organizationExists(orgId), orgId).toBe(false);
        expect(await snapshotCounts([orgId]), orgId).toEqual({ [orgId]: 0 });
        expect(await count("member", sql`organization_id = ${orgId}`)).toBe(0);
        expect(
          await count("organization_unit", sql`organization_id = ${orgId}`),
        ).toBe(0);
      }
      // The portal login organization of a purged laboratory goes with it.
      expect(await organizationExists(labs.eligible.clientId)).toBe(false);
      // job_audit_log / customer_audit_log carry no organization column: they
      // are reached through the entity they document.
      expect(
        await count("job_audit_log", sql`job_id = ${labs.eligible.jobId}`),
      ).toBe(0);
      expect(
        await count(
          "customer_audit_log",
          sql`customer_id = ${labs.eligible.customerId}`,
        ),
      ).toBe(0);

      // Nobody else lost a row.
      expect(await snapshotCounts(UNTOUCHED)).toEqual(untouchedBefore);
      for (const orgId of UNTOUCHED) {
        expect(await organizationExists(orgId), orgId).toBe(true);
      }
      expect(await organizationExists(labs.hold.clientId)).toBe(true);
      expect(
        await count("job_audit_log", sql`job_id = ${labs.hold.jobId}`),
      ).toBe(1);

      // Platform audit trail: started before completed, one pair per purged org.
      const events = await db
        .select({
          id: platformEventLog.id,
          action: platformEventLog.action,
          entityId: platformEventLog.entityId,
        })
        .from(platformEventLog)
        .orderBy(platformEventLog.id);
      expect(events.map((e) => e.action)).toEqual(
        ELIGIBLE.flatMap(() => [
          "records.purge.started",
          "records.purge.completed",
        ]),
      );
      expect(new Set(events.map((e) => e.entityId))).toEqual(new Set(ELIGIBLE));
      const [completed] = await db
        .select({ details: platformEventLog.details })
        .from(platformEventLog)
        .where(
          and(
            eq(platformEventLog.action, "records.purge.completed"),
            eq(platformEventLog.entityId, "org-eligible"),
          ),
        );
      expect(completed?.details).toMatchObject({
        slug: "org-eligible",
        retentionYears: 10,
        deletedRows: { calibration_job: 1, reference_standard: 1 },
      });
    });

    it("REQ-RET-5 [HIGH RISK]: records.purge.started is committed by another transaction before the first row is deleted", async () => {
      await seedLab({ orgId: "org-order", evidenceAt: OLD });
      await markSoftDeleted("org-order", new Date("2012-01-01T00:00:00.000Z"));
      // A probe in the database itself: deleting a job raises unless a `started`
      // event for its organization already exists and was written by a
      // DIFFERENT transaction (xmin is the writer's xid), i.e. is committed.
      await db.execute(sql`
        create or replace function test_purge_requires_started() returns trigger
        language plpgsql as $$
        begin
          if not exists (
            select 1 from platform_event_log
             where action = 'records.purge.started'
               and entity_id = old.organization_id
               and xmin::text::bigint <> (txid_current() % 4294967296)
          ) then
            raise exception 'purge started event not committed before delete';
          end if;
          return old;
        end $$`);
      await db.execute(sql`
        create trigger test_purge_requires_started before delete on calibration_job
        for each row execute function test_purge_requires_started()`);

      try {
        // Control: the probe does bite when nothing was announced.
        const bare = await failureOf(() =>
          db.transaction(async (tx) => {
            await tx.execute(
              sql`select set_config('calibra.allow_audit_rewrite', 'on', true)`,
            );
            await tx.execute(
              sql`delete from calibration_job where organization_id = 'org-order'`,
            );
          }),
        );
        expect(bare.message).toContain("not committed before delete");

        const result = await runRecordsPurge({
          config: { enabled: true, mode: "execute" },
          now: NOW,
        });

        expect(result.outcomes.map((o) => o.status)).toEqual(["purged"]);
        expect(await organizationExists("org-order")).toBe(false);
        const actions = (
          await db
            .select({ action: platformEventLog.action })
            .from(platformEventLog)
            .orderBy(platformEventLog.id)
        ).map((row) => row.action);
        expect(actions).toEqual([
          "records.purge.started",
          "records.purge.completed",
        ]);
      } finally {
        await db.execute(
          sql`drop trigger if exists test_purge_requires_started on calibration_job`,
        );
        await db.execute(
          sql`drop function if exists test_purge_requires_started()`,
        );
      }
    });

    it("REQ-RET-5: a purge that fails leaves the organization intact and says so on the platform event log", async () => {
      const lab = await seedLab({ orgId: "org-doomed", evidenceAt: OLD });
      await markSoftDeleted("org-doomed", new Date("2012-01-01T00:00:00.000Z"));
      // A second laboratory's service points at the doomed one's unit (service.unit_id
      // is RESTRICT): a reference the erasure cannot remove, so the transaction
      // must roll back as a whole.
      const other = await seedLab({ orgId: "org-other" });
      await db
        .update(service)
        .set({ unitId: lab.unitId })
        .where(eq(service.organizationId, other.orgId));

      const result = await runRecordsPurge({
        config: { enabled: true, mode: "execute" },
        now: NOW,
      });

      expect(result.outcomes).toEqual([
        expect.objectContaining({
          organizationId: "org-doomed",
          status: "failed",
        }),
      ]);
      expect(await organizationExists("org-doomed")).toBe(true);
      expect(
        await count("calibration_job", sql`organization_id = 'org-doomed'`),
      ).toBe(1);
      const actions = (
        await db
          .select({ action: platformEventLog.action })
          .from(platformEventLog)
      ).map((row) => row.action);
      expect(actions).toEqual([
        "records.purge.started",
        "records.purge.failed",
      ]);
    });
  },
);

// ---------------------------------------------------------------------------
// REQ-RET-3: what a suspended / soft-deleted laboratory still exposes
// ---------------------------------------------------------------------------

describe("REQ-RET-3: a suspended or soft-deleted laboratory's outward surfaces", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function keyFor(orgId: string, userId: string) {
    const { rawKey } = await seedApiKey({
      organizationId: orgId,
      createdBy: userId,
      keyId: `key-${orgId}`,
      scopes: ["customers:read"],
    });
    return { authorization: `Bearer ${rawKey}` };
  }

  it("REQ-RET-3: an active laboratory's API key works (control)", async () => {
    const lab = await seedOrg({ orgId: "org-key-ok" });
    const headers = await keyFor(lab.orgId, lab.userId);

    expect(
      (await publicApiRouter.request("/customers", { headers })).status,
    ).toBe(200);
  });

  it("REQ-RET-3 [HIGH RISK]: the API key of a SUSPENDED laboratory is refused with 403 organization_suspended, on v1 and v2", async () => {
    const lab = await seedOrg({ orgId: "org-key-susp" });
    const headers = await keyFor(lab.orgId, lab.userId);
    await db
      .update(organization)
      .set({ status: "SUSPENDED", suspendedAt: new Date() })
      .where(eq(organization.id, lab.orgId));

    for (const [name, router] of [
      ["v1", publicApiRouter],
      ["v2", publicApiV2Router],
    ] as const) {
      const res = await router.request("/customers", { headers });
      expect(res.status, name).toBe(403);
      expect(await res.json(), name).toMatchObject({
        code: "organization_suspended",
      });
    }
  });

  it("REQ-RET-3 [HIGH RISK]: the API key of a SOFT-DELETED laboratory is refused with 403 organization_deleted, even if it was not revoked", async () => {
    const lab = await seedOrg({ orgId: "org-key-del" });
    const headers = await keyFor(lab.orgId, lab.userId);
    await markSoftDeleted(lab.orgId, new Date("2026-01-01T00:00:00.000Z"));

    for (const [name, router] of [
      ["v1", publicApiRouter],
      ["v2", publicApiV2Router],
    ] as const) {
      const res = await router.request("/customers", { headers });
      expect(res.status, name).toBe(403);
      expect(await res.json(), name).toMatchObject({
        code: "organization_deleted",
      });
    }
  });

  it("REQ-RET-3: softDeleteLabOrganization revokes every active key of the laboratory, with an audit row each", async () => {
    const lab = await seedOrg({ orgId: "org-key-rev" });
    const other = await seedOrg({ orgId: "org-key-rev-2", userId: "u-2" });
    const headers = await keyFor(lab.orgId, lab.userId);
    const otherHeaders = await keyFor(other.orgId, other.userId);
    await seedApiKey({
      organizationId: lab.orgId,
      createdBy: lab.userId,
      keyId: "key-already-revoked",
      scopes: ["customers:read"],
      revokedAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    await softDeleteLabOrganization({
      organizationId: lab.orgId,
      deletedBy: lab.userId,
      reason: "Encerramento das atividades",
    });

    const res = await publicApiRouter.request("/customers", { headers });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("inválida");
    // Another laboratory's key is untouched.
    expect(
      (
        await publicApiRouter.request("/customers", {
          headers: otherHeaders,
        })
      ).status,
    ).toBe(200);
    // Only the key that was active got a revoke row; the old revocation stays.
    expect(
      await count(
        "organization_api_key_audit_log",
        sql`organization_id = ${lab.orgId} and action = 'revoke'`,
      ),
    ).toBe(1);
    const [old] = await db
      .select({ revokedAt: organizationApiKey.revokedAt })
      .from(organizationApiKey)
      .where(eq(organizationApiKey.id, "key-already-revoked"));
    expect(old?.revokedAt?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("REQ-RET-3 [HIGH RISK]: an issued (APPROVED and SUPERSEDED) certificate of a soft-deleted laboratory still verifies at /verify", async () => {
    const lab = await seedLab({
      orgId: "org-verify",
      evidenceAt: new Date("2025-03-01T00:00:00.000Z"),
    });
    const approvedId = lab.jobId;
    if (approvedId === null) throw new Error("fixture");
    await seedJob(lab, new Date("2025-03-02T00:00:00.000Z"), {
      jobId: "CAL-SUPERSEDED",
      status: "SUPERSEDED",
      supersededById: approvedId,
      supersededAt: new Date("2025-03-02T00:00:00.000Z"),
    });
    const jobs = await db
      .select({
        status: calibrationJob.status,
        token: calibrationJob.verificationToken,
      })
      .from(calibrationJob)
      .where(eq(calibrationJob.organizationId, lab.orgId));
    expect(jobs.map((row) => row.status).toSorted()).toEqual([
      "APPROVED",
      "SUPERSEDED",
    ]);

    const outcome = await softDeleteLabOrganization({
      organizationId: lab.orgId,
      deletedBy: lab.userId,
      reason: "Encerramento das atividades",
    });
    expect(outcome.status).toBe("soft_deleted");

    for (const row of jobs) {
      const res = await verifyRouter.request(`/${row.token}`);
      expect(res.status, row.status).toBe(200);
      expect(await res.json(), row.status).toMatchObject({
        valid: true,
        status: row.status,
        lab: "Lab org-verify",
      });
    }
  });
});
