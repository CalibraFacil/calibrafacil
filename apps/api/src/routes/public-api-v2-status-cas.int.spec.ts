/**
 * public-api-v2-status-cas.int.spec.ts — real-Postgres proof that every
 * calibration_job write of the public API v2 job routes (PATCH /jobs/:id,
 * POST /jobs/:id/results, /submit, /reject) is a compare-and-set that carries
 * the caller's organization and commits together with its audit row.
 *
 *   REQ-CAS-1  the UPDATE matches on the validated status AND organization_id;
 *              zero rows → 409 job_status_conflict, never a silent success
 *   REQ-CAS-2  the UPDATE and its job_audit_log insert share one transaction
 *   REQ-CAS-3  non-status writes (PATCH data) carry the same guards
 *   REQ-CAS-4  the happy path is unchanged (same status, same body shape)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicApiV2Router } from "./public-api-v2";
import { db } from "@calibra-facil/db";
import { calibrationJob, organizationApiKey } from "@calibra-facil/db/schema";
import type { JobStatus } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { createApiKeySecret } from "../lib/api-keys";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { seedJobForOrg } from "../../test/integration/tenant-refs";
import { executableMethodSnapshot } from "../../test/integration/executable-method";
import {
  auditActions,
  changeJobBeforeNextTransaction,
  failJobAuditInserts,
  jobRow,
  withoutVolatile,
} from "../../test/integration/job-cas";

async function seedApiKey(params: {
  orgId: string;
  userId: string;
  keyId: string;
}): Promise<string> {
  const { key, keyPrefix, keyHash } = createApiKeySecret();
  await db.insert(organizationApiKey).values({
    id: params.keyId,
    organizationId: params.orgId,
    name: `Test key ${params.keyId}`,
    keyPrefix,
    keyHash,
    scopes: ["jobs:write"],
    createdBy: params.userId,
  });
  return key;
}

type Site = {
  name: string;
  /** Audit action the route writes with its status/data change. */
  action: string;
  /** Status the job is in when the route legitimately runs. */
  from: JobStatus;
  /** Status another actor moves the job to between the route's read and write. */
  rival: JobStatus;
  /** Status after the happy path. */
  to: JobStatus;
  send: (rawKey: string, jobId: number, key: string) => Promise<Response>;
};

function post(path: string, body: unknown) {
  return (rawKey: string, jobId: number, key: string) =>
    publicApiV2Router.request(`/jobs/${jobId}${path}`, {
      method: "POST",
      headers: {
        "x-api-key": rawKey,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
}

const SITES: Site[] = [
  {
    name: "PATCH /jobs/:id",
    action: "update",
    from: "IN_PROGRESS",
    rival: "CANCELED",
    to: "IN_PROGRESS",
    send: (rawKey, jobId) =>
      publicApiV2Router.request(`/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "x-api-key": rawKey, "content-type": "application/json" },
        body: JSON.stringify({ dueDate: "2030-01-31T12:00:00.000Z" }),
      }),
  },
  {
    name: "POST /jobs/:id/results",
    action: "execute",
    from: "DRAFT",
    rival: "CANCELED",
    to: "IN_PROGRESS",
    send: post("/results", {
      data: { indication: "10", reference: "9", marcador: "cas-results" },
    }),
  },
  {
    name: "POST /jobs/:id/submit",
    action: "submit",
    from: "IN_PROGRESS",
    rival: "GENERATING_PDF",
    to: "REVIEW",
    send: post("/submit", {
      data: { indication: "10", reference: "9", marcador: "cas-submit" },
      calibrationLocation: { type: "lab", addressText: "Laboratório" },
    }),
  },
  {
    name: "POST /jobs/:id/reject",
    action: "reject",
    from: "REVIEW",
    rival: "CANCELED",
    to: "REJECTED",
    send: post("/reject", { reason: "Erros no procedimento" }),
  },
];

async function seedWorld(from: JobStatus) {
  const orgA = await seedOrg({ orgId: "org-a" });
  const orgB = await seedOrg({ orgId: "org-b" });
  const keyA = await seedApiKey({
    orgId: orgA.orgId,
    userId: orgA.userId,
    keyId: "key-a",
  });
  const keyB = await seedApiKey({
    orgId: orgB.orgId,
    userId: orgB.userId,
    keyId: "key-b",
  });
  const { jobId } = await seedJobForOrg({
    orgId: orgA.orgId,
    unitId: orgA.unitId,
    createdBy: orgA.userId,
  });
  await db
    .update(calibrationJob)
    // The results and submit routes run the official execution of the job's
    // compiled method (the one submit/execute command), so the job carries one.
    .set({ status: from, methodSnapshot: executableMethodSnapshot() })
    .where(eq(calibrationJob.id, jobId));
  return { orgA, orgB, keyA, keyB, jobId };
}

describe("publicApiV2Router — job writes are compare-and-set, org-scoped, audited in-transaction", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each(SITES)("$name", (site) => {
    it(`REQ-CAS-4: control — with no interleaved change it succeeds (200 ${site.to}) with exactly one ${site.action} audit row`, async () => {
      const { keyA, jobId } = await seedWorld(site.from);

      const res = await site.send(keyA, jobId, "cas-ok");

      expect(res.status).toBe(200);
      expect((await jobRow(jobId)).status).toBe(site.to);
      expect(await auditActions(jobId)).toEqual([site.action]);
    });

    it(`REQ-CAS-1 [HIGH RISK]: a job moved to ${site.rival} between the read and the write → 409 job_status_conflict; the other actor's status stands; nothing else written; no audit row`, async () => {
      const { keyA, jobId } = await seedWorld(site.from);
      const before = await jobRow(jobId);
      changeJobBeforeNextTransaction(jobId, { status: site.rival });

      const res = await site.send(keyA, jobId, "cas-race");

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        error: { code: "job_status_conflict" },
      });
      const after = await jobRow(jobId);
      expect(after.status).toBe(site.rival);
      expect(withoutVolatile(after)).toEqual(withoutVolatile(before));
      expect(await auditActions(jobId)).toEqual([]);
    });

    it("REQ-CAS-1 [HIGH RISK]: the write is also scoped by organization — a job that left the caller's organization between the read and the write is not touched → 409; no audit row", async () => {
      const { keyA, orgB, jobId } = await seedWorld(site.from);
      const before = await jobRow(jobId);
      changeJobBeforeNextTransaction(jobId, { organizationId: orgB.orgId });

      const res = await site.send(keyA, jobId, "cas-org-race");

      expect(res.status).toBe(409);
      const after = await jobRow(jobId);
      expect(after.organizationId).toBe(orgB.orgId);
      expect(after.status).toBe(site.from);
      expect(withoutVolatile(after)).toEqual({
        ...withoutVolatile(before),
        organizationId: orgB.orgId,
      });
      expect(await auditActions(jobId)).toEqual([]);
    });

    it("REQ-CAS-1 [HIGH RISK]: another organization's key on this job id → 404; nothing changes; no audit row", async () => {
      const { keyB, jobId } = await seedWorld(site.from);
      const before = await jobRow(jobId);

      const res = await site.send(keyB, jobId, "cas-cross-org");

      expect(res.status).toBe(404);
      expect(await jobRow(jobId)).toEqual(before);
      expect(await auditActions(jobId)).toEqual([]);
    });

    it("REQ-CAS-2 [HIGH RISK]: when the audit insert fails the status change rolls back with it", async () => {
      const { keyA, jobId } = await seedWorld(site.from);
      const before = await jobRow(jobId);
      const restore = await failJobAuditInserts();
      try {
        const res = await site.send(keyA, jobId, "cas-audit-fail");

        expect(res.status).toBeGreaterThanOrEqual(500);
      } finally {
        await restore();
      }

      expect(await jobRow(jobId)).toEqual(before);
      expect(await auditActions(jobId)).toEqual([]);
    });
  });
});
