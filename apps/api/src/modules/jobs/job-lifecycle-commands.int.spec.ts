/**
 * job-lifecycle-commands.int.spec.ts: the reject / cancel / assign / edit /
 * amend commands, called directly against a real Postgres (no HTTP, no
 * middleware): each command's closed result union, its transition-table check,
 * the organization and unit scope of its read, the compare-and-set of its
 * write and the audit row it commits in the same transaction. The same rules
 * through every entry point are in job-lifecycle-entry-points.int.spec.ts.
 *
 *   REQ-LC-1a  rejectJob: REVIEW -> REJECTED, reason and rejector stored
 *   REQ-LC-1b  cancelJob: the cancelable statuses -> CANCELED
 *   REQ-LC-1c  assignJob: open statuses only (Q19), technician checked
 *   REQ-LC-1d  editJob: technician / due date, no-op writes nothing; the
 *              technician rule (Q25) and the competence gate (Q26) are
 *              assignJob's
 *   REQ-LC-1e  amendJob: APPROVED -> SUPERSEDED plus the DRAFT amendment
 *   REQ-LC-1f  every refusal writes nothing; a lost compare-and-set is
 *              `concurrent_update` with no audit row
 *   REQ-LC-1g  the audit row names the actor, and the key for an API key
 */

import { setJobStatus } from "../../../test/integration/job-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { organizationOf } from "../../../test/integration/organization-of";
import { db } from "@calibra-facil/db";
import { jobAuditLog, type JobStatus } from "@calibra-facil/db/schema";
import { JobStatusSchema } from "@calibra-facil/schemas";
import { allowedFrom } from "@calibra-facil/schemas/job-transitions";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";
import {
  seedExtraMember,
  seedJobForOrg,
} from "../../../test/integration/tenant-refs";
import {
  changeJobBeforeNextTransaction,
  failJobAuditInserts,
  jobRow,
} from "../../../test/integration/job-cas";
import { requireCompetenceForJob } from "../../../test/integration/job-competence";
import type { JobLifecycleActor } from "./job-actor";
import { amendJob } from "./amend-job";
import { assignJob } from "./assign-job";
import { cancelJob } from "./cancel-job";
import { editJob } from "./edit-job";
import { rejectJob } from "./reject-job";

vi.mock("../../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

const ORG = "org-lc";
const OTHER_ORG = "org-lc-other";
const USER = "user-lc-admin";
const STATUSES: readonly JobStatus[] = JobStatusSchema.options;

const user: JobLifecycleActor = {
  kind: "user",
  userId: USER,
  ipAddress: "203.0.113.7",
};
const apiKey: JobLifecycleActor = {
  kind: "api_key",
  userId: USER,
  apiKey: { id: "key-lc", name: "ERP", keyPrefix: "cf_live_ab12" },
  ipAddress: "198.51.100.9",
};

async function seedWorld(status: JobStatus) {
  const org = await seedOrg({ orgId: ORG, userId: USER, role: "admin" });
  const other = await seedOrg({
    orgId: OTHER_ORG,
    userId: "user-lc-other",
    role: "admin",
  });
  const { jobId } = await seedJobForOrg({
    orgId: ORG,
    unitId: org.unitId,
    createdBy: USER,
  });
  await setJobStatus(jobId, status);
  const technician = await seedExtraMember({
    orgId: ORG,
    userId: "user-lc-tech",
    role: "technician",
    unitId: org.unitId,
    unitRole: "technician",
  });
  return { org, other, jobId, technician };
}

async function auditRows(jobId: number) {
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
    .orderBy(jobAuditLog.id);
}

const COMMANDS = {
  reject: (jobId: number, organizationId = ORG) =>
    rejectJob({
      actor: user,
      jobId,
      organizationId,
      unitScope: null,
      reason: "Leitura inconsistente",
    }),
  cancel: (jobId: number, organizationId = ORG) =>
    cancelJob({
      actor: user,
      jobId,
      organizationId,
      unitScope: null,
      reason: "Cliente desistiu",
    }),
  assign: (jobId: number, organizationId = ORG) =>
    assignJob({
      actor: user,
      jobId,
      organizationId,
      unitScope: null,
      technicianId: "user-lc-tech",
    }),
  edit: (jobId: number, organizationId = ORG) =>
    editJob({
      actor: user,
      jobId,
      organizationId,
      unitScope: null,
      dueDate: "2031-03-04T12:00:00.000Z",
    }),
  amend: (jobId: number, organizationId = ORG) =>
    amendJob({
      actor: user,
      jobId,
      organizationId,
      unitScope: null,
      reason: "Erro de digitacao no certificado",
    }),
} as const;

type CommandName = keyof typeof COMMANDS;

/** The table command each lifecycle command runs under. */
const TABLE_COMMAND: Record<CommandName, Parameters<typeof allowedFrom>[0]> = {
  reject: "reject",
  cancel: "cancel",
  assign: "assign",
  edit: "edit",
  amend: "amend",
};

describe("job lifecycle commands (real Postgres)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each(Object.keys(COMMANDS).filter(isCommandName))("%s", (name) => {
    const legal = allowedFrom(TABLE_COMMAND[name]);
    const illegal = STATUSES.filter((status) => !legal.includes(status));

    it.each(illegal)(
      "REQ-LC-1f: from %s the command is refused by the transition table and writes nothing",
      async (status) => {
        const { jobId } = await seedWorld(status);
        const before = await jobRow(jobId);

        const result = await COMMANDS[name](jobId);

        expect(result.status).toBe("illegal_transition");
        expect(await jobRow(jobId)).toEqual(before);
        expect(await auditRows(jobId)).toEqual([]);
      },
    );

    it("REQ-LC-1f: a job of another organization is not_found and untouched", async () => {
      const { jobId } = await seedWorld(legal[0] ?? "DRAFT");
      const before = await jobRow(jobId);

      const result = await COMMANDS[name](jobId, OTHER_ORG);

      expect(result).toEqual({ status: "not_found" });
      expect(await jobRow(jobId)).toEqual(before);
      expect(await auditRows(jobId)).toEqual([]);
    });

    it("REQ-LC-1f: a job outside the caller's unit scope is not_found", async () => {
      const { jobId, org } = await seedWorld(legal[0] ?? "DRAFT");
      const command = {
        reject: () =>
          rejectJob({
            actor: user,
            jobId,
            organizationId: ORG,
            unitScope: scopedElsewhere(org.unitId),
            reason: "x",
          }),
        cancel: () =>
          cancelJob({
            actor: user,
            jobId,
            organizationId: ORG,
            unitScope: scopedElsewhere(org.unitId),
            reason: "x",
          }),
        assign: () =>
          assignJob({
            actor: user,
            jobId,
            organizationId: ORG,
            unitScope: scopedElsewhere(org.unitId),
            technicianId: "user-lc-tech",
          }),
        edit: () =>
          editJob({
            actor: user,
            jobId,
            organizationId: ORG,
            unitScope: scopedElsewhere(org.unitId),
            dueDate: "2031-03-04T12:00:00.000Z",
          }),
        amend: () =>
          amendJob({
            actor: user,
            jobId,
            organizationId: ORG,
            unitScope: scopedElsewhere(org.unitId),
            reason: "Erro de digitacao no certificado",
          }),
      }[name];

      expect(await command()).toEqual({ status: "not_found" });
      expect(await auditRows(jobId)).toEqual([]);
    });
  });

  describe("rejectJob", () => {
    it("REQ-LC-1a: REVIEW -> REJECTED with the reason and the rejector, one audit row", async () => {
      const { jobId } = await seedWorld("REVIEW");

      const result = await COMMANDS.reject(jobId);

      expect(result).toMatchObject({
        status: "ok",
        previousStatus: "REVIEW",
        job: {
          id: jobId,
          status: "REJECTED",
          rejectedBy: USER,
          rejectionReason: "Leitura inconsistente",
        },
      });
      const row = await jobRow(jobId);
      expect(row.status).toBe("REJECTED");
      expect(row.rejectedAt).toBeInstanceOf(Date);
      const [audit, ...rest] = await auditRows(jobId);
      expect(rest).toEqual([]);
      expect(audit).toMatchObject({
        action: "reject",
        performedBy: USER,
        ipAddress: "203.0.113.7",
        reason: "Leitura inconsistente",
        changes: { status: { old: "REVIEW", new: "REJECTED" } },
      });
    });

    it("REQ-LC-1f: an illegal reject maps to the job_not_rejectable DomainError (400)", async () => {
      const { jobId } = await seedWorld("IN_PROGRESS");

      const result = await COMMANDS.reject(jobId);

      expect(result).toMatchObject({
        status: "illegal_transition",
        currentStatus: "IN_PROGRESS",
        error: { code: "job_not_rejectable", status: 400 },
      });
    });

    it("REQ-LC-1f [HIGH RISK]: a job approved between the read and the write is concurrent_update; nothing written, no audit row", async () => {
      const { jobId } = await seedWorld("REVIEW");
      changeJobBeforeNextTransaction(jobId, { status: "GENERATING_PDF" });

      const result = await COMMANDS.reject(jobId);

      expect(result).toEqual({ status: "concurrent_update" });
      const row = await jobRow(jobId);
      expect(row.status).toBe("GENERATING_PDF");
      expect(row.rejectedBy).toBeNull();
      expect(await auditRows(jobId)).toEqual([]);
    });

    it("REQ-LC-1g: an API key actor is recorded with the key's identity", async () => {
      const { jobId } = await seedWorld("REVIEW");

      await rejectJob({
        actor: apiKey,
        jobId,
        organizationId: ORG,
        unitScope: null,
        reason: "Rejeitada pelo ERP",
      });

      const [audit] = await auditRows(jobId);
      expect(audit).toMatchObject({
        action: "reject",
        performedBy: USER,
        ipAddress: "198.51.100.9",
        changes: {
          status: { old: "REVIEW", new: "REJECTED" },
          source: "public_api",
          channel: "api_key",
          apiKeyId: "key-lc",
          apiKeyName: "ERP",
          apiKeyPrefix: "cf_live_ab12",
        },
      });
      expect((await jobRow(jobId)).rejectedBy).toBe(USER);
    });

    it("REQ-LC-1f: when the audit insert fails the status write rolls back with it", async () => {
      const { jobId } = await seedWorld("REVIEW");
      const before = await jobRow(jobId);
      const restore = await failJobAuditInserts();
      try {
        await expect(COMMANDS.reject(jobId)).rejects.toThrow();
      } finally {
        await restore();
      }
      expect(await jobRow(jobId)).toEqual(before);
    });
  });

  describe("cancelJob", () => {
    it.each(allowedFrom("cancel"))(
      "REQ-LC-1b: %s -> CANCELED, one audit row with the reason",
      async (status) => {
        const { jobId } = await seedWorld(status);

        const result = await COMMANDS.cancel(jobId);

        expect(result).toMatchObject({
          status: "ok",
          previousStatus: status,
          job: { status: "CANCELED" },
        });
        const [audit, ...rest] = await auditRows(jobId);
        expect(rest).toEqual([]);
        expect(audit).toMatchObject({
          action: "cancel",
          performedBy: USER,
          reason: "Cliente desistiu",
          changes: { status: { old: status, new: "CANCELED" } },
        });
      },
    );

    it("REQ-LC-1f: APPROVED, CANCELED and the rest map to job_not_cancelable with their own message", async () => {
      const approved = await seedWorld("APPROVED");
      expect(await COMMANDS.cancel(approved.jobId)).toMatchObject({
        status: "illegal_transition",
        currentStatus: "APPROVED",
        error: {
          code: "job_not_cancelable",
          status: 400,
          message:
            "Nao e possivel cancelar um job aprovado. Jobs aprovados sao imutaveis para conformidade ISO 17025.",
        },
      });

      await truncateAll();
      const canceled = await seedWorld("CANCELED");
      expect(await COMMANDS.cancel(canceled.jobId)).toMatchObject({
        status: "illegal_transition",
        error: { code: "job_not_cancelable", message: "Job ja foi cancelado" },
      });

      await truncateAll();
      const generating = await seedWorld("GENERATING_PDF");
      expect(await COMMANDS.cancel(generating.jobId)).toMatchObject({
        status: "illegal_transition",
        error: {
          code: "job_not_cancelable",
          message: "Nao e possivel cancelar um job com status GENERATING_PDF.",
        },
      });
    });

    it("REQ-LC-1f [HIGH RISK]: a job moved between the read and the write is concurrent_update; no audit row", async () => {
      const { jobId } = await seedWorld("DRAFT");
      changeJobBeforeNextTransaction(jobId, { status: "APPROVED" });

      const result = await COMMANDS.cancel(jobId);

      expect(result).toEqual({ status: "concurrent_update" });
      expect((await jobRow(jobId)).status).toBe("APPROVED");
      expect(await auditRows(jobId)).toEqual([]);
    });

    it("REQ-LC-1f: expectedStatus pins the status the caller validated; a job that moved to another cancelable status is concurrent_update", async () => {
      const { jobId } = await seedWorld("IN_PROGRESS");

      const result = await cancelJob({
        actor: user,
        jobId,
        organizationId: ORG,
        unitScope: null,
        reason: "Instrumento removido da visita #1",
        expectedStatus: "DRAFT",
      });

      expect(result).toEqual({ status: "concurrent_update" });
      expect((await jobRow(jobId)).status).toBe("IN_PROGRESS");
      expect(await auditRows(jobId)).toEqual([]);
    });

    it("REQ-LC-1g: an API key actor is recorded with the key's identity", async () => {
      const { jobId } = await seedWorld("DRAFT");

      await cancelJob({
        actor: apiKey,
        jobId,
        organizationId: ORG,
        unitScope: null,
        reason: "Cancelada pelo ERP",
      });

      const [audit] = await auditRows(jobId);
      expect(audit).toMatchObject({
        action: "cancel",
        performedBy: USER,
        changes: {
          source: "public_api",
          channel: "api_key",
          apiKeyId: "key-lc",
        },
      });
    });
  });

  describe("assignJob", () => {
    it.each(allowedFrom("assign"))(
      "REQ-LC-1c: %s keeps its status and takes the technician, one audit row with the name",
      async (status) => {
        const { jobId, technician } = await seedWorld(status);

        const result = await COMMANDS.assign(jobId);

        expect(result).toMatchObject({
          status: "ok",
          technicianName: "User user-lc-tech",
          job: { status, technicianId: technician.userId },
        });
        const [audit, ...rest] = await auditRows(jobId);
        expect(rest).toEqual([]);
        expect(audit).toMatchObject({
          action: "assign",
          performedBy: USER,
          changes: {
            technicianId: { old: null, new: technician.userId },
            technicianName: { old: null, new: "User user-lc-tech" },
          },
        });
      },
    );

    it.each(["CANCELED", "GENERATING_PDF", "APPROVED", "SUPERSEDED"] as const)(
      "REQ-LC-3 [HIGH RISK]: Q19, a %s job takes no technician: job_not_assignable (400), nothing written",
      async (status) => {
        const { jobId } = await seedWorld(status);
        const before = await jobRow(jobId);

        const result = await COMMANDS.assign(jobId);

        expect(result).toMatchObject({
          status: "illegal_transition",
          currentStatus: status,
          error: {
            code: "job_not_assignable",
            status: 400,
            message: `Nao e possivel atribuir tecnico a um job com status ${status}`,
          },
        });
        expect(await jobRow(jobId)).toEqual(before);
        expect(await auditRows(jobId)).toEqual([]);
      },
    );

    it("REQ-LC-1c: a user who is not a member of the organization is technician_not_found (400)", async () => {
      const { jobId } = await seedWorld("DRAFT");

      const result = await assignJob({
        actor: user,
        jobId,
        organizationId: ORG,
        unitScope: null,
        technicianId: "user-lc-other",
      });

      expect(result).toMatchObject({
        status: "technician_not_found",
        error: {
          code: "technician_not_found",
          status: 400,
          message: "Tecnico nao encontrado ou sem permissao",
        },
      });
      expect((await jobRow(jobId)).technicianId).toBeNull();
    });

    it("REQ-LC-1c: a member without an assignment in the job's unit is technician_not_found", async () => {
      const { jobId } = await seedWorld("DRAFT");
      await seedExtraMember({
        orgId: ORG,
        userId: "user-lc-unassigned",
        role: "technician",
      });

      const result = await assignJob({
        actor: user,
        jobId,
        organizationId: ORG,
        unitScope: null,
        technicianId: "user-lc-unassigned",
      });

      expect(result.status).toBe("technician_not_found");
    });

    it("REQ-LC-1f [HIGH RISK]: a job approved between the read and the write is concurrent_update; no technician, no audit row", async () => {
      const { jobId } = await seedWorld("DRAFT");
      changeJobBeforeNextTransaction(jobId, { status: "APPROVED" });

      const result = await COMMANDS.assign(jobId);

      expect(result).toEqual({ status: "concurrent_update" });
      expect((await jobRow(jobId)).technicianId).toBeNull();
      expect(await auditRows(jobId)).toEqual([]);
    });
  });

  describe("editJob", () => {
    it.each(allowedFrom("edit"))(
      "REQ-LC-1d: %s keeps its status and takes the new due date, one audit row with the field diff",
      async (status) => {
        const { jobId } = await seedWorld(status);

        const result = await COMMANDS.edit(jobId);

        expect(result).toMatchObject({
          status: "ok",
          changed: { technician: false, dueDate: true },
          job: { status },
        });
        // due_date is a calendar day; the audit keeps the instant that was sent.
        expect((await jobRow(jobId)).dueDate?.toISOString().slice(0, 10)).toBe(
          "2031-03-04",
        );
        const [audit, ...rest] = await auditRows(jobId);
        expect(rest).toEqual([]);
        expect(audit).toMatchObject({
          action: "update",
          performedBy: USER,
          changes: {
            dueDate: { old: null, new: "2031-03-04T12:00:00.000Z" },
          },
        });
      },
    );

    it("REQ-LC-1d: an edit that changes nothing writes no row and no audit", async () => {
      const { jobId } = await seedWorld("DRAFT");
      const before = await jobRow(jobId);

      const result = await editJob({
        actor: user,
        jobId,
        organizationId: ORG,
        unitScope: null,
        technicianId: before.technicianId,
      });

      expect(result).toMatchObject({
        status: "ok",
        changed: { technician: false, dueDate: false },
      });
      expect(await jobRow(jobId)).toEqual(before);
      expect(await auditRows(jobId)).toEqual([]);
    });

    it("REQ-LC-1d: the same calendar day typed at another hour is not a change", async () => {
      const { jobId } = await seedWorld("DRAFT");
      await COMMANDS.edit(jobId);

      const result = await editJob({
        actor: user,
        jobId,
        organizationId: ORG,
        unitScope: null,
        dueDate: "2031-03-04T18:30:00.000Z",
      });

      expect(result).toMatchObject({
        status: "ok",
        changed: { dueDate: false },
      });
      expect(await auditRows(jobId)).toHaveLength(1);
    });

    it("REQ-LC-1d: a technician change is validated and audited; an unknown one is technician_not_found", async () => {
      const { jobId, technician } = await seedWorld("IN_PROGRESS");

      const refused = await editJob({
        actor: user,
        jobId,
        organizationId: ORG,
        unitScope: null,
        technicianId: "user-lc-other",
      });
      expect(refused).toMatchObject({
        status: "technician_not_found",
        error: { code: "technician_not_found", status: 400 },
      });
      expect(await auditRows(jobId)).toEqual([]);

      const accepted = await editJob({
        actor: user,
        jobId,
        organizationId: ORG,
        unitScope: null,
        technicianId: technician.userId,
      });
      expect(accepted).toMatchObject({
        status: "ok",
        changed: { technician: true, dueDate: false },
      });
      const [audit] = await auditRows(jobId);
      expect(audit?.changes).toMatchObject({
        technicianId: { old: null, new: technician.userId },
      });
    });

    it("REQ-LC-1d: Q25, edit and assign take the same technician rule (an org member with a unit assignment, or an admin or owner)", async () => {
      const { jobId, org } = await seedWorld("DRAFT");
      // An `operator` with a technician assignment in the unit qualifies, as it
      // always did for assign and the public API.
      await seedExtraMember({
        orgId: ORG,
        userId: "user-lc-operator",
        role: "operator",
        unitId: org.unitId,
        unitRole: "technician",
      });
      // A technician with no assignment in the job's unit does not.
      await seedExtraMember({
        orgId: ORG,
        userId: "user-lc-unassigned",
        role: "technician",
      });

      for (const technicianId of ["user-lc-unassigned", "user-lc-other"]) {
        // eslint-disable-next-line no-await-in-loop -- sequential, same job
        const viaEdit = await editJob({
          actor: user,
          jobId,
          organizationId: ORG,
          unitScope: null,
          technicianId,
        });
        // eslint-disable-next-line no-await-in-loop -- sequential, same job
        const viaAssign = await assignJob({
          actor: user,
          jobId,
          organizationId: ORG,
          unitScope: null,
          technicianId,
        });
        expect(viaEdit).toMatchObject({
          status: "technician_not_found",
          error: { code: "technician_not_found" },
        });
        expect(viaAssign).toMatchObject({
          status: "technician_not_found",
          error: { code: "technician_not_found" },
        });
      }
      expect(await auditRows(jobId)).toEqual([]);

      const accepted = await editJob({
        actor: user,
        jobId,
        organizationId: ORG,
        unitScope: null,
        technicianId: "user-lc-operator",
      });
      expect(accepted.status).toBe("ok");
    });

    it("REQ-LC-1d: Q26, edit and assign run the same competence gate once the organization keeps competence records", async () => {
      const { jobId, technician } = await seedWorld("DRAFT");
      await seedExtraMember({
        orgId: ORG,
        userId: "user-lc-competent",
        role: "technician",
        unitId: (await jobRow(jobId)).unitId ?? undefined,
        unitRole: "technician",
      });
      await requireCompetenceForJob({
        jobId,
        organizationId: ORG,
        competentUserId: "user-lc-competent",
        createdBy: USER,
      });

      const viaEdit = await editJob({
        actor: user,
        jobId,
        organizationId: ORG,
        unitScope: null,
        technicianId: technician.userId,
      });
      const viaAssign = await assignJob({
        actor: user,
        jobId,
        organizationId: ORG,
        unitScope: null,
        technicianId: technician.userId,
      });
      for (const result of [viaEdit, viaAssign]) {
        expect(result).toMatchObject({
          status: "competence_missing",
          error: {
            code: "technician_competence_missing",
            status: 400,
            message:
              "Técnico não possui competência ativa para este tipo de instrumento",
          },
        });
      }
      expect((await jobRow(jobId)).technicianId).toBeNull();
      expect(await auditRows(jobId)).toEqual([]);

      // The competent technician passes both.
      expect(
        (
          await editJob({
            actor: user,
            jobId,
            organizationId: ORG,
            unitScope: null,
            technicianId: "user-lc-competent",
          })
        ).status,
      ).toBe("ok");
      expect(
        (
          await assignJob({
            actor: user,
            jobId,
            organizationId: ORG,
            unitScope: null,
            technicianId: "user-lc-competent",
          })
        ).status,
      ).toBe("ok");
    });

    it("REQ-LC-1d: Q26, an edit that does not change the technician does not run the gate", async () => {
      const { jobId } = await seedWorld("DRAFT");
      await seedExtraMember({
        orgId: ORG,
        userId: "user-lc-competent",
        role: "technician",
      });
      await requireCompetenceForJob({
        jobId,
        organizationId: ORG,
        competentUserId: "user-lc-competent",
        createdBy: USER,
      });

      const result = await COMMANDS.edit(jobId);

      expect(result).toMatchObject({
        status: "ok",
        changed: { dueDate: true },
      });
    });

    it("REQ-LC-1f [HIGH RISK]: a job approved between the read and the write is concurrent_update; no audit row", async () => {
      const { jobId } = await seedWorld("IN_PROGRESS");
      changeJobBeforeNextTransaction(jobId, { status: "APPROVED" });

      const result = await COMMANDS.edit(jobId);

      expect(result).toEqual({ status: "concurrent_update" });
      expect((await jobRow(jobId)).dueDate).toBeNull();
      expect(await auditRows(jobId)).toEqual([]);
    });

    it("REQ-LC-1g: an API key actor is recorded with the key's identity", async () => {
      const { jobId } = await seedWorld("DRAFT");

      await editJob({
        actor: apiKey,
        jobId,
        organizationId: ORG,
        unitScope: null,
        dueDate: "2031-03-04T12:00:00.000Z",
      });

      const [audit] = await auditRows(jobId);
      expect(audit).toMatchObject({
        action: "update",
        performedBy: USER,
        changes: {
          source: "public_api",
          channel: "api_key",
          apiKeyId: "key-lc",
          apiKeyName: "ERP",
          apiKeyPrefix: "cf_live_ab12",
        },
      });
    });
  });

  describe("amendJob", () => {
    it("REQ-LC-1e: a DRAFT amendment is opened, the original stays APPROVED, both audited", async () => {
      const { jobId } = await seedWorld("APPROVED");

      const result = await COMMANDS.amend(jobId);

      if (result.status !== "ok") throw new Error(result.status);
      expect(result.amendmentNumber).toBe(1);
      expect(result.originalJob.id).toBe(jobId);
      expect(result.amendedJob).toMatchObject({
        status: "DRAFT",
        supersedesId: jobId,
        amendmentReason: "Erro de digitacao no certificado",
      });
      const original = await jobRow(jobId);
      // The original is superseded only when the replacement is issued.
      expect(original).toMatchObject({
        status: "APPROVED",
        supersededById: null,
        supersededAt: null,
      });
      expect((await auditRows(jobId)).map((row) => row.action)).toEqual([
        "amendment_started",
      ]);
      expect(
        (await auditRows(result.amendedJob.id)).map((row) => row.action),
      ).toEqual(["create_amendment"]);
    });

    it("REQ-LC-1f: an already amended certificate is job_already_amended with the successor", async () => {
      // An approved job is frozen: it is linked to its successor on the way in.
      const { jobId } = await seedWorld("DRAFT");
      await setJobStatus(jobId, "APPROVED", { supersededById: jobId });

      const result = await COMMANDS.amend(jobId);

      expect(result).toMatchObject({
        status: "already_amended",
        supersededById: jobId,
        error: { code: "job_already_amended", status: 400 },
      });
    });
  });
});

function isCommandName(value: string): value is CommandName {
  return value in COMMANDS;
}

/** A unit scope that does not include the job's unit. */
function scopedElsewhere(unitId: number) {
  return {
    selectedUnitScope: "unit" as const,
    activeUnitId: unitId + 1000,
    accessibleUnitIds: [unitId + 1000],
  };
}
