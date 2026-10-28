import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { calibrationJob } from "@calibra-facil/db/schema";
import type { Env } from "@calibra-facil/jobs-core";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { insertJobs } from "../test/integration/job-fixtures";
import { seedOrg } from "../test/integration/seed";
import { seedIssuableJob } from "../test/integration/seed-certificate";

/**
 * Real-DB integration tier for the certificate lifecycle written by the worker
 * (roadmap 2 B3; ISO/IEC 17025 §7.8.8 amendments): the issuance writes the
 * certificate's ISSUED event, and the issuance of an AMENDMENT is what supersedes
 * its original, atomically, in the same transaction.
 *
 *   REQ-B3-W1  an issuance appends the ISSUED event with the snapshot
 *   REQ-B3-W2  issuing the replacement supersedes the original in the same
 *              transaction: status, link, audit row and SUPERSEDED event
 *   REQ-B3-W3  a failed render leaves the original APPROVED and unchanged
 *   REQ-B3-W4  an original that cannot be superseded fails the whole issuance:
 *              the replacement is not issued and nothing is half written
 *   REQ-B3-W5  an original withdrawn in the meantime stays WITHDRAWN
 *   REQ-B3-W6  an original an earlier release already superseded at creation
 *              time is completed with its event, not re-superseded
 *   REQ-B3-W7  the customer is told about the amendment after the issuance, once
 *
 * Stubbed: Gotenberg (the HTML-to-PDF hop only), R2 (in memory), signing (no
 * master key) and the notification senders. The DB is real.
 */

vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => undefined),
  notifyCertificateAmended: vi.fn(async () => undefined),
  notifyAuditPackReady: vi.fn(async () => undefined),
}));

import {
  notifyCertificateAmended,
  notifyCertificateReady,
} from "@calibra-facil/notifications";
import { processBackgroundJob } from "@calibra-facil/jobs-core";

const GOTENBERG_URL = "http://gotenberg.test";
const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
const USER_ID = "user-org-1";
const AMENDMENT_REASON = "Erro de digitacao na incerteza";

function stubGotenberg(options: { fail?: boolean } = {}) {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    if (!url.startsWith(GOTENBERG_URL)) return realFetch(input, init);
    if (options.fail) return new Response("boom", { status: 500 });
    return new Response(FAKE_PDF_BYTES, { status: 200 });
  });
}

function makeEnv(): Env {
  return { ...makeTestEnv(), GOTENBERG_URL };
}

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

async function jobState(jobId: number) {
  const row = toRows(
    await db.execute(
      sql`SELECT status, superseded_by_id, superseded_at, amendment_reason
          FROM calibration_job WHERE id = ${jobId}`,
    ),
  )[0];
  return {
    status: field(row, "status"),
    supersededById: field(row, "superseded_by_id"),
    supersededAt: field(row, "superseded_at"),
    amendmentReason: field(row, "amendment_reason"),
  };
}

/** The lifecycle events of a job's certificate, oldest first. */
async function events(jobId: number) {
  return toRows(
    await db.execute(
      sql`SELECT event, superseded_by_job_id, reason, actor_user_id, source
          FROM issued_certificate_status_event
          WHERE job_id = ${jobId} ORDER BY id`,
    ),
  ).map((row) => ({
    event: field(row, "event"),
    supersededByJobId: field(row, "superseded_by_job_id"),
    reason: field(row, "reason"),
    actorUserId: field(row, "actor_user_id"),
    source: field(row, "source"),
  }));
}

async function auditActions(jobId: number) {
  return toRows(
    await db.execute(
      sql`SELECT action FROM job_audit_log WHERE job_id = ${jobId} ORDER BY id`,
    ),
  ).map((row) => field(row, "action"));
}

async function snapshotCount(jobId: number) {
  return toRows(
    await db.execute(
      sql`SELECT id FROM issued_certificate_snapshot WHERE job_id = ${jobId}`,
    ),
  ).length;
}

/** An issued, APPROVED original (rendered by the worker itself, so it has its snapshot and ISSUED event). */
async function seedIssuedOriginal() {
  const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
  const original = await seedIssuableJob({
    organizationId: org.orgId,
    unitId: org.unitId,
    userId: org.userId,
  });
  stubGotenberg();
  await processBackgroundJob(makeEnv(), {
    type: "CERTIFICATE",
    jobId: original.jobId,
    userId: org.userId,
  });
  vi.mocked(notifyCertificateReady).mockClear();
  return { org, original };
}

/** The amendment clone of `original`, as the approval left it: waiting for its certificate. */
async function seedAmendmentAwaitingRender(
  org: { orgId: string; unitId: number; userId: string },
  original: Awaited<ReturnType<typeof seedIssuedOriginal>>["original"],
) {
  const [source] = await db
    .select()
    .from(calibrationJob)
    .where(sql`${calibrationJob.id} = ${original.jobId}`);
  if (!source) throw new Error("original not found");
  const [clone] = await insertJobs({
    jobId: "CAL-2026-0001-R1",
    certificateName: "CAL-2026-0001-R1",
    organizationId: org.orgId,
    unitId: org.unitId,
    customerId: source.customerId,
    assetId: source.assetId,
    serviceId: source.serviceId,
    methodSnapshot: source.methodSnapshot,
    data: source.data,
    results: source.results,
    performedAt: source.performedAt,
    approvedAt: source.approvedAt,
    approvedBy: org.userId,
    createdBy: org.userId,
    supersedesId: original.jobId,
    amendmentNumber: 1,
    amendmentReason: AMENDMENT_REASON,
    status: "GENERATING_PDF",
  });
  if (!clone) throw new Error("amendment not inserted");
  return clone;
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(notifyCertificateAmended).mockClear();
});

describe("certificate lifecycle written by the worker (real DB)", () => {
  it("REQ-B3-W1: an issuance appends the ISSUED event, in the transaction that creates the snapshot", async () => {
    const { org, original } = await seedIssuedOriginal();

    expect(await snapshotCount(original.jobId)).toBe(1);
    expect(await events(original.jobId)).toEqual([
      {
        event: "ISSUED",
        supersededByJobId: null,
        reason: null,
        actorUserId: org.userId,
        source: "worker",
      },
    ]);
  });

  it("REQ-B3-W1: a re-delivery of the same message adds no second ISSUED event", async () => {
    const { org, original } = await seedIssuedOriginal();
    stubGotenberg();

    await processBackgroundJob(makeEnv(), {
      type: "CERTIFICATE",
      jobId: original.jobId,
      userId: org.userId,
    });

    expect(await events(original.jobId)).toHaveLength(1);
  });

  it("REQ-B3-W2 [HIGH RISK]: issuing the replacement supersedes the original atomically (status, link, audit row, SUPERSEDED event)", async () => {
    const { org, original } = await seedIssuedOriginal();
    const amendment = await seedAmendmentAwaitingRender(org, original);
    // Until the replacement is issued the original is the valid certificate.
    expect(await jobState(original.jobId)).toMatchObject({
      status: "APPROVED",
      supersededById: null,
    });

    stubGotenberg();
    await processBackgroundJob(makeEnv(), {
      type: "CERTIFICATE",
      jobId: amendment.id,
      userId: org.userId,
    });

    expect((await jobState(amendment.id)).status).toBe("APPROVED");
    expect(await jobState(original.jobId)).toMatchObject({
      status: "SUPERSEDED",
      supersededById: amendment.id,
      amendmentReason: AMENDMENT_REASON,
    });
    expect((await jobState(original.jobId)).supersededAt).toBeTruthy();
    expect(await events(original.jobId)).toEqual([
      expect.objectContaining({ event: "ISSUED" }),
      {
        event: "SUPERSEDED",
        supersededByJobId: amendment.id,
        reason: AMENDMENT_REASON,
        actorUserId: org.userId,
        source: "worker",
      },
    ]);
    expect(await events(amendment.id)).toEqual([
      expect.objectContaining({ event: "ISSUED", source: "worker" }),
    ]);
    expect(await auditActions(original.jobId)).toContain("supersede");
    expect(await snapshotCount(amendment.id)).toBe(1);
  });

  it("REQ-B3-W7: the customer is told about the amendment once the replacement is issued, and not again on a re-delivery", async () => {
    const { org, original } = await seedIssuedOriginal();
    const amendment = await seedAmendmentAwaitingRender(org, original);

    stubGotenberg();
    const message = {
      type: "CERTIFICATE" as const,
      jobId: amendment.id,
      userId: org.userId,
    };
    await processBackgroundJob(makeEnv(), message);
    await processBackgroundJob(makeEnv(), message);

    expect(notifyCertificateAmended).toHaveBeenCalledTimes(1);
    expect(notifyCertificateAmended).toHaveBeenCalledWith(
      original.jobId,
      amendment.id,
      AMENDMENT_REASON,
    );
  });

  it("REQ-B3-W3 [HIGH RISK]: a render that fails leaves the original APPROVED and unchanged", async () => {
    const { org, original } = await seedIssuedOriginal();
    const amendment = await seedAmendmentAwaitingRender(org, original);
    const eventsBefore = await events(original.jobId);
    const auditBefore = await auditActions(original.jobId);

    stubGotenberg({ fail: true });
    await expect(
      processBackgroundJob(
        makeEnv(),
        { type: "CERTIFICATE", jobId: amendment.id, userId: org.userId },
        { attempt: 3, maxAttempts: 3 },
      ),
    ).rejects.toThrow();

    expect((await jobState(amendment.id)).status).toBe("RENDER_FAILED");
    expect(await jobState(original.jobId)).toMatchObject({
      status: "APPROVED",
      supersededById: null,
      supersededAt: null,
    });
    expect(await events(original.jobId)).toEqual(eventsBefore);
    expect(await auditActions(original.jobId)).toEqual(auditBefore);
    expect(notifyCertificateAmended).not.toHaveBeenCalled();
  });

  it("REQ-B3-W4: an original that cannot be superseded fails the whole issuance; nothing of the replacement is written", async () => {
    const { org, original } = await seedIssuedOriginal();
    const amendment = await seedAmendmentAwaitingRender(org, original);
    // An original no writer leaves behind: audited repair, for this transaction only.
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local calibra.allow_status_repair = 'on'`);
      await tx.execute(sql`set local calibra.allow_audit_rewrite = 'on'`);
      await tx.execute(
        sql`UPDATE calibration_job SET status = 'CANCELED' WHERE id = ${original.jobId}`,
      );
    });

    stubGotenberg();
    await expect(
      processBackgroundJob(
        makeEnv(),
        { type: "CERTIFICATE", jobId: amendment.id, userId: org.userId },
        { attempt: 1, maxAttempts: 3 },
      ),
    ).rejects.toThrow();

    expect((await jobState(amendment.id)).status).toBe("GENERATING_PDF");
    expect(await snapshotCount(amendment.id)).toBe(0);
    expect(await events(amendment.id)).toEqual([]);
    expect(await auditActions(amendment.id)).not.toContain(
      "certificate_generated",
    );
  });

  it("REQ-B3-W5: an original withdrawn while its amendment was in progress stays WITHDRAWN (linked to the replacement, no SUPERSEDED event)", async () => {
    const { org, original } = await seedIssuedOriginal();
    const amendment = await seedAmendmentAwaitingRender(org, original);
    const [certificate] = toRows(
      await db.execute(
        sql`SELECT id FROM issued_certificate_snapshot WHERE job_id = ${original.jobId}`,
      ),
    );
    await db.execute(
      sql`INSERT INTO issued_certificate_status_event
            (organization_id, certificate_id, job_id, event, reason, actor_user_id, source)
          VALUES (${org.orgId}, ${field(certificate, "id")}, ${original.jobId},
                  'WITHDRAWN', 'Padrao de referencia recolhido', ${org.userId}, 'api')`,
    );

    stubGotenberg();
    await processBackgroundJob(makeEnv(), {
      type: "CERTIFICATE",
      jobId: amendment.id,
      userId: org.userId,
    });

    expect(await jobState(original.jobId)).toMatchObject({
      status: "SUPERSEDED",
      supersededById: amendment.id,
    });
    expect((await events(original.jobId)).map((e) => e.event)).toEqual([
      "ISSUED",
      "WITHDRAWN",
    ]);
  });

  it("REQ-B3-W6: an original superseded at creation time by an earlier release (in-flight amendment) gets its event, not a second supersession", async () => {
    const { org, original } = await seedIssuedOriginal();
    const amendment = await seedAmendmentAwaitingRender(org, original);
    // What the previous release did when the amendment was opened.
    await db.execute(
      sql`UPDATE calibration_job
             SET status = 'SUPERSEDED', superseded_by_id = ${amendment.id},
                 superseded_at = now(), amendment_reason = ${AMENDMENT_REASON}
           WHERE id = ${original.jobId}`,
    );

    stubGotenberg();
    await processBackgroundJob(makeEnv(), {
      type: "CERTIFICATE",
      jobId: amendment.id,
      userId: org.userId,
    });

    expect((await jobState(amendment.id)).status).toBe("APPROVED");
    expect((await events(original.jobId)).map((e) => e.event)).toEqual([
      "ISSUED",
      "SUPERSEDED",
    ]);
    // No second `supersede` audit row: the earlier release wrote none either.
    expect(
      (await auditActions(original.jobId)).filter((a) => a === "supersede"),
    ).toEqual([]);
  });
});
