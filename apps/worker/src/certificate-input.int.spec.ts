import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { and, eq, sql } from "drizzle-orm";
import {
  canonicalJson,
  certificateInputSha256,
  isCertificateInput,
} from "@calibra-facil/certificate-data";
import {
  freezeCertificateInput,
  prefetchCertificateImages,
} from "@calibra-facil/db/certificate-input";
import { appendJobEvent } from "@calibra-facil/db/job-events";
import {
  calibrationJob,
  certificateInput,
  customer,
  memberVisualSignature,
  member,
  organization,
  serviceOrderCertificateLink,
  user,
} from "@calibra-facil/db/schema";
import {
  buildOrganizationLogoUrl,
  organizationLogoKey,
} from "@calibra-facil/shared/storage-keys";
import type { Env } from "@calibra-facil/jobs-core";
import { createHash } from "node:crypto";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { seedOrg } from "../test/integration/seed";
import { setJobStatus } from "../test/integration/job-fixtures";
import { seedIssuableJob } from "../test/integration/seed-certificate";
import { seedServiceOrder } from "../test/integration/seed-service-order";
import { buildCertificateLayoutData } from "@calibra-facil/jobs-core/certificate/layout-data";
import { fetchCertificateJobData } from "@calibra-facil/jobs-core/certificate/fetch-job-data";

/**
 * Real-DB integration tier for the frozen certificate input (ISO/IEC 17025
 * §7.8: the report reflects the approved record).
 *
 *   REQ-CIN-1  parity: the frozen document is exactly what the legacy live
 *              assembly produces on a seeded job (same render input)
 *   REQ-CIN-2  the worker renders from the frozen input and never reads the
 *              lab, signatory, customer or asset again; a job without one
 *              keeps rendering through the legacy live path, flagged as such
 *   REQ-CIN-4  re-rendering the same frozen input gives byte-identical render
 *              data, and the hash of what the template was handed is recorded
 *
 * Stubbed: the network (Gotenberg) and the image storage; the DB, the status
 * transitions and the write-once snapshot are real.
 */

vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => undefined),
  notifyAuditPackReady: vi.fn(async () => undefined),
}));

import { processBackgroundJob } from "@calibra-facil/jobs-core";

const GOTENBERG_URL = "http://gotenberg.test";
const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const USER_ID = "user-org-1";
const LOGO_KEY = organizationLogoKey({
  org: { id: "org-1", slug: "org-1" },
  timestamp: 1_760_000_000_000,
  uniqueId: "logo-1",
}).key;
const LOGO_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const SIGNATURE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);
const SIGNATURE_KEY = "signatures/org-1/approver.png";

function dataUrl(bytes: Uint8Array) {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

async function readTestImage(key: string): Promise<Uint8Array | null> {
  if (key === LOGO_KEY) return LOGO_BYTES;
  if (key === SIGNATURE_KEY) return SIGNATURE_BYTES;
  return null;
}

/** The HTML handed to Gotenberg, one entry per render. */
function stubGotenberg(rendered: string[]) {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    if (!url.startsWith(GOTENBERG_URL)) return realFetch(input, init);
    const body = init?.body;
    if (body instanceof FormData) {
      for (const entry of body.getAll("files")) {
        if (entry instanceof File && entry.name === "index.html") {
          rendered.push(await entry.text());
        }
      }
    }
    return new Response(FAKE_PDF_BYTES, { status: 200 });
  });
}

function makeEnv(): Env {
  return { ...makeTestEnv(), GOTENBERG_URL };
}

// ---- row readers (no `as`) ----
function toRows(result: unknown): unknown[] {
  if (result && typeof result === "object" && "rows" in result) {
    const inner = Reflect.get(result, "rows");
    return Array.isArray(inner) ? inner : [];
  }
  return Array.isArray(result) ? result : [];
}

function field(row: unknown, key: string): unknown {
  return row && typeof row === "object" && key in row
    ? Reflect.get(row, key)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jobStatus(jobId: number) {
  const result = await db.execute(
    sql`SELECT status FROM calibration_job WHERE id = ${jobId}`,
  );
  return String(field(toRows(result)[0], "status"));
}

async function snapshots(jobId: number) {
  const result = await db.execute(
    sql`SELECT id, render_metadata, input_data_snapshot
        FROM issued_certificate_snapshot WHERE job_id = ${jobId} ORDER BY id`,
  );
  return toRows(result).map((row) => ({
    id: Number(field(row, "id")),
    renderMetadata: field(row, "render_metadata"),
    inputDataSnapshot: field(row, "input_data_snapshot"),
  }));
}

/** An approved job whose approval froze its input, with the lab accredited. */
async function seedApprovedJob(
  options: {
    freeze?: boolean;
    status?: Parameters<typeof seedIssuableJob>[0]["status"];
  } = {},
) {
  const freeze = options.freeze ?? true;
  const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
  const job = await seedIssuableJob({
    organizationId: org.orgId,
    unitId: org.unitId,
    userId: org.userId,
    customerName: "Cliente Aprovado SA",
  });
  await db
    .update(organization)
    .set({
      name: "Laboratório Aprovado",
      cnpj: "12345678000199",
      accreditationNumber: "0123",
      accreditationBody: "Cgcre",
      accreditationActive: true,
      accreditationValidFrom: new Date("2025-01-01T00:00:00.000Z"),
      // valid when the job was approved (2026-01-01), long gone at render time
      accreditationValidUntil: new Date("2026-02-01T00:00:00.000Z"),
      city: "Curitiba",
      state: "PR",
      technicalManagerTitle: "Gerente Técnica Original",
    })
    .where(eq(organization.id, org.orgId));
  await db.execute(
    sql`UPDATE calibration_job
        SET method_snapshot = jsonb_set(method_snapshot, '{accreditedScope}', 'true'),
            -- Q42: the seal rests on the scope verdict frozen at approval
            scope_compliance_status = 'PASS',
            scope_compliance_findings = '[]'::jsonb
        WHERE id = ${job.jobId}`,
  );
  await db
    .update(user)
    .set({ name: "Ana Aprovadora" })
    .where(eq(user.id, USER_ID));
  if (freeze) await freezeJob(job.jobId, org.orgId);
  // Released after the fact: a superseded job is frozen content, so it is moved last.
  if (options.status) await setJobStatus(job.jobId, options.status);
  return { org, job };
}

/**
 * What the approval command does for a job: read the images, freeze the input
 * and record its hash on the approve audit event.
 */
async function freezeJob(jobId: number, organizationId: string) {
  const [row] = await db
    .select()
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.id, jobId),
        eq(calibrationJob.organizationId, organizationId),
      ),
    );
  if (!row) throw new Error("job not seeded");
  const images = await prefetchCertificateImages(
    db,
    { organizationId, approverId: USER_ID },
    readTestImage,
  );
  const frozen = await db.transaction((tx) =>
    freezeCertificateInput(tx, row, images),
  );
  await recordApproval(jobId, organizationId, frozen.sha256);
  return frozen;
}

/** The approve audit event: with the frozen input's hash (since 0120), or without. */
async function recordApproval(
  jobId: number,
  organizationId: string,
  certificateInputSha256: string | null,
) {
  await appendJobEvent(db, {
    action: "approve",
    organizationId,
    jobId,
    actor: { kind: "user", userId: USER_ID },
    changes: {
      status: { old: "REVIEW", new: "GENERATING_PDF" },
      ...(certificateInputSha256 ? { certificateInputSha256 } : {}),
    },
    ipAddress: null,
    reason: "Aprovado - Gerando PDF",
  });
}

/** The lab, the signatory, the customer and the asset change after the approval. */
async function changeEverythingAfterApproval(
  organizationId: string,
  customerId: number,
) {
  await db
    .update(organization)
    .set({
      name: "Laboratório Renomeado",
      accreditationActive: false,
      technicalManagerTitle: "Gerente Técnica Nova",
      city: "Florianópolis",
    })
    .where(eq(organization.id, organizationId));
  await db
    .update(user)
    .set({ name: "Bruno Substituto" })
    .where(eq(user.id, USER_ID));
  await db
    .update(customer)
    .set({ name: "Cliente Renomeado Ltda" })
    .where(
      and(
        eq(customer.id, customerId),
        eq(customer.labOrganizationId, organizationId),
      ),
    );
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("REQ-CIN-2: the worker renders from the frozen certificate input", () => {
  it("REQ-CIN-2 [HIGH RISK] renders what was approved even though the lab, signatory and customer changed after the approval", async () => {
    const rendered: string[] = [];
    stubGotenberg(rendered);
    const { org, job } = await seedApprovedJob();
    await changeEverythingAfterApproval(org.orgId, job.customerId);

    await processBackgroundJob(makeEnv(), {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: USER_ID,
    });

    expect(await jobStatus(job.jobId)).toBe("APPROVED");
    expect(rendered).toHaveLength(1);
    const html = rendered[0] ?? "";
    // what was approved...
    expect(html).toContain("Laboratório Aprovado");
    expect(html).toContain("Cliente Aprovado SA");
    expect(html).toContain("Ana Aprovadora");
    expect(html).toContain("Gerente Técnica Original");
    // ...and none of what changed since
    expect(html).not.toContain("Laboratório Renomeado");
    expect(html).not.toContain("Cliente Renomeado Ltda");
    expect(html).not.toContain("Bruno Substituto");
    expect(html).not.toContain("Gerente Técnica Nova");

    const [issued] = await snapshots(job.jobId);
    const data = issued?.inputDataSnapshot;
    expect(field(field(data, "lab"), "name")).toBe("Laboratório Aprovado");
    expect(field(field(data, "customer"), "name")).toBe("Cliente Aprovado SA");
    expect(field(field(data, "signatory"), "name")).toBe("Ana Aprovadora");
    // the seal decision was taken at approval (2026-01-01, inside the
    // vigência), not at render time (after it ended)
    expect(field(data, "accredited")).toBe(true);
  });

  it("REQ-CIN-2 [HIGH RISK] records that the frozen path was used, with the hash of the input", async () => {
    stubGotenberg([]);
    const { job } = await seedApprovedJob();
    const [frozen] = await db
      .select()
      .from(certificateInput)
      .where(eq(certificateInput.jobId, job.jobId));

    await processBackgroundJob(makeEnv(), {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: USER_ID,
    });

    const [issued] = await snapshots(job.jobId);
    const marker = field(issued?.renderMetadata, "certificateInput");
    expect(field(marker, "source")).toBe("frozen");
    expect(field(marker, "sha256")).toBe(frozen?.sha256);
    expect(field(marker, "layoutDataSha256")).toBe(
      createHash("sha256")
        .update(canonicalJson(issued?.inputDataSnapshot))
        .digest("hex"),
    );
  });

  it("REQ-CIN-2 a job approved before the frozen input existed keeps rendering through the live path, labelled legacy", async () => {
    const rendered: string[] = [];
    stubGotenberg(rendered);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { job } = await seedApprovedJob({ freeze: false });

    await processBackgroundJob(makeEnv(), {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: USER_ID,
    });

    expect(await jobStatus(job.jobId)).toBe("APPROVED");
    expect(rendered[0]).toContain("Laboratório Aprovado");
    const [issued] = await snapshots(job.jobId);
    expect(
      field(field(issued?.renderMetadata, "certificateInput"), "source"),
    ).toBe("legacy_live");
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes("LEGACY render")),
    ).toBe(true);
  });

  it("REQ-CIN-2 a legacy job reads the lab live: this is what the frozen input exists to prevent", async () => {
    const rendered: string[] = [];
    stubGotenberg(rendered);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { org, job } = await seedApprovedJob({ freeze: false });
    await changeEverythingAfterApproval(org.orgId, job.customerId);

    await processBackgroundJob(makeEnv(), {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: USER_ID,
    });

    expect(rendered[0]).toContain("Laboratório Renomeado");
    expect(rendered[0]).not.toContain("Laboratório Aprovado");
  });

  it("REQ-CIN-2 [HIGH RISK] a frozen input that no longer matches its hash is refused: nothing is issued from it", async () => {
    stubGotenberg([]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { job } = await seedApprovedJob();
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('calibra.allow_audit_rewrite', 'on', true)`,
      );
      await tx.execute(
        sql`UPDATE certificate_input
            SET input = jsonb_set(input, '{job,lab,name}', '"Adulterado"')
            WHERE job_id = ${job.jobId}`,
      );
    });

    await expect(
      processBackgroundJob(makeEnv(), {
        type: "CERTIFICATE",
        jobId: job.jobId,
        userId: USER_ID,
      }),
    ).rejects.toThrow(/sha256 mismatch/);

    // Nothing was issued from it, and the job is rejected with the reason
    // recorded rather than stranded in GENERATING_PDF.
    expect(await jobStatus(job.jobId)).toBe("REJECTED");
    expect(await snapshots(job.jobId)).toHaveLength(0);
  });
});

describe("REQ-CIN-2: a post-0120 approval is never rendered through the live path", () => {
  it("REQ-CIN-2 [HIGH RISK] an approval that recorded a frozen input whose row is missing fails permanently, with its reason", async () => {
    const rendered: string[] = [];
    stubGotenberg(rendered);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { job } = await seedApprovedJob();
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('calibra.allow_audit_rewrite', 'on', true)`,
      );
      await tx.execute(
        sql`DELETE FROM certificate_input WHERE job_id = ${job.jobId}`,
      );
    });

    await expect(
      processBackgroundJob(makeEnv(), {
        type: "CERTIFICATE",
        jobId: job.jobId,
        userId: USER_ID,
      }),
    ).rejects.toThrow(/certificate_input missing for a post-0120 approval/);

    expect(rendered).toHaveLength(0);
    expect(await jobStatus(job.jobId)).toBe("REJECTED");
    expect(await snapshots(job.jobId)).toHaveLength(0);
  });

  it("REQ-CIN-2 [HIGH RISK] a frozen input replaced by another self-consistent document is refused: its hash is not the one the approval recorded", async () => {
    const rendered: string[] = [];
    stubGotenberg(rendered);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { job } = await seedApprovedJob();
    const [row] = await db
      .select()
      .from(certificateInput)
      .where(eq(certificateInput.jobId, job.jobId));
    const original = row?.input;
    if (!isCertificateInput(original)) throw new Error("no frozen input");
    const replaced = {
      ...original,
      job: {
        ...original.job,
        lab: { ...original.job.lab, name: "Laboratório Substituído" },
      },
    };
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('calibra.allow_audit_rewrite', 'on', true)`,
      );
      await tx
        .update(certificateInput)
        .set({ input: replaced, sha256: certificateInputSha256(replaced) })
        .where(eq(certificateInput.jobId, job.jobId));
    });

    await expect(
      processBackgroundJob(makeEnv(), {
        type: "CERTIFICATE",
        jobId: job.jobId,
        userId: USER_ID,
      }),
    ).rejects.toThrow(/differs from the one the approval recorded/);

    expect(rendered).toHaveLength(0);
    expect(await snapshots(job.jobId)).toHaveLength(0);
  });

  it("REQ-CIN-2 an approval made before 0120 (its audit row records no hash) still renders through the legacy path", async () => {
    const rendered: string[] = [];
    stubGotenberg(rendered);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { org, job } = await seedApprovedJob({ freeze: false });
    await recordApproval(job.jobId, org.orgId, null);

    await processBackgroundJob(makeEnv(), {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: USER_ID,
    });

    expect(await jobStatus(job.jobId)).toBe("APPROVED");
    const [issued] = await snapshots(job.jobId);
    expect(
      field(field(issued?.renderMetadata, "certificateInput"), "source"),
    ).toBe("legacy_live");
  });

  it("REQ-CIN-2 [HIGH RISK] the SUPERSEDED watermark re-render is also rendered from the frozen input, hash checked, whatever changed since", async () => {
    const rendered: string[] = [];
    stubGotenberg(rendered);
    const { org, job } = await seedApprovedJob({ status: "SUPERSEDED" });
    const [frozen] = await db
      .select()
      .from(certificateInput)
      .where(eq(certificateInput.jobId, job.jobId));
    await changeEverythingAfterApproval(org.orgId, job.customerId);

    await processBackgroundJob(makeEnv(), {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: USER_ID,
    });

    // still SUPERSEDED, refreshed (not re-issued)
    expect(await jobStatus(job.jobId)).toBe("SUPERSEDED");
    const actions = (
      toRows(
        await db.execute(
          sql`SELECT action FROM job_audit_log WHERE job_id = ${job.jobId}`,
        ),
      ) ?? []
    ).map((row) => String(field(row, "action")));
    expect(actions).toContain("certificate_watermarked");

    expect(rendered).toHaveLength(1);
    const html = rendered[0] ?? "";
    expect(html).toContain("Laboratório Aprovado");
    expect(html).toContain("Cliente Aprovado SA");
    expect(html).toContain("Ana Aprovadora");
    expect(html).not.toContain("Laboratório Renomeado");
    expect(html).not.toContain("Cliente Renomeado Ltda");
    expect(html).not.toContain("Bruno Substituto");

    const [issued] = await snapshots(job.jobId);
    const marker = field(issued?.renderMetadata, "certificateInput");
    expect(field(marker, "source")).toBe("frozen");
    expect(field(marker, "sha256")).toBe(frozen?.sha256);
  });

  it("REQ-CIN-2 [HIGH RISK] the SUPERSEDED watermark re-render refuses a frozen input that fails its hash check", async () => {
    const rendered: string[] = [];
    stubGotenberg(rendered);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { job } = await seedApprovedJob({ status: "SUPERSEDED" });
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('calibra.allow_audit_rewrite', 'on', true)`,
      );
      await tx.execute(
        sql`UPDATE certificate_input
            SET input = jsonb_set(input, '{job,lab,name}', '"Adulterado"')
            WHERE job_id = ${job.jobId}`,
      );
    });

    await expect(
      processBackgroundJob(makeEnv(), {
        type: "CERTIFICATE",
        jobId: job.jobId,
        userId: USER_ID,
      }),
    ).rejects.toThrow(/sha256 mismatch/);

    expect(rendered).toHaveLength(0);
    expect(await snapshots(job.jobId)).toHaveLength(0);
    expect(await jobStatus(job.jobId)).toBe("SUPERSEDED");
  });
});

describe("REQ-CIN-4: re-rendering the same frozen input is reproducible", () => {
  it("REQ-CIN-4 [HIGH RISK] a re-render after the lab changed hands the template byte-identical data, and the frozen input and its hash are untouched", async () => {
    stubGotenberg([]);
    const { org, job } = await seedApprovedJob();
    const [frozenBefore] = await db
      .select()
      .from(certificateInput)
      .where(eq(certificateInput.jobId, job.jobId));
    const stored = frozenBefore?.input;
    if (!isCertificateInput(stored)) throw new Error("not a certificate input");
    expect(frozenBefore?.sha256).toBe(certificateInputSha256(stored));

    await processBackgroundJob(makeEnv(), {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: USER_ID,
    });
    const [first] = await snapshots(job.jobId);

    // a later re-render (dead-letter recovery, retry): the job is put back in
    // the state the worker acts on, the lab changed, the clock moved on
    await changeEverythingAfterApproval(org.orgId, job.customerId);
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('calibra.allow_audit_rewrite', 'on', true)`,
      );
      await tx.execute(
        sql`DELETE FROM issued_certificate_snapshot WHERE job_id = ${job.jobId}`,
      );
      await tx.execute(
        sql`UPDATE calibration_job SET status = 'GENERATING_PDF', certificate_url = NULL
            WHERE id = ${job.jobId}`,
      );
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-06-01T12:00:00.000Z"));
    await processBackgroundJob(makeEnv(), {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: USER_ID,
    });
    vi.useRealTimers();
    const [second] = await snapshots(job.jobId);

    expect(second?.id).not.toBe(first?.id);
    expect(second?.inputDataSnapshot).toEqual(first?.inputDataSnapshot);
    expect(canonicalJson(second?.inputDataSnapshot)).toBe(
      canonicalJson(first?.inputDataSnapshot),
    );
    expect(
      field(
        field(second?.renderMetadata, "certificateInput"),
        "layoutDataSha256",
      ),
    ).toBe(
      field(
        field(first?.renderMetadata, "certificateInput"),
        "layoutDataSha256",
      ),
    );
    const [frozenAfter] = await db
      .select()
      .from(certificateInput)
      .where(eq(certificateInput.jobId, job.jobId));
    expect(frozenAfter?.sha256).toBe(frozenBefore?.sha256);
    expect(frozenAfter?.input).toEqual(frozenBefore?.input);
  });
});

describe("REQ-CIN-1: parity of the frozen document with the legacy live assembly", () => {
  it("REQ-CIN-1 [HIGH RISK] on a seeded job the legacy live read and the frozen document hand the template identical render data", async () => {
    // a rich graph: logo and signature images, a linked service order, an
    // amendment chain
    const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
    const original = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      jobNumber: "CAL-2026-0001",
      status: "SUPERSEDED",
    });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      jobNumber: "CAL-2026-0002",
    });
    await db
      .update(organization)
      .set({
        name: "Laboratório Aprovado",
        cnpj: "12345678000199",
        accreditationNumber: "0123",
        accreditationBody: "Cgcre",
        accreditationActive: true,
        accreditationValidFrom: new Date("2025-01-01T00:00:00.000Z"),
        accreditationValidUntil: new Date("2099-12-31T00:00:00.000Z"),
        street: "Rua A",
        number: "10",
        neighbourhood: "Centro",
        city: "Curitiba",
        state: "PR",
        cep: "80000-000",
        phone: "4130000000",
        email: "lab@um.test",
        website: "https://lab.um.test",
        technicalManagerName: "Maria Responsável",
        technicalManagerTitle: "Gerente Técnica",
        logo: buildOrganizationLogoUrl(LOGO_KEY, "https://api.example.com"),
      })
      .where(eq(organization.id, org.orgId));
    await db.execute(
      sql`UPDATE calibration_job
          SET method_snapshot = jsonb_set(method_snapshot, '{accreditedScope}', 'true'),
              scope_compliance_status = 'PASS',
              scope_compliance_findings = '[]'::jsonb,
              supersedes_id = ${original.jobId},
              amendment_number = 1,
              amendment_reason = 'erro de digitação',
              method_deviations = 'Desvio documentado',
              environmental_snapshot = ${JSON.stringify({
                temperature: 21.5,
                humidity: 48,
                pressure: 1013,
                recordedAt: "2026-01-01T00:00:00.000Z",
                recordedBy: USER_ID,
                limits: null,
                withinLimits: true,
                outOfLimitsJustification: null,
              })}::jsonb
          WHERE id = ${job.jobId}`,
    );
    await db.insert(memberVisualSignature).values({
      memberId: await ensureMember(org.orgId),
      organizationId: org.orgId,
      r2Key: SIGNATURE_KEY,
      contentType: "image/png",
      width: 10,
      height: 10,
      fileSize: SIGNATURE_BYTES.length,
    });
    const serviceOrderSeed = await seedServiceOrder({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      serviceOrderNumber: "OS-1",
      customerName: "Cliente da OS",
      assetName: "Instrumento da OS",
    });
    await db.insert(serviceOrderCertificateLink).values({
      organizationId: org.orgId,
      serviceOrderId: serviceOrderSeed.serviceOrderId,
      certificateJobId: job.jobId,
      linkedByUserId: USER_ID,
    });

    // legacy: the worker's live read, as it ran before the frozen input
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const legacy = await fetchCertificateJobData(client, job.jobId, {
      resolveLogoDataUrl: async (logo) =>
        logo && logo.includes("/logo/") ? dataUrl(LOGO_BYTES) : logo,
      resolveSignatureDataUrl: async () => dataUrl(SIGNATURE_BYTES),
    }).finally(() => client.end());
    if (!legacy) throw new Error("legacy read found no job");

    // frozen: what the approval writes
    const { input } = await freezeJob(job.jobId, org.orgId);

    // the assembled data is the same, field for field (instants as ISO strings)
    expect(input.job).toEqual(JSON.parse(JSON.stringify(legacy)));
    expect(input.job.serviceOrder?.intakeCondition).toBe("Riscos na carcaça");
    expect(input.job.originalJobId).toBe("CAL-2026-0001");
    expect(input.job.lab.logo).toBe(dataUrl(LOGO_BYTES));
    expect(input.job.approverSignatureUrl).toBe(dataUrl(SIGNATURE_BYTES));

    // ...and so is what the template is handed
    const fromLegacy = buildCertificateLayoutData(legacy, {
      qrCodeDataUrl: null,
    });
    const fromFrozen = buildCertificateLayoutData(input.job, {
      qrCodeDataUrl: null,
      accredited: input.seal.accredited,
      verificationUrl: input.verificationUrl,
    });
    expect(fromLegacy.ok).toBe(true);
    expect(fromFrozen).toEqual(fromLegacy);
    expect(canonicalJson(fromFrozen.ok ? fromFrozen.data : null)).toBe(
      canonicalJson(fromLegacy.ok ? fromLegacy.data : null),
    );
    expect(fromFrozen.ok && fromFrozen.data.accredited).toBe(true);
    expect(isRecord(input.job.lab)).toBe(true);
  });
});

async function ensureMember(organizationId: string): Promise<string> {
  const memberId = `member-${organizationId}-${USER_ID}`;
  await db.insert(member).values({
    id: memberId,
    organizationId,
    userId: USER_ID,
    role: "admin",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  return memberId;
}
