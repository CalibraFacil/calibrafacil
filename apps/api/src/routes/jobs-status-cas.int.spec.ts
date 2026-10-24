/**
 * jobs-status-cas.int.spec.ts — real-Postgres proof that the calibration_job
 * writes of the lab job routes that were not yet guarded (PUT /:id, POST
 * /:id/assign, and the asset-snapshot freeze that POST /:id/execute and
 * /:id/submit perform before their own status write) are compare-and-set
 * writes that carry the caller's organization and, where they have one, commit
 * together with their audit row.
 *
 *   REQ-CAS-1  the UPDATE matches on the validated status AND organization_id;
 *              zero rows → 409 JOB_STATUS_CONFLICT, never a silent success
 *   REQ-CAS-2  the UPDATE and its job_audit_log insert share one transaction
 *   REQ-CAS-3  non-status writes (technician/due date/asset snapshot) carry the
 *              same guards, matching the statuses the route allows
 *   REQ-CAS-4  the happy path is unchanged
 */

import { setJobStatus } from "../../test/integration/job-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jobsRouter } from "./jobs";
import type { JobStatus } from "@calibra-facil/db/schema";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { seedJobForOrg } from "../../test/integration/tenant-refs";
import { executableMethodSnapshot } from "../../test/integration/executable-method";
import {
  auditActions,
  changeJobBeforeNextTransaction,
  failJobAuditInserts,
  jobRow,
  raceWithRowLock,
  withoutVolatile,
} from "../../test/integration/job-cas";

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

const JSON_HEADERS = { "content-type": "application/json" };

async function seedWorld(from: JobStatus) {
  const orgA = await seedOrg({ orgId: "org-a", userId: "user-a" });
  const orgB = await seedOrg({ orgId: "org-b", userId: "user-b" });
  const { jobId } = await seedJobForOrg({
    orgId: orgA.orgId,
    unitId: orgA.unitId,
    createdBy: orgA.userId,
  });
  await setJobStatus(jobId, from, {
    methodSnapshot: executableMethodSnapshot(),
  });
  loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
  return { orgA, orgB, jobId };
}

type Site = {
  name: string;
  action: string;
  from: JobStatus;
  /** A status the route's own pre-check refuses, reached by a concurrent actor. */
  rival: JobStatus;
  to: JobStatus;
  send: (jobId: number, userId: string) => Promise<Response>;
};

const SITES: Site[] = [
  {
    name: "PUT /:id",
    action: "update",
    from: "IN_PROGRESS",
    rival: "APPROVED",
    to: "IN_PROGRESS",
    send: (jobId) =>
      jobsRouter.request(`/${jobId}`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ dueDate: "2030-01-31T12:00:00.000Z" }),
      }),
  },
  {
    name: "POST /:id/assign",
    action: "assign",
    from: "DRAFT",
    rival: "APPROVED",
    to: "DRAFT",
    send: (jobId, userId) =>
      jobsRouter.request(`/${jobId}/assign`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ technicianId: userId }),
      }),
  },
];

describe("jobsRouter — PUT /:id and POST /:id/assign are compare-and-set, org-scoped, audited in-transaction", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each(SITES)("$name", (site) => {
    it(`REQ-CAS-4: control — with no interleaved change it succeeds (200) with exactly one ${site.action} audit row`, async () => {
      const { orgA, jobId } = await seedWorld(site.from);

      const res = await site.send(jobId, orgA.userId);

      expect(res.status).toBe(200);
      expect((await jobRow(jobId)).status).toBe(site.to);
      expect(await auditActions(jobId)).toEqual([site.action]);
    });

    it(`REQ-CAS-1 [HIGH RISK]: a job moved to ${site.rival} between the read and the write → 409 JOB_STATUS_CONFLICT; the other actor's status stands; nothing else written; no audit row`, async () => {
      const { orgA, jobId } = await seedWorld(site.from);
      const before = await jobRow(jobId);
      changeJobBeforeNextTransaction(jobId, { status: site.rival });

      const res = await site.send(jobId, orgA.userId);

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: "JOB_STATUS_CONFLICT",
        currentStatus: site.rival,
      });
      const after = await jobRow(jobId);
      expect(after.status).toBe(site.rival);
      expect(withoutVolatile(after)).toEqual(withoutVolatile(before));
      expect(await auditActions(jobId)).toEqual([]);
    });

    it("REQ-CAS-1 [HIGH RISK]: the write is also scoped by organization — a job that left the caller's organization between the read and the write is not touched → 409; no audit row", async () => {
      const { orgA, orgB, jobId } = await seedWorld(site.from);
      const before = await jobRow(jobId);
      changeJobBeforeNextTransaction(jobId, { organizationId: orgB.orgId });

      const res = await site.send(jobId, orgA.userId);

      expect(res.status).toBe(409);
      const after = await jobRow(jobId);
      expect(withoutVolatile(after)).toEqual({
        ...withoutVolatile(before),
        organizationId: orgB.orgId,
      });
      expect(after.status).toBe(site.from);
      expect(await auditActions(jobId)).toEqual([]);
    });

    it("REQ-CAS-1 [HIGH RISK]: the 409 of a job that left the caller's organization reveals nothing of the other organization: currentStatus is null", async () => {
      const { orgA, orgB, jobId } = await seedWorld(site.from);
      // The job now lives in another organization, whatever its status there.
      changeJobBeforeNextTransaction(jobId, { organizationId: orgB.orgId });

      const res = await site.send(jobId, orgA.userId);

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: "JOB_STATUS_CONFLICT",
        currentStatus: null,
        details: { currentStatus: null },
      });
    });

    it("REQ-CAS-1 [HIGH RISK]: another organization's admin on this job id → 404; nothing changes; no audit row", async () => {
      const { orgB, jobId } = await seedWorld(site.from);
      const before = await jobRow(jobId);
      loginAs({ userId: orgB.userId, organizationId: orgB.orgId });

      const res = await site.send(jobId, orgB.userId);

      expect(res.status).toBe(404);
      expect(await jobRow(jobId)).toEqual(before);
      expect(await auditActions(jobId)).toEqual([]);
    });

    it("REQ-CAS-2 [HIGH RISK]: when the audit insert fails the write rolls back with it", async () => {
      const { orgA, jobId } = await seedWorld(site.from);
      const before = await jobRow(jobId);
      const restore = await failJobAuditInserts();
      try {
        const res = await site.send(jobId, orgA.userId);

        expect(res.status).toBeGreaterThanOrEqual(500);
      } finally {
        await restore();
      }

      expect(await jobRow(jobId)).toEqual(before);
      expect(await auditActions(jobId)).toEqual([]);
    });
  });
});

describe("jobsRouter — the asset snapshot frozen before execute/submit is a guarded write (REQ-CAS-3)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  type SnapshotSite = {
    name: string;
    from: JobStatus;
    to: JobStatus;
    send: (jobId: number) => Promise<Response>;
  };

  const SNAPSHOT_SITES: SnapshotSite[] = [
    {
      name: "POST /:id/execute",
      from: "DRAFT",
      to: "IN_PROGRESS",
      send: (jobId) =>
        jobsRouter.request(`/${jobId}/execute`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ data: { indication: "10", reference: "9" } }),
        }),
    },
    {
      name: "POST /:id/submit",
      from: "IN_PROGRESS",
      to: "REVIEW",
      send: (jobId) =>
        jobsRouter.request(`/${jobId}/submit`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            calibrationLocation: { type: "lab", addressText: "Laboratório" },
            data: { indication: "10", reference: "9" },
          }),
        }),
    },
  ];

  describe.each(SNAPSHOT_SITES)("$name", (site) => {
    it("REQ-CAS-4: control — with no interleaved change the snapshot is frozen and the route succeeds", async () => {
      const { jobId } = await seedWorld(site.from);
      expect((await jobRow(jobId)).assetSnapshot).toBeNull();

      const res = await site.send(jobId);

      expect(res.status).toBe(200);
      const after = await jobRow(jobId);
      expect(after.status).toBe(site.to);
      expect(after.assetSnapshot).not.toBeNull();
    });

    it("REQ-CAS-3 [HIGH RISK]: a job cancelled while the snapshot write waits on its row → 409 JOB_STATUS_CONFLICT; the snapshot is not written; no audit row", async () => {
      const { jobId } = await seedWorld(site.from);
      const before = await jobRow(jobId);

      const res = await raceWithRowLock({
        jobId,
        change: { status: "CANCELED" },
        request: () => site.send(jobId),
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: "JOB_STATUS_CONFLICT",
        currentStatus: "CANCELED",
      });
      const after = await jobRow(jobId);
      expect(after.status).toBe("CANCELED");
      expect(withoutVolatile(after)).toEqual(withoutVolatile(before));
      expect(await auditActions(jobId)).toEqual([]);
    });

    it("REQ-CAS-3 [HIGH RISK]: a job that left the caller's organization while the snapshot write waits on its row is not touched → 409; the snapshot is not written", async () => {
      const { orgB, jobId } = await seedWorld(site.from);
      const before = await jobRow(jobId);

      const res = await raceWithRowLock({
        jobId,
        change: { organizationId: orgB.orgId },
        request: () => site.send(jobId),
      });

      expect(res.status).toBe(409);
      const after = await jobRow(jobId);
      expect(withoutVolatile(after)).toEqual({
        ...withoutVolatile(before),
        organizationId: orgB.orgId,
      });
      expect(await auditActions(jobId)).toEqual([]);
    });
  });
});
