/**
 * job-lifecycle-entry-points.int.spec.ts: reject, cancel, assign and edit are
 * ONE policy each, whichever door the request comes through.
 *
 *   reject  cloud `POST /jobs/:id/reject`      public API `POST /v2/jobs/:id/reject`
 *   cancel  cloud `DELETE /jobs/:id`           public API `DELETE /v2/jobs/:id`
 *           visits `DELETE /visits/:id/jobs/:jobId`
 *   assign  cloud `POST /jobs/:id/assign`
 *   edit    cloud `PUT /jobs/:id`              public API `PATCH /v2/jobs/:id`
 *
 * Every rule below runs against EVERY entry point it applies to, against a real
 * Postgres and the real RBAC / API-key middleware (only the better-auth
 * session, the queue and the notifications are faked).
 *
 *   REQ-LC-4a  each status x each entry point: the transition table decides, a
 *              legal call lands where the table says and writes ONE audit row, an
 *              illegal one is refused and writes nothing
 *   REQ-LC-4b  another organization's actor / key cannot reach the job (404),
 *              nothing is written
 *   REQ-LC-4c  compare-and-set: the job changed between the read and the write
 *              -> 409, the other actor's status stands, NO audit row
 *   REQ-LC-4d  the audit row names the actor, and for an API key the channel
 *              and the key's identity
 *   REQ-LC-4e  Q25 / Q26: PUT, PATCH and assign refuse the same technicians
 *              with the same code, and all run the competence gate
 *   REQ-LC-3   Q19: assign is refused on CANCELED, GENERATING_PDF, APPROVED and
 *              SUPERSEDED
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { organizationOf } from "../../../test/integration/organization-of";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  calibrationVisit,
  jobAuditLog,
  type JobStatus,
} from "@calibra-facil/db/schema";
import { JobStatusSchema } from "@calibra-facil/schemas";
import {
  allowedFrom,
  targetOf,
  type JobCommand,
} from "@calibra-facil/schemas/job-transitions";
import { loginAs, logout } from "../../../test/integration/setup";
import { requireCompetenceForJob } from "../../../test/integration/job-competence";
import { truncateAll } from "../../../test/integration/db";
import { seedApiKey, seedOrg } from "../../../test/integration/seed";
import {
  seedExtraMember,
  seedJobForOrg,
} from "../../../test/integration/tenant-refs";
import {
  changeJobBeforeNextTransaction,
  jobRow,
} from "../../../test/integration/job-cas";
import { jobsRouter } from "../../routes/jobs";
import { publicApiV2Router } from "../../routes/public-api-v2";
import { visitJobsRouter } from "../../routes/visits";

vi.mock("../../lib/background-jobs", () => ({
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
const ORG = "org-lcm";
const OTHER_ORG = "org-lcm-other";
const ADMIN = "user-lcm-admin";
const OTHER_ADMIN = "user-lcm-other";
const TECHNICIAN = "user-lcm-tech";
const KEY_ID = "key-lcm";
const KEY_NAME = "ERP integration";
const IP = "203.0.113.5";
const DUE_DATE = "2031-03-04T12:00:00.000Z";
const STATUSES: readonly JobStatus[] = JobStatusSchema.options;

async function seedWorld(status: JobStatus) {
  const org = await seedOrg({ orgId: ORG, userId: ADMIN, role: "admin" });
  const other = await seedOrg({
    orgId: OTHER_ORG,
    userId: OTHER_ADMIN,
    role: "admin",
  });
  await seedExtraMember({
    orgId: ORG,
    userId: TECHNICIAN,
    role: "technician",
    unitId: org.unitId,
    unitRole: "technician",
  });
  const { jobId } = await seedJobForOrg({
    orgId: ORG,
    unitId: org.unitId,
    createdBy: ADMIN,
  });
  const key = await seedApiKey({
    organizationId: ORG,
    createdBy: ADMIN,
    scopes: ["jobs:write"],
    keyId: KEY_ID,
    name: KEY_NAME,
  });
  const otherKey = await seedApiKey({
    organizationId: OTHER_ORG,
    createdBy: OTHER_ADMIN,
    scopes: ["jobs:write"],
    keyId: "key-lcm-other",
  });

  // A PROPOSED visit that holds the job, for the visit's remove-job. Linked and
  // moved to `status` in one update: an approved job is frozen.
  const job = await jobRow(jobId);
  const [visit] = await db
    .insert(calibrationVisit)
    .values({
      organizationId: ORG,
      unitId: org.unitId,
      customerId: job.customerId,
      createdBy: ADMIN,
      status: "PROPOSED",
    })
    .returning({ id: calibrationVisit.id });
  if (!visit) throw new Error("seedWorld: visit insert failed");
  await db
    .update(calibrationJob)
    .set({ status, visitId: visit.id })
    .where(eq(calibrationJob.id, jobId));

  return {
    org,
    other,
    jobId,
    visitId: visit.id,
    rawKey: key.rawKey,
    keyPrefix: key.keyPrefix,
    otherRawKey: otherKey.rawKey,
  };
}

type World = Awaited<ReturnType<typeof seedWorld>>;
type Who = "member" | "foreign";

/** What the caller sees, whatever the transport. */
type Outcome =
  | { ok: true }
  | { ok: false; status: number; code: string | undefined };

async function outcomeOf(res: Response): Promise<Outcome> {
  if (res.status >= 200 && res.status < 300) return { ok: true };
  const body: unknown = await res.json();
  const record = body && typeof body === "object" ? Object(body) : {};
  const nested =
    record.error && typeof record.error === "object" ? record.error : null;
  const code = nested?.code ?? record.code;
  return {
    ok: false,
    status: res.status,
    code: typeof code === "string" ? code : undefined,
  };
}

let sequence = 0;
function nextKey() {
  sequence += 1;
  return `k-lcm-${sequence}`;
}

function login(who: Who) {
  loginAs(
    who === "member"
      ? { userId: ADMIN, organizationId: ORG }
      : { userId: OTHER_ADMIN, organizationId: OTHER_ORG },
  );
}

function apiKeyHeaders(world: World, who: Who) {
  return {
    ...JSON_HEADERS,
    "x-api-key": who === "member" ? world.rawKey : world.otherRawKey,
    "x-forwarded-for": IP,
    "idempotency-key": nextKey(),
  };
}

type EntryPoint = {
  name: string;
  /** The statuses the entry point lets through to a write. */
  legal: readonly JobStatus[];
  /** What a refusal looks like on this transport. */
  refusal: { status: number; code?: string };
  /** The code of the lost compare-and-set. */
  raceCode: string;
  /** The audit row's `ip_address`. */
  ip: string;
  channel: "session" | "api_key";
  run: (world: World, who: Who) => Promise<Outcome>;
};

type Case = {
  command: string;
  table: JobCommand;
  action: string;
  /** The status the race starts from, and the one another actor moves it to. */
  raceFrom: JobStatus;
  rival: JobStatus;
  /** What a legal call leaves on the job. */
  expectEffect: (row: Awaited<ReturnType<typeof jobRow>>) => void;
  /** What the audit row's `changes` carries beyond the actor fields. */
  changes: (from: JobStatus, to: JobStatus) => Record<string, unknown>;
  entries: EntryPoint[];
};

const cloudConflict = "JOB_STATUS_CONFLICT";
const publicConflict = "job_status_conflict";

const REJECT: Case = {
  command: "reject",
  table: "reject",
  action: "reject",
  raceFrom: "REVIEW",
  rival: "GENERATING_PDF",
  expectEffect: (row) => {
    expect(row.rejectedBy).toBe(ADMIN);
    expect(row.rejectionReason).toBe("Leitura inconsistente");
    expect(row.rejectedAt).toBeInstanceOf(Date);
  },
  changes: (from, to) => ({ status: { old: from, new: to } }),
  entries: [
    {
      name: "cloud route",
      legal: allowedFrom("reject"),
      refusal: { status: 400, code: "job_not_rejectable" },
      raceCode: cloudConflict,
      ip: IP,
      channel: "session",
      async run(world, who) {
        login(who);
        return outcomeOf(
          await jobsRouter.request(`/${world.jobId}/reject`, {
            method: "POST",
            headers: { ...JSON_HEADERS, "x-forwarded-for": IP },
            body: JSON.stringify({ reason: "Leitura inconsistente" }),
          }),
        );
      },
    },
    {
      name: "public API",
      legal: allowedFrom("reject"),
      refusal: { status: 409, code: "job_not_rejectable" },
      raceCode: publicConflict,
      ip: IP,
      channel: "api_key",
      async run(world, who) {
        return outcomeOf(
          await publicApiV2Router.request(`/jobs/${world.jobId}/reject`, {
            method: "POST",
            headers: apiKeyHeaders(world, who),
            body: JSON.stringify({ reason: "Leitura inconsistente" }),
          }),
        );
      },
    },
  ],
};

const CANCEL: Case = {
  command: "cancel",
  table: "cancel",
  action: "cancel",
  raceFrom: "DRAFT",
  rival: "APPROVED",
  expectEffect: () => {},
  changes: (from, to) => ({ status: { old: from, new: to } }),
  entries: [
    {
      name: "cloud route",
      legal: allowedFrom("cancel"),
      refusal: { status: 400, code: "job_not_cancelable" },
      raceCode: cloudConflict,
      ip: IP,
      channel: "session",
      async run(world, who) {
        login(who);
        return outcomeOf(
          await jobsRouter.request(`/${world.jobId}`, {
            method: "DELETE",
            headers: { ...JSON_HEADERS, "x-forwarded-for": IP },
            body: JSON.stringify({ reason: "Cliente desistiu" }),
          }),
        );
      },
    },
    {
      name: "public API",
      legal: allowedFrom("cancel"),
      refusal: { status: 409, code: "job_not_cancelable" },
      raceCode: publicConflict,
      ip: IP,
      channel: "api_key",
      async run(world, who) {
        return outcomeOf(
          await publicApiV2Router.request(`/jobs/${world.jobId}`, {
            method: "DELETE",
            headers: apiKeyHeaders(world, who),
            body: JSON.stringify({ reason: "Cliente desistiu" }),
          }),
        );
      },
    },
    {
      name: "visit remove-job",
      // The visit's own guard lets DRAFT through and nothing else.
      legal: ["DRAFT"],
      refusal: { status: 409 },
      raceCode: cloudConflict,
      ip: IP,
      channel: "session",
      async run(world, who) {
        login(who);
        return outcomeOf(
          await visitJobsRouter.request(
            `/${world.visitId}/jobs/${world.jobId}`,
            { method: "DELETE", headers: { "x-forwarded-for": IP } },
          ),
        );
      },
    },
  ],
};

const ASSIGN: Case = {
  command: "assign",
  table: "assign",
  action: "assign",
  raceFrom: "DRAFT",
  rival: "APPROVED",
  expectEffect: (row) => {
    expect(row.technicianId).toBe(TECHNICIAN);
  },
  changes: () => ({
    technicianId: { old: null, new: TECHNICIAN },
    technicianName: { old: null, new: `User ${TECHNICIAN}` },
  }),
  entries: [
    {
      name: "cloud route",
      legal: allowedFrom("assign"),
      refusal: { status: 400, code: "job_not_assignable" },
      raceCode: cloudConflict,
      ip: IP,
      channel: "session",
      async run(world, who) {
        login(who);
        return outcomeOf(
          await jobsRouter.request(`/${world.jobId}/assign`, {
            method: "POST",
            headers: { ...JSON_HEADERS, "x-forwarded-for": IP },
            body: JSON.stringify({ technicianId: TECHNICIAN }),
          }),
        );
      },
    },
  ],
};

const EDIT: Case = {
  command: "edit",
  table: "edit",
  action: "update",
  raceFrom: "IN_PROGRESS",
  rival: "APPROVED",
  expectEffect: (row) => {
    // due_date is a calendar day.
    expect(row.dueDate?.toISOString().slice(0, 10)).toBe("2031-03-04");
  },
  changes: () => ({ dueDate: { old: null, new: DUE_DATE } }),
  entries: [
    {
      name: "cloud route",
      legal: allowedFrom("edit"),
      refusal: { status: 400, code: "job_not_editable" },
      raceCode: cloudConflict,
      ip: IP,
      channel: "session",
      async run(world, who) {
        login(who);
        return outcomeOf(
          await jobsRouter.request(`/${world.jobId}`, {
            method: "PUT",
            headers: { ...JSON_HEADERS, "x-forwarded-for": IP },
            body: JSON.stringify({ dueDate: DUE_DATE }),
          }),
        );
      },
    },
    {
      name: "public API",
      legal: allowedFrom("edit"),
      refusal: { status: 409, code: "job_not_editable" },
      raceCode: publicConflict,
      ip: IP,
      channel: "api_key",
      async run(world, who) {
        return outcomeOf(
          await publicApiV2Router.request(`/jobs/${world.jobId}`, {
            method: "PATCH",
            headers: apiKeyHeaders(world, who),
            body: JSON.stringify({ dueDate: DUE_DATE }),
          }),
        );
      },
    },
  ],
};

async function auditOf(jobId: number) {
  return db
    .select()
    .from(jobAuditLog)
    .where(
      and(
        eq(jobAuditLog.jobId, jobId),
        eq(
          jobAuditLog.organizationId,
          organizationOf("calibration_job", jobId),
        ),
      ),
    )
    .orderBy(asc(jobAuditLog.id));
}

describe.each([REJECT, CANCEL, ASSIGN, EDIT])(
  "$command: one policy through every entry point",
  (spec) => {
    beforeEach(async () => {
      await truncateAll();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      logout();
    });

    describe.each(spec.entries)("$name", (entry) => {
      it.each(STATUSES)(
        "REQ-LC-4a: from %s the transition table decides",
        async (status) => {
          const world = await seedWorld(status);
          const before = await jobRow(world.jobId);
          const target = targetOf(status, spec.table);

          const outcome = await entry.run(world, "member");

          if (entry.legal.includes(status)) {
            expect(outcome).toEqual({ ok: true });
            expect(target).not.toBeNull();
            const after = await jobRow(world.jobId);
            expect(after.status).toBe(target);
            spec.expectEffect(after);
            const audit = await auditOf(world.jobId);
            expect(audit.map((row) => row.action)).toEqual([spec.action]);
          } else {
            expect(outcome).toMatchObject({
              ok: false,
              status: entry.refusal.status,
              ...(entry.refusal.code ? { code: entry.refusal.code } : {}),
            });
            expect(await jobRow(world.jobId)).toEqual(before);
            expect(await auditOf(world.jobId)).toEqual([]);
          }
        },
      );

      it("REQ-LC-4b [HIGH RISK]: another organization's actor gets 404; nothing is written", async () => {
        const world = await seedWorld(spec.raceFrom);
        const before = await jobRow(world.jobId);

        const outcome = await entry.run(world, "foreign");

        expect(outcome).toMatchObject({ ok: false, status: 404 });
        expect(await jobRow(world.jobId)).toEqual(before);
        expect(await auditOf(world.jobId)).toEqual([]);
      });

      it(`REQ-LC-4c [HIGH RISK]: a job moved to ${spec.rival} between the read and the write -> 409 ${entry.raceCode}; the other actor's status stands; no audit row`, async () => {
        const world = await seedWorld(spec.raceFrom);
        changeJobBeforeNextTransaction(world.jobId, { status: spec.rival });
        const before = await jobRow(world.jobId);

        const outcome = await entry.run(world, "member");

        expect(outcome).toEqual({
          ok: false,
          status: 409,
          code: entry.raceCode,
        });
        const after = await jobRow(world.jobId);
        expect(after.status).toBe(spec.rival);
        expect({ ...after, status: undefined, updatedAt: undefined }).toEqual({
          ...before,
          status: undefined,
          updatedAt: undefined,
        });
        expect(await auditOf(world.jobId)).toEqual([]);
      });

      it("REQ-LC-4d: the audit row names the actor and how it got in", async () => {
        const world = await seedWorld(spec.raceFrom);
        const from = spec.raceFrom;
        const to = targetOf(from, spec.table);
        if (!to) throw new Error(`${spec.command} is illegal from ${from}`);

        expect(await entry.run(world, "member")).toEqual({ ok: true });

        const [audit, ...rest] = await auditOf(world.jobId);
        expect(rest).toEqual([]);
        expect(audit).toMatchObject({
          action: spec.action,
          performedBy: ADMIN,
          ipAddress: entry.ip,
          changes: spec.changes(from, to),
        });
        if (entry.channel === "api_key") {
          expect(audit?.changes).toMatchObject({
            source: "public_api",
            channel: "api_key",
            apiKeyId: KEY_ID,
            apiKeyName: KEY_NAME,
            apiKeyPrefix: world.keyPrefix,
          });
        } else {
          expect(audit?.changes).not.toHaveProperty("source");
          expect(audit?.changes).not.toHaveProperty("apiKeyId");
        }
      });
    });
  },
);

describe("assign refuses a job that is closed or being approved (Q19)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    logout();
  });

  it.each(["CANCELED", "GENERATING_PDF", "APPROVED", "SUPERSEDED"] as const)(
    "REQ-LC-3 [HIGH RISK]: POST /jobs/:id/assign on a %s job -> 400 job_not_assignable; no technician, no audit row",
    async (status) => {
      const world = await seedWorld(status);
      const before = await jobRow(world.jobId);

      loginAs({ userId: ADMIN, organizationId: ORG });
      const res = await jobsRouter.request(`/${world.jobId}/assign`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ technicianId: TECHNICIAN }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: "job_not_assignable",
        error: `Nao e possivel atribuir tecnico a um job com status ${status}`,
      });
      expect(await jobRow(world.jobId)).toEqual(before);
      expect(await auditOf(world.jobId)).toEqual([]);
    },
  );

  it.each(["DRAFT", "IN_PROGRESS", "REVIEW", "REJECTED"] as const)(
    "REQ-LC-3: POST /jobs/:id/assign on a %s job still works and keeps the status",
    async (status) => {
      const world = await seedWorld(status);

      loginAs({ userId: ADMIN, organizationId: ORG });
      const res = await jobsRouter.request(`/${world.jobId}/assign`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ technicianId: TECHNICIAN }),
      });

      expect(res.status).toBe(200);
      const row = await jobRow(world.jobId);
      expect(row.status).toBe(status);
      expect(row.technicianId).toBe(TECHNICIAN);
    },
  );
});

/**
 * Q25 / Q26: naming a technician is one policy. The cloud `PUT`, the public
 * `PATCH` and the cloud `assign` refuse the same people with the same code, and
 * all three run the §6.2.5 competence gate.
 */
type TechnicianEntry = {
  name: string;
  /** The status a competence refusal answers with on this transport. */
  competenceStatus: number;
  send: (world: World, technicianId: string) => Promise<Outcome>;
};

const TECHNICIAN_ENTRIES: TechnicianEntry[] = [
  {
    name: "cloud PUT /jobs/:id",
    competenceStatus: 400,
    async send(world, technicianId) {
      login("member");
      return outcomeOf(
        await jobsRouter.request(`/${world.jobId}`, {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ technicianId }),
        }),
      );
    },
  },
  {
    name: "public API PATCH /jobs/:id",
    competenceStatus: 422,
    async send(world, technicianId) {
      return outcomeOf(
        await publicApiV2Router.request(`/jobs/${world.jobId}`, {
          method: "PATCH",
          headers: apiKeyHeaders(world, "member"),
          body: JSON.stringify({ technicianId }),
        }),
      );
    },
  },
  {
    name: "cloud POST /jobs/:id/assign",
    competenceStatus: 400,
    async send(world, technicianId) {
      login("member");
      return outcomeOf(
        await jobsRouter.request(`/${world.jobId}/assign`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ technicianId }),
        }),
      );
    },
  },
];

describe.each(TECHNICIAN_ENTRIES)(
  "one technician rule and one competence gate: $name",
  (entry) => {
    beforeEach(async () => {
      await truncateAll();
    });

    afterEach(() => {
      logout();
    });

    async function seedCandidates() {
      const world = await seedWorld("IN_PROGRESS");
      // Holds a technician assignment in the job's unit: qualifies.
      await seedExtraMember({
        orgId: ORG,
        userId: "user-lcm-operator",
        role: "operator",
        unitId: world.org.unitId,
        unitRole: "technician",
      });
      // An org technician with no assignment in the job's unit: does not.
      await seedExtraMember({
        orgId: ORG,
        userId: "user-lcm-unassigned",
        role: "technician",
      });
      return world;
    }

    it.each(["user-lcm-unassigned", OTHER_ADMIN, "user-lcm-nobody"])(
      "REQ-LC-4e [HIGH RISK]: Q25, %s does not qualify -> 400 technician_not_found; nothing written",
      async (technicianId) => {
        const world = await seedCandidates();
        const before = await jobRow(world.jobId);

        const outcome = await entry.send(world, technicianId);

        expect(outcome).toEqual({
          ok: false,
          status: 400,
          code: "technician_not_found",
        });
        expect(await jobRow(world.jobId)).toEqual(before);
        expect(await auditOf(world.jobId)).toEqual([]);
      },
    );

    it("REQ-LC-4e: Q25, a member holding a technician assignment in the unit qualifies whatever their organization role", async () => {
      const world = await seedCandidates();

      expect(await entry.send(world, "user-lcm-operator")).toEqual({
        ok: true,
      });

      expect((await jobRow(world.jobId)).technicianId).toBe(
        "user-lcm-operator",
      );
    });

    it("REQ-LC-4e [HIGH RISK]: Q26, a technician without an active competence for the instrument type is refused (technician_competence_missing) once the organization keeps competence records; nothing written", async () => {
      const world = await seedCandidates();
      await requireCompetenceForJob({
        jobId: world.jobId,
        organizationId: ORG,
        competentUserId: TECHNICIAN,
        createdBy: ADMIN,
      });
      const before = await jobRow(world.jobId);

      const outcome = await entry.send(world, "user-lcm-operator");

      expect(outcome).toEqual({
        ok: false,
        status: entry.competenceStatus,
        code: "technician_competence_missing",
      });
      expect(await jobRow(world.jobId)).toEqual(before);
      expect(await auditOf(world.jobId)).toEqual([]);
    });

    it("REQ-LC-4e: Q26, the competent technician is accepted", async () => {
      const world = await seedCandidates();
      await requireCompetenceForJob({
        jobId: world.jobId,
        organizationId: ORG,
        competentUserId: TECHNICIAN,
        createdBy: ADMIN,
      });

      expect(await entry.send(world, TECHNICIAN)).toEqual({ ok: true });

      expect((await jobRow(world.jobId)).technicianId).toBe(TECHNICIAN);
    });
  },
);
