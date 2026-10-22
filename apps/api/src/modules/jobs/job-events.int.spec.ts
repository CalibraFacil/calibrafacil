/**
 * job-events.int.spec.ts: the rows the job lifecycle commands commit through
 * appendJobEvent, read back from a real Postgres and compared WHOLE (the stored
 * columns and the `changes` JSON), not by matching a subset. The audit timeline,
 * the exports and the auditors' queries read these rows by shape, so a command
 * that gained, lost or renamed a key fails here.
 *
 *   REQ-AUD-2  one exact stored row per lifecycle action: reject, cancel,
 *              assign, update, supersede and create_amendment, for a signed-in
 *              user and for an API key
 *   REQ-AUD-4  the audit row commits with the state change and rolls back with
 *              it (the unit-level fixtures of the other actions live in
 *              packages/db/src/job-events.test.ts)
 */

import { setJobStatus } from "../../../test/integration/job-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { jobAuditLog, type JobStatus } from "@calibra-facil/db/schema";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";
import {
  seedExtraMember,
  seedJobForOrg,
} from "../../../test/integration/tenant-refs";
import { failJobAuditInserts, jobRow } from "../../../test/integration/job-cas";
import type { JobLifecycleActor } from "./job-actor";
import { amendJob } from "./amend-job";
import { assignJob } from "./assign-job";
import { cancelJob } from "./cancel-job";
import { editJob } from "./edit-job";
import { rejectJob } from "./reject-job";

vi.mock("../../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

const ORG = "org-ev";
const USER = "user-ev-admin";
const IP = "203.0.113.7";

const user: JobLifecycleActor = { kind: "user", userId: USER, ipAddress: IP };
const apiKey: JobLifecycleActor = {
  kind: "api_key",
  userId: USER,
  apiKey: { id: "key-ev", name: "ERP", keyPrefix: "cf_live_ev" },
  ipAddress: IP,
};
const KEY_FIELDS = {
  source: "public_api",
  channel: "api_key",
  apiKeyId: "key-ev",
  apiKeyName: "ERP",
  apiKeyPrefix: "cf_live_ev",
};

async function seedWorld(status: JobStatus) {
  const org = await seedOrg({ orgId: ORG, userId: USER, role: "admin" });
  const { jobId } = await seedJobForOrg({
    orgId: ORG,
    unitId: org.unitId,
    createdBy: USER,
  });
  await setJobStatus(jobId, status);
  const technician = await seedExtraMember({
    orgId: ORG,
    userId: "user-ev-tech",
    role: "technician",
    unitId: org.unitId,
    unitRole: "technician",
  });
  return { jobId, technician };
}

/** The stored row, without its generated id and clock. */
async function storedRows(jobId: number) {
  const rows = await db
    .select()
    .from(jobAuditLog)
    .where(
      and(eq(jobAuditLog.jobId, jobId), eq(jobAuditLog.organizationId, ORG)),
    )
    .orderBy(jobAuditLog.id);
  return rows.map(({ id: _id, performedAt: _performedAt, ...row }) => row);
}

const base = { unitScope: null, organizationId: ORG } as const;

describe("job lifecycle audit rows through appendJobEvent (real Postgres)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["a user", user, {}],
    ["an API key", apiKey, KEY_FIELDS],
  ] as const)(
    "REQ-AUD-2: reject stores the status move and the reason for %s",
    async (_name, actor, actorFields) => {
      const { jobId } = await seedWorld("REVIEW");

      await rejectJob({
        ...base,
        actor,
        jobId,
        reason: "Leitura inconsistente",
      });

      expect(await storedRows(jobId)).toEqual([
        {
          organizationId: ORG,
          jobId,
          action: "reject",
          changes: {
            ...actorFields,
            status: { old: "REVIEW", new: "REJECTED" },
          },
          performedBy: USER,
          ipAddress: IP,
          reason: "Leitura inconsistente",
        },
      ]);
    },
  );

  it.each([
    ["a user", user, {}],
    ["an API key", apiKey, KEY_FIELDS],
  ] as const)(
    "REQ-AUD-2: cancel stores the status move and the reason for %s",
    async (_name, actor, actorFields) => {
      const { jobId } = await seedWorld("DRAFT");

      await cancelJob({ ...base, actor, jobId, reason: "Cliente desistiu" });

      expect(await storedRows(jobId)).toEqual([
        {
          organizationId: ORG,
          jobId,
          action: "cancel",
          changes: {
            ...actorFields,
            status: { old: "DRAFT", new: "CANCELED" },
          },
          performedBy: USER,
          ipAddress: IP,
          reason: "Cliente desistiu",
        },
      ]);
    },
  );

  it.each([
    ["a user", user, {}],
    ["an API key", apiKey, KEY_FIELDS],
  ] as const)(
    "REQ-AUD-2: assign stores the technician before and after, and the name, for %s",
    async (_name, actor, actorFields) => {
      const { jobId, technician } = await seedWorld("DRAFT");

      await assignJob({
        ...base,
        actor,
        jobId,
        technicianId: technician.userId,
      });

      expect(await storedRows(jobId)).toEqual([
        {
          organizationId: ORG,
          jobId,
          action: "assign",
          changes: {
            ...actorFields,
            technicianId: { old: null, new: technician.userId },
            technicianName: { old: null, new: "User user-ev-tech" },
          },
          performedBy: USER,
          ipAddress: IP,
          reason: null,
        },
      ]);
    },
  );

  it.each([
    ["a user", user, {}],
    ["an API key", apiKey, KEY_FIELDS],
  ] as const)(
    "REQ-AUD-2: update stores the due date before and after for %s",
    async (_name, actor, actorFields) => {
      const { jobId } = await seedWorld("DRAFT");

      await editJob({
        ...base,
        actor,
        jobId,
        dueDate: "2031-03-04T12:00:00.000Z",
      });

      expect(await storedRows(jobId)).toEqual([
        {
          organizationId: ORG,
          jobId,
          action: "update",
          changes: {
            ...actorFields,
            dueDate: { old: null, new: "2031-03-04T12:00:00.000Z" },
          },
          performedBy: USER,
          ipAddress: IP,
          reason: null,
        },
      ]);
    },
  );

  it("REQ-AUD-2: amend stores supersede on the original and create_amendment on the new job", async () => {
    const { jobId } = await seedWorld("APPROVED");

    const result = await amendJob({
      ...base,
      actor: user,
      jobId,
      reason: "Erro de digitacao no certificado",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const { amendedJob, amendmentNumber } = result;
    expect(await storedRows(jobId)).toEqual([
      {
        organizationId: ORG,
        jobId,
        action: "supersede",
        changes: {
          status: { old: "APPROVED", new: "SUPERSEDED" },
          supersededById: amendedJob.id,
        },
        performedBy: USER,
        ipAddress: IP,
        reason: `Certificado retificado. Novo: ${amendedJob.jobId}. Motivo: Erro de digitacao no certificado`,
      },
    ]);
    expect(await storedRows(amendedJob.id)).toEqual([
      {
        organizationId: ORG,
        jobId: amendedJob.id,
        action: "create_amendment",
        changes: {
          supersedesId: jobId,
          amendmentNumber,
          reason: "Erro de digitacao no certificado",
        },
        performedBy: USER,
        ipAddress: IP,
        reason: "Erro de digitacao no certificado",
      },
    ]);
  });

  it("REQ-AUD-4: an audit insert that fails rolls the state change back (the row is part of the command's transaction)", async () => {
    const { jobId } = await seedWorld("REVIEW");
    const before = await jobRow(jobId);
    const restore = await failJobAuditInserts();

    try {
      await expect(
        rejectJob({ ...base, actor: user, jobId, reason: "x" }),
      ).rejects.toThrow();
    } finally {
      await restore();
    }

    expect(await jobRow(jobId)).toEqual(before);
    expect(await storedRows(jobId)).toEqual([]);
  });
});
