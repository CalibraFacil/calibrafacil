import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Env } from "@calibra-facil/jobs-core";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { seedOrg } from "../test/integration/seed";
import { seedIssuableJob } from "../test/integration/seed-certificate";

/**
 * REQ-AUD-2 / REQ-AUD-4 — the worker writes job_audit_log through appendJobEvent
 * (Drizzle over its own pg client, inside the BEGIN the worker opened). Each
 * action the worker owns is read back from the real table and compared whole:
 * the stored columns and the `changes` JSON are what production rows already
 * hold, written against the user the worker acts for.
 */

vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => undefined),
  notifyAuditPackReady: vi.fn(async () => undefined),
}));

import { processBackgroundJob } from "@calibra-facil/jobs-core";

const GOTENBERG_URL = "http://gotenberg.test";
const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const USER_ID = "user-org-1";

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

function rowsOf(result: unknown): unknown[] {
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

async function auditRowsOf(jobId: number, action: string) {
  const result = await db.execute(
    sql`SELECT organization_id, job_id, action, changes, performed_by,
               performed_at, ip_address, reason
        FROM job_audit_log WHERE job_id = ${jobId} AND action = ${action}
        ORDER BY id`,
  );
  return rowsOf(result);
}

async function seed(status?: Parameters<typeof seedIssuableJob>[0]["status"]) {
  const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
  const job = await seedIssuableJob({
    organizationId: org.orgId,
    unitId: org.unitId,
    userId: org.userId,
    ...(status ? { status } : {}),
  });
  return { org, job };
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("worker job events through appendJobEvent (real DB)", () => {
  it("REQ-AUD-2 REQ-AUD-4: certificate_generated is stored with the status move, the URL and the unsigned marker", async () => {
    stubGotenberg();
    const { org, job } = await seed();

    await processBackgroundJob(makeEnv(), {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    const [row] = await auditRowsOf(job.jobId, "certificate_generated");
    expect(await auditRowsOf(job.jobId, "certificate_generated")).toHaveLength(
      1,
    );
    expect(field(row, "organization_id")).toBe(org.orgId);
    expect(field(row, "performed_by")).toBe(USER_ID);
    expect(field(row, "ip_address")).toBeNull();
    expect(field(row, "reason")).toBeNull();
    expect(field(row, "performed_at")).not.toBeNull();
    const url = field(field(row, "changes"), "certificateUrl");
    expect(field(url, "old")).toBeNull();
    expect(field(url, "new")).toMatch(/^https:\/\/storage\.invalid\/org\//);
    expect(field(row, "changes")).toEqual({
      status: { old: "GENERATING_PDF", new: "APPROVED" },
      certificateUrl: { old: null, new: field(url, "new") },
      signatureMetadata: { signed: false },
    });
  });

  it("REQ-AUD-2 REQ-AUD-4: certificate_watermarked keeps its plain status text", async () => {
    stubGotenberg();
    const { org, job } = await seed("SUPERSEDED");

    await processBackgroundJob(makeEnv(), {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    const [row] = await auditRowsOf(job.jobId, "certificate_watermarked");
    expect(field(row, "organization_id")).toBe(org.orgId);
    expect(field(row, "performed_by")).toBe(USER_ID);
    const url = field(field(row, "changes"), "certificateUrl");
    expect(field(row, "changes")).toEqual({
      status: "SUPERSEDED (watermark added)",
      certificateUrl: { old: null, new: field(url, "new") },
      signatureMetadata: { signed: false },
    });
  });

  it("REQ-AUD-2 REQ-AUD-4: certificate_error is stored with the status move and the failure as the reason", async () => {
    stubGotenberg({ fail: true });
    const { org, job } = await seed();

    await expect(
      processBackgroundJob(
        makeEnv(),
        { type: "CERTIFICATE", jobId: job.jobId, userId: org.userId },
        { attempt: 3, maxAttempts: 3 },
      ),
    ).rejects.toThrow();

    const rows = await auditRowsOf(job.jobId, "certificate_error");
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(field(row, "organization_id")).toBe(org.orgId);
    expect(field(row, "performed_by")).toBe(USER_ID);
    expect(field(row, "changes")).toEqual({
      status: { old: "GENERATING_PDF", new: "REJECTED" },
    });
    expect(typeof field(row, "reason")).toBe("string");
    expect(field(row, "reason")).not.toBe("");
  });

  it("REQ-AUD-2 REQ-AUD-4: label_generated is stored with the label URL", async () => {
    stubGotenberg();
    const { org, job } = await seed("APPROVED");

    await processBackgroundJob(makeEnv(), {
      type: "LABEL",
      jobId: job.jobId,
      userId: org.userId,
    });

    const rows = await auditRowsOf(job.jobId, "label_generated");
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(field(row, "organization_id")).toBe(org.orgId);
    expect(field(row, "performed_by")).toBe(USER_ID);
    const url = field(field(row, "changes"), "labelUrl");
    expect(field(url, "new")).toMatch(/^https:\/\/storage\.invalid\/org\//);
    expect(field(row, "changes")).toEqual({
      labelUrl: { old: null, new: field(url, "new") },
    });
  });
});
