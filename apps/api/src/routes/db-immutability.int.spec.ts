/**
 * db-immutability.int.spec.ts — Real-Postgres proof that the regulated
 * invariants hold at the database, not only in TypeScript (migration 0115):
 *
 *   REQ-DBIMM-001  an APPROVED / SUPERSEDED calibration_job rejects edits to its
 *                  regulated content, naming the job and the column
 *   REQ-DBIMM-002  the operational columns, the amendment, the write-once
 *                  completions and FK SET NULL unlinks stay allowed; a direct
 *                  UPDATE cannot unlink
 *   REQ-DBIMM-003  an APPROVED / SUPERSEDED calibration_job cannot be deleted
 *   REQ-DBIMM-004  issued_certificate_snapshot is append-only
 *   REQ-DBIMM-005  every *_audit_log table and event log is append-only
 *   REQ-DBIMM-006  the seed escape hatch lifts the triggers for one
 *                  transaction only
 *   REQ-DBIMM-007  platform_event_log stays editable only for the public-signup
 *                  reservation row
 *   REQ-DBIMM-009  no route writes to an issued certificate: assigning a
 *                  technician or editing a SUPERSEDED / APPROVED job is refused
 *                  with a client error instead of reaching the trigger
 *   REQ-DBIMM-008  evidence survives deletion of the organization / user that
 *                  it documents (no cascading FK, FK SET NULL still works)
 *   REQ-EVID-4..8  (migration 0130) the application role cannot rewrite or delete
 *                  evidence: UPDATE/DELETE/TRUNCATE are not granted, and no GUC lifts
 *                  a guard for a session that is not the table owner
 *
 * The harness builds the schema from schema.ts and applies the migration-0115
 * section of packages/db/sql/schema-extras.sql, so these tests also prove the
 * triggers are present in a freshly built database.
 */

import { insertJobs } from "../../test/integration/job-fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { organizationOf } from "../../test/integration/organization-of";
import { db } from "@calibra-facil/db";
import {
  accreditedScopeLineAuditLog,
  asset,
  assetType,
  automaticSendAuditLog,
  calibrationJob,
  calibrationVisit,
  certificateNumberingAuditLog,
  customer,
  financialAuditLog,
  integrationEventLog,
  issuedCertificateSnapshot,
  jobAuditLog,
  organization,
  organizationApiKey,
  organizationEventLog,
  platformEventLog,
  service,
  serviceOrderEventLog,
  user,
} from "@calibra-facil/db/schema";
import { eq, sql } from "drizzle-orm";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { hardDeleteOrganizationAsPurge } from "../../test/integration/records-retention";
import { createApiKeySecret } from "../lib/api-keys";
import { openAppRoleDb, sqlStateOf } from "../../test/integration/rls";
import {
  APPEND_ONLY_EVIDENCE_TABLES,
  NO_UPDATE_EVIDENCE_TABLES,
} from "@calibra-facil/db/evidence-tables";
import { createRoleDatabase } from "@calibra-facil/db/role-connection";
import { seedExtraMember } from "../../test/integration/tenant-refs";
import { applyJobTimeline } from "../cli/seed-demo/timeline";
import { jobsRouter } from "./jobs";
import { publicApiV2Router } from "./public-api-v2";

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobSubmittedForReview: vi.fn().mockResolvedValue(undefined),
  notifyJobApproved: vi.fn().mockResolvedValue(undefined),
  notifyJobRejected: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyCertificateAmended: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type PgFailure = { code: string | null; message: string; hint: string | null };

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
      const hint = typeof current.hint === "string" ? current.hint : null;
      if (code !== null) last = { code, message, hint };
      current = current.cause;
    }
    if (last) return last;
    throw error;
  }
  throw new Error("expected the statement to be rejected by Postgres");
}

const MINIMAL_METHOD_SNAPSHOT = {
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

type Status =
  | "DRAFT"
  | "IN_PROGRESS"
  | "REVIEW"
  | "GENERATING_PDF"
  | "APPROVED"
  | "REJECTED"
  | "CANCELED"
  | "SUPERSEDED";

async function seedFixture(orgId = "org-imm", userId = "user-imm") {
  const org = await seedOrg({ orgId, userId, role: "admin" });
  await db.insert(organization).values({
    id: `client-${orgId}`,
    name: `Client ${orgId}`,
    slug: `client-${orgId}`,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type: "CLIENT",
    status: "ACTIVE",
  });
  const [cust] = await db
    .insert(customer)
    .values({
      name: `Customer ${orgId}`,
      labOrganizationId: orgId,
      authOrganizationId: `client-${orgId}`,
    })
    .returning({ id: customer.id });
  const [type] = await db
    .insert(assetType)
    .values({ name: `AT ${orgId}`, slug: `at-${orgId}`, definition: [] })
    .returning({ id: assetType.id });
  if (!cust || !type) throw new Error("seedFixture: customer/type failed");
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
  if (!instrument || !svc) throw new Error("seedFixture: asset/service failed");
  return {
    ...org,
    customerId: cust.id,
    assetId: instrument.id,
    serviceId: svc.id,
  };
}

type Fixture = Awaited<ReturnType<typeof seedFixture>>;

async function seedJob(
  fixture: Fixture,
  status: Status,
  overrides: Partial<typeof calibrationJob.$inferInsert> = {},
): Promise<number> {
  const [row] = await insertJobs({
    jobId: overrides.jobId ?? `CAL-${status}-${Math.random()}`,
    organizationId: fixture.orgId,
    unitId: fixture.unitId,
    customerId: fixture.customerId,
    assetId: fixture.assetId,
    serviceId: fixture.serviceId,
    createdBy: fixture.userId,
    status,
    methodSnapshot: MINIMAL_METHOD_SNAPSHOT,
    data: { indication: "10" },
    results: { value: 10.01, expandedUncertainty: 0.02, k: 2 },
    performedAt: new Date("2026-02-01T10:00:00.000Z"),
    approvedBy: status === "APPROVED" ? fixture.userId : null,
    approvedAt:
      status === "APPROVED" ? new Date("2026-02-02T10:00:00.000Z") : null,
    certificateUrl: status === "APPROVED" ? "https://files.test/c.pdf" : null,
    ...overrides,
  });
  if (!row) throw new Error("seedJob: insert failed");
  return row.id;
}

async function statusOf(id: number): Promise<string | undefined> {
  const [row] = await db
    .select({ status: calibrationJob.status })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, id));
  return row?.status;
}

// ---------------------------------------------------------------------------

describe("calibration_job immutability trigger (migration 0115)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  const frozenEdits = [
    ["results", { results: { value: 99 } }],
    ["data", { data: { indication: "99" } }],
    ["performed_at", { performedAt: new Date("2026-03-01T00:00:00.000Z") }],
    ["approved_by", { approvedBy: "someone-else" }],
    ["approved_at", { approvedAt: new Date("2026-03-01T00:00:00.000Z") }],
    ["certificate_url", { certificateUrl: "https://files.test/other.pdf" }],
    ["job_id", { jobId: "CAL-RENUMBERED" }],
    ["certificate_name", { certificateName: "other" }],
    ["verification_token", { verificationToken: "not-the-token" }],
    ["scope_override_justification", { scopeOverrideJustification: "x" }],
    ["scope_compliance_status", { scopeComplianceStatus: "WITHIN_SCOPE" }],
    [
      "method_snapshot",
      { methodSnapshot: { ...MINIMAL_METHOD_SNAPSHOT, methodVersion: 2 } },
    ],
    ["environmental_snapshot", { environmentalSnapshot: null }],
    ["standards_snapshot", { standardsSnapshot: [] }],
    ["method_deviations", { methodDeviations: "desvio" }],
    ["created_by", { createdBy: "someone-else" }],
    ["status", { status: "CANCELED" as const }],
  ] as const;

  it.each(frozenEdits)(
    "REQ-DBIMM-001 [HIGH RISK]: an APPROVED job rejects an edit of %s, naming the job and the column",
    async (column, patch) => {
      const fixture = await seedFixture();
      await db
        .insert(user)
        .values({ id: "someone-else", name: "S", email: "s@lab.test" });
      const id = await seedJob(fixture, "APPROVED", {
        jobId: "CAL-FROZEN-1",
        environmentalSnapshot: {
          recordedAt: "2026-02-01T10:00:00.000Z",
          withinLimits: true,
        },
      });

      const failure = await failureOf(() =>
        db.update(calibrationJob).set(patch).where(eq(calibrationJob.id, id)),
      );

      expect(failure.code).toBe("P0001");
      expect(failure.message).toContain(`calibration_job ${id} (CAL-FROZEN-1)`);
      expect(failure.message).toContain(`column ${column} is frozen`);
    },
  );

  it("REQ-DBIMM-001: a SUPERSEDED job is frozen too, and cannot be revived", async () => {
    const fixture = await seedFixture();
    const id = await seedJob(fixture, "SUPERSEDED", {
      jobId: "CAL-SUP-1",
      supersededById: 999,
      supersededAt: new Date("2026-03-01T00:00:00.000Z"),
    });

    const edit = await failureOf(() =>
      db
        .update(calibrationJob)
        .set({ results: { value: 1 } })
        .where(eq(calibrationJob.id, id)),
    );
    expect(edit.message).toContain("column results is frozen");

    const revive = await failureOf(() =>
      db
        .update(calibrationJob)
        .set({ status: "APPROVED" })
        .where(eq(calibrationJob.id, id)),
    );
    expect(revive.message).toContain("column status is frozen");
  });

  it("REQ-DBIMM-001: rejects the whole statement and leaves the row untouched", async () => {
    const fixture = await seedFixture();
    const id = await seedJob(fixture, "APPROVED", { jobId: "CAL-ATOMIC" });

    await failureOf(() =>
      db
        .update(calibrationJob)
        .set({ labelUrl: "https://files.test/l.png", results: { value: 1 } })
        .where(eq(calibrationJob.id, id)),
    );

    const [row] = await db
      .select({
        labelUrl: calibrationJob.labelUrl,
        results: calibrationJob.results,
      })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, id));
    expect(row?.labelUrl).toBeNull();
    expect(row?.results).toEqual({
      value: 10.01,
      expandedUncertainty: 0.02,
      k: 2,
    });
  });

  it("REQ-DBIMM-002: operational columns (updated_at, label_url) and no-op rewrites stay allowed", async () => {
    const fixture = await seedFixture();
    const id = await seedJob(fixture, "APPROVED", { jobId: "CAL-OPS" });

    await db
      .update(calibrationJob)
      .set({ labelUrl: "https://files.test/label.png", updatedAt: new Date() })
      .where(eq(calibrationJob.id, id));
    // Writing a column back to the value it already holds is not an edit.
    await db
      .update(calibrationJob)
      .set({ results: { value: 10.01, expandedUncertainty: 0.02, k: 2 } })
      .where(eq(calibrationJob.id, id));

    const [row] = await db
      .select({ labelUrl: calibrationJob.labelUrl })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, id));
    expect(row?.labelUrl).toBe("https://files.test/label.png");
  });

  it("REQ-DBIMM-002: the worker's GENERATING_PDF -> APPROVED issuance still writes the certificate", async () => {
    const fixture = await seedFixture();
    const id = await seedJob(fixture, "GENERATING_PDF", {
      jobId: "CAL-ISSUE",
      approvedBy: fixture.userId,
    });

    await db.execute(sql`
      UPDATE calibration_job
         SET status = 'APPROVED', certificate_url = 'https://files.test/c.pdf',
             signature_metadata = '{"signerName":"A"}'::jsonb,
             signature_verdict = '{"overall":"VALID"}'::jsonb, updated_at = now()
       WHERE id = ${id} AND status = 'GENERATING_PDF'`);

    expect(await statusOf(id)).toBe("APPROVED");
  });

  it("REQ-DBIMM-002: write-once columns fill from NULL but never change once set", async () => {
    const fixture = await seedFixture();
    const id = await seedJob(fixture, "APPROVED", {
      jobId: "CAL-ONCE",
      certificateUrl: null,
    });

    // as-found backfill and a late certificate url: NULL -> value is allowed.
    await db
      .update(calibrationJob)
      .set({
        asFoundConformity: "CONFORMING",
        asFoundMargins: [0.5],
        certificateUrl: "https://files.test/c.pdf",
      })
      .where(eq(calibrationJob.id, id));

    const failure = await failureOf(() =>
      db
        .update(calibrationJob)
        .set({ asFoundConformity: "NON_CONFORMING" })
        .where(eq(calibrationJob.id, id)),
    );
    expect(failure.message).toContain("column as_found_conformity is frozen");
  });

  it("REQ-DBIMM-002 [HIGH RISK]: the amendment (APPROVED -> SUPERSEDED with superseded_by_id) is allowed and nothing else moves with it", async () => {
    const fixture = await seedFixture();
    const id = await seedJob(fixture, "APPROVED", { jobId: "CAL-AMEND-ORIG" });
    const amendedId = await seedJob(fixture, "DRAFT", {
      jobId: "CAL-AMEND-NEW",
      supersedesId: id,
    });

    // Without the link to the amendment it is not an amendment.
    const bare = await failureOf(() =>
      db
        .update(calibrationJob)
        .set({ status: "SUPERSEDED" })
        .where(eq(calibrationJob.id, id)),
    );
    expect(bare.message).toContain("column status is frozen");

    // The amendment may not carry an edit of the certificate along with it.
    const smuggled = await failureOf(() =>
      db
        .update(calibrationJob)
        .set({
          status: "SUPERSEDED",
          supersededById: amendedId,
          supersededAt: new Date(),
          amendmentReason: "Correção",
          results: { value: 1 },
        })
        .where(eq(calibrationJob.id, id)),
    );
    expect(smuggled.message).toContain("column results is frozen");

    await db
      .update(calibrationJob)
      .set({
        status: "SUPERSEDED",
        supersededById: amendedId,
        supersededAt: new Date(),
        amendmentReason: "Correção",
      })
      .where(eq(calibrationJob.id, id));
    expect(await statusOf(id)).toBe("SUPERSEDED");
  });

  it("REQ-DBIMM-002: the amend route still supersedes an APPROVED job and creates the DRAFT amendment", async () => {
    const fixture = await seedFixture();
    loginAs({ userId: fixture.userId, organizationId: fixture.orgId });
    const id = await seedJob(fixture, "APPROVED", { jobId: "CAL-ROUTE-AMEND" });

    const res = await jobsRouter.request(`/${id}/amend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Correcao do valor de referencia" }),
    });

    expect(res.status).toBe(201);
    expect(await statusOf(id)).toBe("SUPERSEDED");
    const amendments = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.supersedesId, id));
    expect(amendments).toEqual([{ status: "DRAFT" }]);
  });

  it("REQ-DBIMM-002: deleting a user nulls the technician link (FK SET NULL) but a direct UPDATE cannot", async () => {
    const fixture = await seedFixture();
    await db
      .insert(user)
      .values({ id: "tech-1", name: "Tech", email: "tech@lab.test" });
    const id = await seedJob(fixture, "APPROVED", {
      jobId: "CAL-TECH",
      technicianId: "tech-1",
    });

    const direct = await failureOf(() =>
      db
        .update(calibrationJob)
        .set({ technicianId: null })
        .where(eq(calibrationJob.id, id)),
    );
    expect(direct.message).toContain("column technician_id is frozen");

    await db.delete(user).where(eq(user.id, "tech-1"));
    const [row] = await db
      .select({ technicianId: calibrationJob.technicianId })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, id));
    expect(row?.technicianId).toBeNull();
  });

  it("REQ-DBIMM-002: deleting the visit nulls the job's visit link (FK SET NULL) but a direct UPDATE cannot", async () => {
    const fixture = await seedFixture();
    const [visit] = await db
      .insert(calibrationVisit)
      .values({
        organizationId: fixture.orgId,
        unitId: fixture.unitId,
        customerId: fixture.customerId,
        createdBy: fixture.userId,
      })
      .returning({ id: calibrationVisit.id });
    if (!visit) throw new Error("visit insert failed");
    const id = await seedJob(fixture, "APPROVED", {
      jobId: "CAL-VISIT",
      visitId: visit.id,
    });

    const direct = await failureOf(() =>
      db
        .update(calibrationJob)
        .set({ visitId: null })
        .where(eq(calibrationJob.id, id)),
    );
    expect(direct.message).toContain("column visit_id is frozen");

    await db.delete(calibrationVisit).where(eq(calibrationVisit.id, visit.id));
    const [row] = await db
      .select({ visitId: calibrationJob.visitId })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, id));
    expect(row?.visitId).toBeNull();
  });

  it("REQ-DBIMM-002: a jsonb write-once column holding JSON null counts as set", async () => {
    const fixture = await seedFixture();
    const id = await seedJob(fixture, "APPROVED", { jobId: "CAL-JSON-NULL" });
    await db.execute(
      sql`UPDATE calibration_job SET signature_metadata = 'null'::jsonb WHERE id = ${id}`,
    );

    const failure = await failureOf(() =>
      db.execute(
        sql`UPDATE calibration_job SET signature_metadata = '{"signerName":"B"}'::jsonb WHERE id = ${id}`,
      ),
    );
    expect(failure.message).toContain("column signature_metadata is frozen");
  });

  it("REQ-DBIMM-002: a job that is not yet approved stays fully editable", async () => {
    const fixture = await seedFixture();
    const id = await seedJob(fixture, "REVIEW", {
      jobId: "CAL-DRAFTY",
      approvedBy: null,
      approvedAt: null,
      certificateUrl: null,
    });

    await db
      .update(calibrationJob)
      .set({ results: { value: 2 }, data: { indication: "2" } })
      .where(eq(calibrationJob.id, id));
    await db.delete(calibrationJob).where(eq(calibrationJob.id, id));
    expect(await statusOf(id)).toBeUndefined();
  });

  it.each(["APPROVED", "SUPERSEDED"] as const)(
    "REQ-DBIMM-003 [HIGH RISK]: a %s job cannot be deleted",
    async (status) => {
      const fixture = await seedFixture();
      const id = await seedJob(fixture, status, { jobId: `CAL-DEL-${status}` });

      const failure = await failureOf(() =>
        db.delete(calibrationJob).where(eq(calibrationJob.id, id)),
      );

      expect(failure.code).toBe("P0001");
      expect(failure.message).toContain(
        `calibration_job ${id} (CAL-DEL-${status}): a ${status} job cannot be deleted`,
      );
      expect(await statusOf(id)).toBe(status);
    },
  );
});

// ---------------------------------------------------------------------------

describe("append-only evidence tables (migration 0115)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function seedSnapshot(fixture: Fixture) {
    const jobId = await seedJob(fixture, "APPROVED", { jobId: "CAL-SNAP" });
    const [row] = await db
      .insert(issuedCertificateSnapshot)
      .values({
        organizationId: fixture.orgId,
        jobId,
        certificateNumber: "CAL-SNAP",
        pdfR2Key: "certificates/c.pdf",
        pdfSha256: "a".repeat(64),
        inputDataSnapshot: { value: 10.01 },
        issuedBy: fixture.userId,
      })
      .returning({ id: issuedCertificateSnapshot.id });
    if (!row) throw new Error("seedSnapshot: insert failed");
    return { id: row.id, jobId };
  }

  it("REQ-DBIMM-004 [HIGH RISK]: issued_certificate_snapshot rejects UPDATE and DELETE", async () => {
    const fixture = await seedFixture();
    const { id } = await seedSnapshot(fixture);

    const update = await failureOf(() =>
      db
        .update(issuedCertificateSnapshot)
        .set({ pdfSha256: "b".repeat(64) })
        .where(eq(issuedCertificateSnapshot.id, id)),
    );
    expect(update.code).toBe("P0001");
    expect(update.message).toContain(
      `issued_certificate_snapshot row ${id} is append-only evidence: UPDATE`,
    );

    const status = await failureOf(() =>
      db
        .update(issuedCertificateSnapshot)
        .set({ status: "VOIDED" })
        .where(eq(issuedCertificateSnapshot.id, id)),
    );
    expect(status.message).toContain("append-only");

    const del = await failureOf(() =>
      db
        .delete(issuedCertificateSnapshot)
        .where(eq(issuedCertificateSnapshot.id, id)),
    );
    expect(del.message).toContain(
      `issued_certificate_snapshot row ${id} is append-only evidence: DELETE`,
    );
  });

  it("REQ-DBIMM-004: the worker's `on conflict (job_id) do nothing` re-drain is not an UPDATE and still works", async () => {
    const fixture = await seedFixture();
    const { jobId } = await seedSnapshot(fixture);

    const again = await db.execute(sql`
      insert into issued_certificate_snapshot
        (organization_id, job_id, pdf_r2_key, pdf_sha256, input_data_snapshot)
      values (${fixture.orgId}, ${jobId}, 'k2', ${"c".repeat(64)}, '{}'::jsonb)
      on conflict (job_id) do nothing
      returning id`);

    expect(Array.from(again)).toHaveLength(0);
  });

  it("REQ-DBIMM-004: deleting the user who issued it nulls issued_by (FK SET NULL) without failing", async () => {
    const fixture = await seedFixture();
    await db
      .insert(user)
      .values({ id: "issuer-1", name: "I", email: "issuer@lab.test" });
    const jobId = await seedJob(fixture, "APPROVED", { jobId: "CAL-ISS" });
    const [row] = await db
      .insert(issuedCertificateSnapshot)
      .values({
        organizationId: fixture.orgId,
        jobId,
        pdfR2Key: "k",
        pdfSha256: "a".repeat(64),
        inputDataSnapshot: {},
        issuedBy: "issuer-1",
      })
      .returning({ id: issuedCertificateSnapshot.id });
    if (!row) throw new Error("insert failed");

    await db.delete(user).where(eq(user.id, "issuer-1"));

    const [after] = await db
      .select({ issuedBy: issuedCertificateSnapshot.issuedBy })
      .from(issuedCertificateSnapshot)
      .where(eq(issuedCertificateSnapshot.id, row.id));
    expect(after?.issuedBy).toBeNull();
  });

  it("REQ-DBIMM-005 [HIGH RISK]: every *_audit_log table and event log carries the append-only trigger", async () => {
    const rows = await db.execute<{ tbl: string; has_trigger: boolean }>(sql`
      select c.relname as tbl,
             exists (
               select 1 from pg_trigger t
                where t.tgrelid = c.oid and not t.tgisinternal
                  and t.tgfoid = 'calibra_append_only'::regproc
             ) as has_trigger
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and (c.relname like '%\_audit\_log'
              or c.relname in ('organization_event_log', 'integration_event_log',
                               'service_order_event_log', 'platform_event_log',
                               'issued_certificate_snapshot'))
       order by 1`);
    const list = Array.from(rows);

    expect(list.filter((row) => row.tbl.endsWith("_audit_log"))).toHaveLength(
      22,
    );
    expect(list).toHaveLength(27);
    expect(list.filter((row) => !row.has_trigger)).toEqual([]);
  });

  it("REQ-DBIMM-005: job_audit_log, organization_event_log and financial_audit_log reject UPDATE and DELETE", async () => {
    const fixture = await seedFixture();
    const jobId = await seedJob(fixture, "REVIEW", { jobId: "CAL-AUD" });
    const [audit] = await db
      .insert(jobAuditLog)
      .values({
        organizationId: organizationOf("calibration_job", jobId),
        jobId,
        action: "create",
        performedBy: fixture.userId,
      })
      .returning({ id: jobAuditLog.id });
    const [event] = await db
      .insert(organizationEventLog)
      .values({
        organizationId: fixture.orgId,
        actorUserId: fixture.userId,
        action: "unit.created",
        entityType: "unit",
      })
      .returning({ id: organizationEventLog.id });
    const [fin] = await db
      .insert(financialAuditLog)
      .values({
        organizationId: fixture.orgId,
        entityType: "agreement",
        entityId: "1",
        action: "create",
        performedBy: fixture.userId,
      })
      .returning({ id: financialAuditLog.id });
    if (!audit || !event || !fin) throw new Error("audit seed failed");

    const attempts = [
      () =>
        db
          .update(jobAuditLog)
          .set({ action: "tampered" })
          .where(eq(jobAuditLog.id, audit.id)),
      () => db.delete(jobAuditLog).where(eq(jobAuditLog.id, audit.id)),
      () =>
        db
          .update(organizationEventLog)
          .set({ action: "tampered" })
          .where(eq(organizationEventLog.id, event.id)),
      () =>
        db
          .delete(organizationEventLog)
          .where(eq(organizationEventLog.id, event.id)),
      () =>
        db
          .update(financialAuditLog)
          .set({ performedBy: fixture.userId, action: "tampered" })
          .where(eq(financialAuditLog.id, fin.id)),
      () =>
        db.delete(financialAuditLog).where(eq(financialAuditLog.id, fin.id)),
    ];
    for (const attempt of attempts) {
      const failure = await failureOf(attempt);
      expect(failure.code).toBe("P0001");
      expect(failure.message).toContain("is append-only evidence");
    }

    const [kept] = await db
      .select({ action: jobAuditLog.action })
      .from(jobAuditLog)
      .where(eq(jobAuditLog.id, audit.id));
    expect(kept?.action).toBe("create");
  });

  it("REQ-DBIMM-005: TRUNCATE (the integration harness's reset) is not blocked by the row triggers", async () => {
    const fixture = await seedFixture();
    await db.insert(organizationEventLog).values({
      organizationId: fixture.orgId,
      action: "x",
      entityType: "y",
    });

    await truncateAll();

    const rows = await db.select().from(organizationEventLog);
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("seed escape hatch calibra.allow_audit_rewrite (migration 0115)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-DBIMM-006: set_config(..., true) lifts every trigger for ONE transaction and no further", async () => {
    const fixture = await seedFixture();
    const jobId = await seedJob(fixture, "APPROVED", { jobId: "CAL-SEED" });
    const [audit] = await db
      .insert(jobAuditLog)
      .values({
        organizationId: organizationOf("calibration_job", jobId),
        jobId,
        action: "approve",
        performedBy: fixture.userId,
      })
      .returning({ id: jobAuditLog.id });
    if (!audit) throw new Error("audit insert failed");

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('calibra.allow_audit_rewrite', 'on', true)`,
      );
      await tx
        .update(jobAuditLog)
        .set({ performedAt: new Date("2025-01-01T00:00:00.000Z") })
        .where(eq(jobAuditLog.id, audit.id));
      await tx
        .update(calibrationJob)
        .set({ approvedAt: new Date("2025-01-02T00:00:00.000Z") })
        .where(eq(calibrationJob.id, jobId));
    });

    const [rewritten] = await db
      .select({ performedAt: jobAuditLog.performedAt })
      .from(jobAuditLog)
      .where(eq(jobAuditLog.id, audit.id));
    expect(rewritten?.performedAt?.toISOString()).toBe(
      "2025-01-01T00:00:00.000Z",
    );

    // Transaction-local: the very next statement on the pool is guarded again.
    const after = await failureOf(() =>
      db
        .update(jobAuditLog)
        .set({ performedAt: new Date("2025-06-01T00:00:00.000Z") })
        .where(eq(jobAuditLog.id, audit.id)),
    );
    expect(after.message).toContain("append-only");
    const jobAfter = await failureOf(() =>
      db
        .update(calibrationJob)
        .set({ approvedAt: new Date("2025-06-01T00:00:00.000Z") })
        .where(eq(calibrationJob.id, jobId)),
    );
    expect(jobAfter.message).toContain("column approved_at is frozen");

    const setting = await db.execute<{ value: string | null }>(
      sql`select current_setting('calibra.allow_audit_rewrite', true) as value`,
    );
    expect(Array.from(setting)[0]?.value ?? "").not.toBe("on");
  });

  it("REQ-DBIMM-006: the demo seed's applyJobTimeline back-dates an APPROVED job, its snapshot and its audit rows", async () => {
    const fixture = await seedFixture();
    const jobId = await seedJob(fixture, "APPROVED", { jobId: "CAL-TIMELINE" });
    await db.insert(jobAuditLog).values({
      organizationId: organizationOf("calibration_job", jobId),
      jobId,
      action: "approve",
      performedBy: fixture.userId,
    });
    await db.insert(issuedCertificateSnapshot).values({
      organizationId: fixture.orgId,
      jobId,
      pdfR2Key: "k",
      pdfSha256: "a".repeat(64),
      inputDataSnapshot: {},
    });
    const decidedAt = new Date("2026-03-10T12:00:00.000Z");

    await applyJobTimeline(
      jobId,
      fixture.assetId,
      {
        createdAt: new Date("2026-03-01T09:00:00.000Z"),
        dueDate: new Date("2026-04-01T09:00:00.000Z"),
        performedAt: new Date("2026-03-05T09:00:00.000Z"),
        submittedAt: new Date("2026-03-06T09:00:00.000Z"),
        decidedAt,
        final: "APPROVED",
      },
      new Date("2026-03-01T00:00:00.000Z"),
    );

    const [job] = await db
      .select({ approvedAt: calibrationJob.approvedAt })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, jobId));
    const [audit] = await db
      .select({ performedAt: jobAuditLog.performedAt })
      .from(jobAuditLog)
      .where(eq(jobAuditLog.jobId, jobId));
    const [snapshot] = await db
      .select({ issuedAt: issuedCertificateSnapshot.issuedAt })
      .from(issuedCertificateSnapshot)
      .where(eq(issuedCertificateSnapshot.jobId, jobId));
    expect(job?.approvedAt?.toISOString()).toBe(decidedAt.toISOString());
    expect(audit?.performedAt.toISOString()).toBe(decidedAt.toISOString());
    expect(snapshot?.issuedAt.toISOString()).toBe("2026-03-10T12:01:00.000Z");
  });

  it("REQ-DBIMM-006: a rolled-back transaction does not leak the setting", async () => {
    const fixture = await seedFixture();
    const jobId = await seedJob(fixture, "REVIEW", { jobId: "CAL-RB" });
    const [audit] = await db
      .insert(jobAuditLog)
      .values({
        organizationId: organizationOf("calibration_job", jobId),
        jobId,
        action: "create",
        performedBy: fixture.userId,
      })
      .returning({ id: jobAuditLog.id });
    if (!audit) throw new Error("audit insert failed");

    await expect(
      db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('calibra.allow_audit_rewrite', 'on', true)`,
        );
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const failure = await failureOf(() =>
      db.delete(jobAuditLog).where(eq(jobAuditLog.id, audit.id)),
    );
    expect(failure.message).toContain("append-only");
  });
});

// ---------------------------------------------------------------------------

describe("platform_event_log signup reservation (migration 0115)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-DBIMM-007: the RESERVED signup row can be completed, but is append-only afterwards", async () => {
    const [reserved] = await db
      .insert(platformEventLog)
      .values({
        action: "public.signup.provisioned",
        entityType: "organization",
        details: { emailDomain: "lab.test", status: "RESERVED" },
      })
      .returning({ id: platformEventLog.id });
    if (!reserved) throw new Error("insert failed");

    // public-signup.ts completeSignupReservation
    await db
      .update(platformEventLog)
      .set({ entityId: "org-1", details: { emailDomain: "lab.test" } })
      .where(eq(platformEventLog.id, reserved.id));

    const after = await failureOf(() =>
      db
        .update(platformEventLog)
        .set({ details: { tampered: true } })
        .where(eq(platformEventLog.id, reserved.id)),
    );
    expect(after.message).toContain("append-only");
    const del = await failureOf(() =>
      db.delete(platformEventLog).where(eq(platformEventLog.id, reserved.id)),
    );
    expect(del.message).toContain("append-only");
  });

  it("REQ-DBIMM-007: a failed signup can still release its RESERVED row; other platform events cannot be deleted", async () => {
    const [reserved] = await db
      .insert(platformEventLog)
      .values({
        action: "public.signup.provisioned",
        entityType: "organization",
        details: { status: "RESERVED" },
      })
      .returning({ id: platformEventLog.id });
    const [other] = await db
      .insert(platformEventLog)
      .values({ action: "user.banned", entityType: "user" })
      .returning({ id: platformEventLog.id });
    if (!reserved || !other) throw new Error("insert failed");

    await db
      .delete(platformEventLog)
      .where(eq(platformEventLog.id, reserved.id));
    expect(await db.select().from(platformEventLog)).toHaveLength(1);

    const failure = await failureOf(() =>
      db.delete(platformEventLog).where(eq(platformEventLog.id, other.id)),
    );
    expect(failure.message).toContain("append-only");
  });
});

// ---------------------------------------------------------------------------

describe("evidence outlives its parent (migration 0115)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-DBIMM-008 [HIGH RISK]: deleting the organization keeps the rows of the seven formerly cascading evidence tables", async () => {
    const fixture = await seedOrg({ orgId: "org-gone", userId: "user-gone" });
    const orgId = fixture.orgId;

    const [numbering] = await db
      .insert(certificateNumberingAuditLog)
      .values({ organizationId: orgId, action: "create" })
      .returning({ id: certificateNumberingAuditLog.id });
    const [financial] = await db
      .insert(financialAuditLog)
      .values({
        organizationId: orgId,
        entityType: "agreement",
        entityId: "1",
        action: "create",
        performedBy: fixture.userId,
      })
      .returning({ id: financialAuditLog.id });
    const [scope] = await db
      .insert(accreditedScopeLineAuditLog)
      .values({
        organizationId: orgId,
        action: "create",
        performedBy: fixture.userId,
      })
      .returning({ id: accreditedScopeLineAuditLog.id });
    const [send] = await db
      .insert(automaticSendAuditLog)
      .values({
        organizationId: orgId,
        milestone: "certificate_approved",
        outcome: "sent",
      })
      .returning({ id: automaticSendAuditLog.id });
    const [orgEvent] = await db
      .insert(organizationEventLog)
      .values({
        organizationId: orgId,
        unitId: fixture.unitId,
        actorUserId: fixture.userId,
        actorMemberId: fixture.memberId,
        action: "unit.created",
        entityType: "unit",
      })
      .returning({ id: organizationEventLog.id });
    const [integration] = await db
      .insert(integrationEventLog)
      .values({
        integrationId: "integration-gone",
        organizationId: orgId,
        runId: "run-gone",
        event: "sync.started",
        message: "started",
      })
      .returning({ id: integrationEventLog.id });
    const [orderEvent] = await db
      .insert(serviceOrderEventLog)
      .values({
        organizationId: orgId,
        unitId: fixture.unitId,
        serviceOrderId: 4242,
        actorType: "system",
        eventType: "service_order.created",
      })
      .returning({ id: serviceOrderEventLog.id });
    if (
      !numbering ||
      !financial ||
      !scope ||
      !send ||
      !orgEvent ||
      !integration ||
      !orderEvent
    ) {
      throw new Error("evidence seed failed");
    }

    // Retention (migration 0117): a LAB organization is only deleted by the purge.
    await hardDeleteOrganizationAsPurge(orgId);

    expect(
      await db.select().from(organization).where(eq(organization.id, orgId)),
    ).toHaveLength(0);
    const survivors = await Promise.all([
      db.select().from(certificateNumberingAuditLog),
      db.select().from(financialAuditLog),
      db.select().from(accreditedScopeLineAuditLog),
      db.select().from(automaticSendAuditLog),
      db.select().from(organizationEventLog),
      db.select().from(integrationEventLog),
      db.select().from(serviceOrderEventLog),
    ]);
    expect(survivors.map((rows) => rows.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    // The unit went with the organization (FK SET NULL on the event log): that
    // is a referential null-out, not a rewrite, so it must not be refused.
    expect(survivors[4]?.[0]?.organizationId).toBe(orgId);
  });

  // issued_certificate_snapshot keeps its organization FK: the cascade it carries
  // is refused by the append-only trigger (and by the RESTRICT FKs of the job it
  // certifies), so an organization that issued certificates cannot be deleted.
  it("REQ-DBIMM-008: no audit or event table keeps an ON DELETE CASCADE foreign key", async () => {
    const rows = await db.execute<{ tbl: string; conname: string }>(sql`
      select conrelid::regclass::text as tbl, conname
        from pg_constraint
       where contype = 'f' and confdeltype = 'c'
         and (conrelid::regclass::text like '%\_audit\_log'
              or conrelid::regclass::text in ('organization_event_log',
                'integration_event_log', 'service_order_event_log',
                'platform_event_log'))`);

    expect(Array.from(rows)).toEqual([]);
  });

  it("REQ-DBIMM-008: deleting a user nulls organization_event_log.actor_user_id instead of failing or erasing the row", async () => {
    const fixture = await seedOrg({ orgId: "org-evt", userId: "user-evt" });
    await db
      .insert(user)
      .values({ id: "actor-2", name: "A", email: "a2@lab.test" });
    const [event] = await db
      .insert(organizationEventLog)
      .values({
        organizationId: fixture.orgId,
        actorUserId: "actor-2",
        action: "unit.created",
        entityType: "unit",
      })
      .returning({ id: organizationEventLog.id });
    if (!event) throw new Error("insert failed");

    await db.delete(user).where(eq(user.id, "actor-2"));

    const [row] = await db
      .select({
        actorUserId: organizationEventLog.actorUserId,
        action: organizationEventLog.action,
      })
      .from(organizationEventLog)
      .where(eq(organizationEventLog.id, event.id));
    expect(row).toEqual({ actorUserId: null, action: "unit.created" });

    // A direct UPDATE that nulls the same column is still a rewrite.
    const direct = await failureOf(() =>
      db
        .update(organizationEventLog)
        .set({ actorUserId: null })
        .where(eq(organizationEventLog.id, event.id)),
    );
    expect(direct.message).toContain("append-only");
  });
});

// ---------------------------------------------------------------------------

describe("routes refuse writes to an issued certificate (migration 0115)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function seedIssuedJob(status: "APPROVED" | "SUPERSEDED") {
    const fixture = await seedFixture();
    loginAs({ userId: fixture.userId, organizationId: fixture.orgId });
    const tech = await seedExtraMember({
      orgId: fixture.orgId,
      userId: "tech-route",
      role: "technician",
      unitId: fixture.unitId,
      unitRole: "technician",
    });
    const id = await seedJob(fixture, status, {
      jobId: `CAL-ROUTE-${status}`,
      ...(status === "SUPERSEDED"
        ? { supersededById: 999, supersededAt: new Date() }
        : {}),
    });
    return { fixture, tech, id };
  }

  async function technicianOf(id: number) {
    const [row] = await db
      .select({ technicianId: calibrationJob.technicianId })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, id));
    return row?.technicianId ?? null;
  }

  it.each(["APPROVED", "SUPERSEDED"] as const)(
    "REQ-DBIMM-009 [HIGH RISK]: POST /:id/assign on a %s job → 400 and the technician is unchanged",
    async (status) => {
      const { tech, id } = await seedIssuedJob(status);

      const res = await jobsRouter.request(`/${id}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ technicianId: tech.userId }),
      });

      expect(res.status).toBe(400);
      expect(await technicianOf(id)).toBeNull();
    },
  );

  it("REQ-DBIMM-009: PUT /:id on a SUPERSEDED job → 400 and the technician is unchanged", async () => {
    const { tech, id } = await seedIssuedJob("SUPERSEDED");

    const res = await jobsRouter.request(`/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ technicianId: tech.userId }),
    });

    expect(res.status).toBe(400);
    expect(await technicianOf(id)).toBeNull();
  });

  it("REQ-DBIMM-009: public API PATCH /jobs/:id on a SUPERSEDED job → 409 and the technician is unchanged", async () => {
    const { fixture, tech, id } = await seedIssuedJob("SUPERSEDED");
    const { key, keyPrefix, keyHash } = createApiKeySecret();
    await db.insert(organizationApiKey).values({
      id: "key-frozen",
      organizationId: fixture.orgId,
      name: "Frozen",
      keyPrefix,
      keyHash,
      scopes: ["jobs:write"],
      createdBy: fixture.userId,
    });

    const res = await publicApiV2Router.request(`/jobs/${id}`, {
      method: "PATCH",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ technicianId: tech.userId }),
    });

    expect(res.status).toBe(409);
    expect(await technicianOf(id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The application role (calibra_app) against the evidence tables, migration 0130.
// The specs above run as the table owner (the harness); these run a session as
// calibra_app, the way the API, the worker and the CLI connect.

const ALL_HATCHES = [
  "calibra.allow_audit_rewrite",
  "calibra.allow_status_repair",
  "calibra.allow_org_purge",
] as const;

type AppDb = ReturnType<typeof openAppRoleDb>["db"];
type AppTx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

/** An org-bound transaction of calibra_app with every escape-hatch GUC set. */
async function asAppWithHatches<T>(
  app: AppDb,
  orgId: string,
  run: (tx: AppTx) => Promise<T>,
): Promise<T> {
  return app.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('calibra.organization_id', ${orgId}, true)`,
    );
    for (const setting of ALL_HATCHES) {
      await tx.execute(sql`select set_config(${setting}, 'on', true)`);
    }
    return run(tx);
  });
}

function textArray(values: readonly string[]) {
  return sql.raw(
    `ARRAY[${values.map((value) => `'${value}'`).join(",")}]::text[]`,
  );
}

describe("calibra_app cannot rewrite or delete evidence (migration 0130)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-EVID-4 [HIGH RISK]: UPDATE, DELETE and TRUNCATE on every append-only table fail with permission denied, even with every hatch GUC set", async () => {
    const fixture = await seedFixture();
    const app = openAppRoleDb().db;
    const outcomes: string[] = [];
    for (const table of APPEND_ONLY_EVIDENCE_TABLES) {
      for (const statement of [
        `UPDATE public."${table}" SET id = id WHERE false`,
        `DELETE FROM public."${table}" WHERE false`,
        `TRUNCATE public."${table}"`,
      ]) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- sequential on purpose: one connection
        const state = await sqlStateOf(
          asAppWithHatches(app, fixture.orgId, (tx) =>
            tx.execute(sql.raw(statement)),
          ),
        );
        outcomes.push(`${state} ${statement}`);
      }
    }
    expect(outcomes.filter((line) => !line.startsWith("42501 "))).toEqual([]);
    expect(outcomes).toHaveLength(APPEND_ONLY_EVIDENCE_TABLES.length * 3);
  });

  it("REQ-EVID-4: an audit row of the application's own organization cannot be edited or deleted, and is unchanged afterwards", async () => {
    const fixture = await seedFixture();
    const jobId = await seedJob(fixture, "REVIEW", { jobId: "CAL-APP-1" });
    const [audit] = await db
      .insert(jobAuditLog)
      .values({
        organizationId: fixture.orgId,
        jobId,
        action: "create",
        performedBy: fixture.userId,
        reason: "original",
      })
      .returning({ id: jobAuditLog.id });
    if (!audit) throw new Error("audit insert failed");
    const app = openAppRoleDb().db;

    expect(
      await sqlStateOf(
        asAppWithHatches(app, fixture.orgId, (tx) =>
          tx
            .update(jobAuditLog)
            .set({ reason: "rewritten" })
            .where(eq(jobAuditLog.id, audit.id)),
        ),
      ),
    ).toBe("42501");
    expect(
      await sqlStateOf(
        asAppWithHatches(app, fixture.orgId, (tx) =>
          tx.delete(jobAuditLog).where(eq(jobAuditLog.id, audit.id)),
        ),
      ),
    ).toBe("42501");

    const [after] = await db
      .select({ reason: jobAuditLog.reason })
      .from(jobAuditLog)
      .where(eq(jobAuditLog.id, audit.id));
    expect(after?.reason).toBe("original");
  });

  it("REQ-EVID-4: the application keeps INSERT and SELECT on the evidence tables, and certificate_input keeps DELETE (the revert of an approval) but not UPDATE", async () => {
    const tables = [
      ...APPEND_ONLY_EVIDENCE_TABLES,
      ...NO_UPDATE_EVIDENCE_TABLES,
    ];
    const rows = await db.execute<{
      table_name: string;
      priv: string;
      granted: boolean;
    }>(sql`
      select t.table_name, p.priv,
             has_table_privilege('calibra_app', format('public.%I', t.table_name), p.priv) as granted
        from unnest(${textArray(tables)}) as t(table_name)
       cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)`);
    const granted = new Set(
      Array.from(rows)
        .filter((row) => row.granted)
        .map((row) => `${row.table_name}:${row.priv}`),
    );
    for (const table of tables) {
      expect(granted.has(`${table}:SELECT`), `${table} SELECT`).toBe(true);
      expect(granted.has(`${table}:INSERT`), `${table} INSERT`).toBe(true);
      expect(granted.has(`${table}:UPDATE`), `${table} UPDATE`).toBe(false);
      expect(granted.has(`${table}:TRUNCATE`), `${table} TRUNCATE`).toBe(false);
    }
    for (const table of APPEND_ONLY_EVIDENCE_TABLES) {
      expect(granted.has(`${table}:DELETE`), `${table} DELETE`).toBe(false);
    }
    expect(granted.has("certificate_input:DELETE")).toBe(true);
  });

  it("REQ-EVID-5 [HIGH RISK]: setting every hatch GUC as calibra_app lifts none of the trigger guards", async () => {
    const fixture = await seedFixture();
    const approved = await seedJob(fixture, "APPROVED", { jobId: "CAL-APP-2" });
    const draft = await seedJob(fixture, "DRAFT", { jobId: "CAL-APP-3" });
    const app = openAppRoleDb().db;

    // The hatch functions answer no for the application, GUC set or not.
    const hatch = await asAppWithHatches(app, fixture.orgId, (tx) =>
      tx.execute<{ open: boolean; owner: boolean; purge: boolean }>(sql`
        select calibra_history_rewrite_allowed() as open,
               calibra_session_is_owner() as owner,
               calibra_org_purge_allowed() as purge`),
    );
    expect(Array.from(hatch)[0]).toEqual({
      open: false,
      owner: false,
      purge: false,
    });

    // 0115: a frozen job stays frozen (the application UPDATEs calibration_job, so the trigger answers).
    const frozen = await failureOf(() =>
      asAppWithHatches(app, fixture.orgId, (tx) =>
        tx
          .update(calibrationJob)
          .set({ results: { value: 99 } })
          .where(eq(calibrationJob.id, approved)),
      ),
    );
    expect(frozen.code).toBe("P0001");
    expect(frozen.message).toContain("column results is frozen");

    // 0119: the status machine still refuses DRAFT -> APPROVED.
    const illegal = await failureOf(() =>
      asAppWithHatches(app, fixture.orgId, (tx) =>
        tx
          .update(calibrationJob)
          .set({ status: "APPROVED" })
          .where(eq(calibrationJob.id, draft)),
      ),
    );
    expect(illegal.code).toBe("CF001");
    expect(await statusOf(draft)).toBe("DRAFT");

    // 0117: a LAB organization cannot be hard-deleted by the application.
    const purge = await failureOf(() =>
      asAppWithHatches(app, fixture.orgId, (tx) =>
        tx.delete(organization).where(eq(organization.id, fixture.orgId)),
      ),
    );
    expect(purge.code).toBe("P0001");
    expect(purge.message).toContain("cannot be hard-deleted");

    // 0115: an approved job cannot be deleted.
    const deleteApproved = await failureOf(() =>
      asAppWithHatches(app, fixture.orgId, (tx) =>
        tx.delete(calibrationJob).where(eq(calibrationJob.id, approved)),
      ),
    );
    expect(deleteApproved.code).toBe("P0001");
  });

  it("REQ-EVID-5: the same statements succeed on the owner path: the hatch is the owner's", async () => {
    const fixture = await seedFixture();
    const approved = await seedJob(fixture, "APPROVED", { jobId: "CAL-OWN-1" });
    const [audit] = await db
      .insert(jobAuditLog)
      .values({
        organizationId: fixture.orgId,
        jobId: approved,
        action: "approve",
        performedBy: fixture.userId,
      })
      .returning({ id: jobAuditLog.id });
    if (!audit) throw new Error("audit insert failed");

    await db.transaction(async (tx) => {
      for (const setting of ALL_HATCHES) {
        await tx.execute(sql`select set_config(${setting}, 'on', true)`);
      }
      const hatch = await tx.execute<{ open: boolean; owner: boolean }>(
        sql`select calibra_history_rewrite_allowed() as open, calibra_session_is_owner() as owner`,
      );
      expect(Array.from(hatch)[0]).toEqual({ open: true, owner: true });
      await tx
        .update(calibrationJob)
        .set({ results: { value: 7 } })
        .where(eq(calibrationJob.id, approved));
      await tx.delete(jobAuditLog).where(eq(jobAuditLog.id, audit.id));
    });
    const rows = await db
      .select({ id: jobAuditLog.id })
      .from(jobAuditLog)
      .where(eq(jobAuditLog.id, audit.id));
    expect(rows).toHaveLength(0);
  });

  it("REQ-EVID-6: a non-superuser LOGIN member of calibra_app (the production shape) is not the owner, and a foreign-key action inside its session does not open the hatch", async () => {
    const fixture = await seedFixture();
    const login = `b1_app_login_${process.pid}`;
    const password = "b1-test-password";
    await db.execute(
      sql.raw(
        `CREATE ROLE "${login}" LOGIN PASSWORD '${password}' IN ROLE calibra_app`,
      ),
    );
    const url = new URL(process.env.DATABASE_URL ?? "");
    url.username = login;
    url.password = password;
    const app = createRoleDatabase(url.toString(), { role: null, max: 1 });
    try {
      const result = await asAppWithHatches(app.db, fixture.orgId, (tx) =>
        tx.execute<{ who: string; owner: boolean; open: boolean }>(sql`
          select session_user::text as who,
                 calibra_session_is_owner() as owner,
                 calibra_history_rewrite_allowed() as open`),
      );
      expect(Array.from(result)[0]).toEqual({
        who: login,
        owner: false,
        open: false,
      });
      // Refused at the privilege layer like the SET ROLE session.
      expect(
        await sqlStateOf(
          app.db.transaction((tx) =>
            tx.execute(sql`delete from public.job_audit_log where false`),
          ),
        ),
      ).toBe("42501");

      // Postgres runs a foreign-key action as the table owner: with the GUC set
      // by this session it must not open the hatch, yet a SET NULL keeps working.
      await db
        .insert(user)
        .values({ id: "gone-user", name: "Gone", email: "gone@lab.test" });
      const [event] = await db
        .insert(organizationEventLog)
        .values({
          organizationId: fixture.orgId,
          actorUserId: "gone-user",
          action: "test.event",
          entityType: "test",
        })
        .returning({ id: organizationEventLog.id });
      if (!event) throw new Error("event insert failed");
      await asAppWithHatches(app.db, fixture.orgId, (tx) =>
        tx.delete(user).where(eq(user.id, "gone-user")),
      );
      const [kept] = await db
        .select({ actor: organizationEventLog.actorUserId })
        .from(organizationEventLog)
        .where(eq(organizationEventLog.id, event.id));
      expect(kept).toEqual({ actor: null });
    } finally {
      await app.close();
      await db.execute(sql.raw(`DROP ROLE IF EXISTS "${login}"`));
    }
  });

  it("REQ-EVID-7: ON DELETE SET NULL keeps working for the application role: deleting a user an audit row names nulls the reference and keeps the row", async () => {
    const fixture = await seedFixture();
    await db
      .insert(user)
      .values({ id: "gone-user-2", name: "Gone", email: "gone2@lab.test" });
    const [event] = await db
      .insert(organizationEventLog)
      .values({
        organizationId: fixture.orgId,
        actorUserId: "gone-user-2",
        action: "test.event",
        entityType: "test",
      })
      .returning({ id: organizationEventLog.id });
    if (!event) throw new Error("event insert failed");

    await openAppRoleDb().db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('calibra.organization_id', ${fixture.orgId}, true)`,
      );
      await tx.delete(user).where(eq(user.id, "gone-user-2"));
    });
    const [kept] = await db
      .select({ actor: organizationEventLog.actorUserId })
      .from(organizationEventLog)
      .where(eq(organizationEventLog.id, event.id));
    expect(kept).toEqual({ actor: null });
  });

  it("REQ-EVID-8: no evidence table is the child of an ON DELETE CASCADE foreign key (a cascade runs as the owner and would skip the privileges)", async () => {
    const rows = await db.execute<{ child: string; parent: string }>(sql`
      select conrelid::regclass::text as child, confrelid::regclass::text as parent
        from pg_constraint
       where contype = 'f' and confdeltype = 'c'
         and conrelid::regclass::text = any(${textArray(APPEND_ONLY_EVIDENCE_TABLES)})`);
    expect(Array.from(rows)).toEqual([]);
  });
});
