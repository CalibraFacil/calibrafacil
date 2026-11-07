import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  nonConformance,
  nonConformanceAuditLog,
  correctiveAction,
  calibrationJob,
  ootImpactAssessment,
  ootNotification,
  user,
} from "@calibra-facil/db/schema";
import {
  CreateNonConformanceSchema,
  SetDispositionSchema,
  ResolveNonConformanceSchema,
  EscalateToCapaSchema,
  ListNonConformancesQuerySchema,
  RegisterOotAcknowledgementSchema,
  SaveOotImpactAssessmentSchema,
} from "@calibra-facil/schemas";
import {
  notifyNCEscalatedToCapa,
  notifyOotAcknowledged,
} from "@calibra-facil/notifications";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import {
  createNonConformanceRecord,
  requireLabNonConformance,
} from "../lib/non-conformances";
import { createCorrectiveActionRecord } from "../lib/corrective-actions";
import { userIsOrganizationMember } from "../lib/tenant-refs";
import { orgDb } from "../lib/org-db";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { conflict, forbidden, invalid, notFound } from "../lib/domain-errors";
import { withOrg } from "../lib/org-context";
import { requestActor } from "../middleware/request-actor";
import {
  NON_CONFORMANCE_MACHINE,
  OOT_NOTIFICATION_MACHINE,
} from "@calibra-facil/schemas/machines";

/**
 * Non-Conformance Router - ISO 17025:2017 Clause 8.7 (Control of Nonconforming Work)
 *
 * Tracks nonconforming work, equipment issues, and documentation errors.
 * Supports disposition workflow and escalation to CAPA.
 *
 * Permissions:
 * - GET /: non_conformance:read (all roles)
 * - GET /:id: non_conformance:read (all roles)
 * - POST /: non_conformance:create (technician, admin, owner)
 * - PUT /:id/disposition: non_conformance:update (technician for rework/scrap, admin/owner for use_as_is/concession)
 * - POST /:id/resolve: non_conformance:update (technician, admin, owner)
 * - POST /:id/escalate-to-capa: non_conformance:escalate (admin, owner)
 * - GET /:id/audit-log: non_conformance:read (all roles)
 */
export const nonConformancesRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET / - List non-conformances with pagination and filtering
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ non_conformance: ["read"] }),
    zValidator("query", ListNonConformancesQuerySchema),
    async (c) => {
      return orgDb(c.get("member").organizationId).transaction(async (o) => {
        const member = c.get("member");
        const { page, limit, query, status, type, jobId, dateFrom, dateTo } =
          c.req.valid("query");
        const offset = (page - 1) * limit;

        const conditions = [
          eq(nonConformance.organizationId, member.organizationId),
        ];

        if (query) {
          conditions.push(
            or(
              ilike(nonConformance.ncNumber, `%${query}%`),
              ilike(nonConformance.description, `%${query}%`),
            )!,
          );
        }

        if (status) {
          conditions.push(eq(nonConformance.status, status));
        }

        if (type) {
          conditions.push(eq(nonConformance.type, type));
        }

        if (jobId) {
          conditions.push(eq(nonConformance.jobId, jobId));
        }

        if (dateFrom) {
          conditions.push(gte(nonConformance.detectedAt, new Date(dateFrom)));
        }

        if (dateTo) {
          conditions.push(lte(nonConformance.detectedAt, new Date(dateTo)));
        }

        const whereCondition = and(...conditions);

        // Get total count
        const [countResult] = await o
          .select({ total: count() })
          .from(nonConformance)
          .where(whereCondition);

        // Get paginated data with detector user name
        const ncs = await o
          .select({
            id: nonConformance.id,
            ncNumber: nonConformance.ncNumber,
            jobId: nonConformance.jobId,
            type: nonConformance.type,
            description: nonConformance.description,
            detectedBy: nonConformance.detectedBy,
            detectedAt: nonConformance.detectedAt,
            disposition: nonConformance.disposition,
            dispositionJustification: nonConformance.dispositionJustification,
            dispositionApprovedBy: nonConformance.dispositionApprovedBy,
            dispositionApprovedAt: nonConformance.dispositionApprovedAt,
            correctionTaken: nonConformance.correctionTaken,
            resolvedAt: nonConformance.resolvedAt,
            resolvedBy: nonConformance.resolvedBy,
            status: nonConformance.status,
            capaId: nonConformance.capaId,
            createdAt: nonConformance.createdAt,
            updatedAt: nonConformance.updatedAt,
            detectedByName: user.name,
          })
          .from(nonConformance)
          .leftJoin(user, eq(nonConformance.detectedBy, user.id))
          .where(whereCondition)
          .orderBy(desc(nonConformance.detectedAt))
          .limit(limit)
          .offset(offset);

        // Add computed field: age in days
        const now = new Date();
        const ncsWithAge = ncs.map((nc) => ({
          ...nc,
          ageDays: Math.ceil(
            (now.getTime() - nc.detectedAt.getTime()) / (1000 * 60 * 60 * 24),
          ),
        }));

        return c.json({
          data: ncsWithAge,
          pagination: {
            page,
            limit,
            total: countResult?.total ?? 0,
            totalPages: Math.ceil((countResult?.total ?? 0) / limit),
          },
        });
      });
    },
  )

  // =========================================================================
  // GET /summary - Dashboard summary of open NCs by type and age
  // =========================================================================
  .get(
    "/summary",
    ...withLabPermission({ non_conformance: ["read"] }),
    async (c) => {
      return orgDb(c.get("member").organizationId).transaction(async (o) => {
        const member = c.get("member");
        const orgId = member.organizationId;

        // Count by status
        const statusCounts = await o
          .select({
            status: nonConformance.status,
            count: count(),
          })
          .from(nonConformance)
          .where(eq(nonConformance.organizationId, orgId))
          .groupBy(nonConformance.status);

        // Count open NCs by type
        const typeCounts = await o
          .select({
            type: nonConformance.type,
            count: count(),
          })
          .from(nonConformance)
          .where(
            and(
              eq(nonConformance.organizationId, orgId),
              eq(nonConformance.status, "open"),
            ),
          )
          .groupBy(nonConformance.type);

        // Count by age brackets (open NCs only)
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(
          now.getTime() - 30 * 24 * 60 * 60 * 1000,
        );

        const [recentCount] = await o
          .select({ count: count() })
          .from(nonConformance)
          .where(
            and(
              eq(nonConformance.organizationId, orgId),
              eq(nonConformance.status, "open"),
              gte(nonConformance.detectedAt, sevenDaysAgo),
            ),
          );

        const [overdueLongCount] = await o
          .select({ count: count() })
          .from(nonConformance)
          .where(
            and(
              eq(nonConformance.organizationId, orgId),
              eq(nonConformance.status, "open"),
              lte(nonConformance.detectedAt, thirtyDaysAgo),
            ),
          );

        return c.json({
          byStatus: statusCounts,
          byType: typeCounts,
          ageBrackets: {
            lessThan7Days: recentCount?.count ?? 0,
            moreThan30Days: overdueLongCount?.count ?? 0,
          },
        });
      });
    },
  )

  // =========================================================================
  // GET /:id/label - Get NC label by ID
  // =========================================================================
  .get(
    "/:id/label",
    ...withLabPermission({ non_conformance: ["read"] }),
    async (c) => {
      return orgDb(c.get("member").organizationId).transaction(async (o) => {
        const nc = await requireLabNonConformance(o, c.req.param("id"));
        return c.json({ id: nc.id, label: nc.ncNumber });
      });
    },
  )

  // =========================================================================
  // GET /:id - Get single NC by ID
  // =========================================================================
  .get(
    "/:id",
    ...withLabPermission({ non_conformance: ["read"] }),
    async (c) => {
      return orgDb(c.get("member").organizationId).transaction(async (o) => {
        const member = c.get("member");
        const nc = await requireLabNonConformance(o, c.req.param("id"));

        // Get related CAPA if exists
        let capa = null;
        if (nc.capaId) {
          const [capaResult] = await o
            .select()
            .from(correctiveAction)
            .where(
              and(
                eq(correctiveAction.id, nc.capaId),
                eq(correctiveAction.organizationId, member.organizationId),
              ),
            )
            .limit(1);
          capa = capaResult ?? null;
        }

        // Get related job info if exists (scoped to org for defense-in-depth)
        let job = null;
        if (nc.jobId) {
          const [jobResult] = await o
            .select({
              id: calibrationJob.id,
              jobId: calibrationJob.jobId,
              status: calibrationJob.status,
            })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.id, nc.jobId),
                eq(calibrationJob.organizationId, member.organizationId),
              ),
            )
            .limit(1);
          job = jobResult ?? null;
        }

        // Get user names
        const [detectedByUser] = await o
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, nc.detectedBy))
          .limit(1);

        let dispositionApproverName = null;
        if (nc.dispositionApprovedBy) {
          const [approver] = await o
            .select({ name: user.name })
            .from(user)
            .where(eq(user.id, nc.dispositionApprovedBy))
            .limit(1);
          dispositionApproverName = approver?.name ?? null;
        }

        let resolverName = null;
        if (nc.resolvedBy) {
          const [resolver] = await o
            .select({ name: user.name })
            .from(user)
            .where(eq(user.id, nc.resolvedBy))
            .limit(1);
          resolverName = resolver?.name ?? null;
        }

        const now = new Date();

        return c.json({
          ...nc,
          detectedByName: detectedByUser?.name ?? null,
          dispositionApproverName,
          resolverName,
          capa,
          job,
          ageDays: Math.ceil(
            (now.getTime() - nc.detectedAt.getTime()) / (1000 * 60 * 60 * 24),
          ),
        });
      });
    },
  )

  // =========================================================================
  // POST / - Create new non-conformance
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ non_conformance: ["create"] }),
    zValidator("json", CreateNonConformanceSchema),
    async (c) => {
      const input = c.req.valid("json");
      const org = c.get("member").organizationId;

      const newNc = await withOrg(org, requestActor(c), async (ctx) => {
        // If jobId provided, verify it belongs to the organization
        if (input.jobId) {
          const [job] = await ctx.o
            .select({ id: calibrationJob.id })
            .from(calibrationJob)
            .where(
              and(
                eq(calibrationJob.id, input.jobId),
                eq(calibrationJob.organizationId, org),
              ),
            )
            .limit(1);

          if (!job) {
            throw notFound("job_not_found", "Ordem de servico nao encontrada");
          }
        }

        // Shared creator: NC number sequence + audit log + admin/owner
        // notification (also used by the OOT flag flow and the desktop sync
        // ingest, so all entry points stay identical).
        return createNonConformanceRecord(
          {
            type: input.type,
            description: input.description,
            detectedAt: new Date(input.detectedAt),
            jobId: input.jobId ?? null,
            triggerSource: "manual",
            auditChanges: { initial: input },
          },
          ctx,
        );
      });

      return c.json(newNc, 201);
    },
  )

  // =========================================================================
  // PUT /:id/disposition - Set disposition on an NC
  // =========================================================================
  .put(
    "/:id/disposition",
    ...withLabPermission({ non_conformance: ["update"] }),
    zValidator("json", SetDispositionSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const existing = await requireLabNonConformance(
            ctx.o,
            c.req.param("id"),
          );
          const id = existing.id;

          if (
            !NON_CONFORMANCE_MACHINE.canTransition(
              existing.status,
              "set_disposition",
            )
          ) {
            throw invalid(
              "invalid_request",
              "Nao conformidade ja foi resolvida",
            );
          }

          // For "use_as_is" and "concession", require admin/owner role
          const requiresApproval =
            input.disposition === "use_as_is" ||
            input.disposition === "concession";

          if (
            requiresApproval &&
            member.role !== "admin" &&
            member.role !== "owner"
          ) {
            throw forbidden(
              "forbidden",
              "Disposicao 'uso como esta' ou 'concessao' requer aprovacao do gerente tecnico",
            );
          }

          // Update NC
          const updateData: Record<string, unknown> = {
            disposition: input.disposition,
            dispositionJustification: input.justification || null,
            status: NON_CONFORMANCE_MACHINE.requireTargetOf(
              existing.status,
              "set_disposition",
            ),
          };

          // If requires approval and user is admin/owner, auto-approve
          if (requiresApproval) {
            updateData.dispositionApprovedBy = session.user.id;
            updateData.dispositionApprovedAt = new Date();
          }

          const [row] = await ctx.o
            .update(nonConformance)
            .set(updateData)
            // Defense-in-depth (SEC-08): repeat the tenant scope proven by the SELECT
            // above so the UPDATE stays org-scoped even if the guarding read is
            // refactored away. Reuses the in-scope member.organizationId.
            .where(
              and(
                eq(nonConformance.id, id),
                eq(nonConformance.organizationId, member.organizationId),
                eq(nonConformance.status, existing.status),
              ),
            )
            .returning();
          if (!row) {
            throw conflict(
              "status_transition_conflict",
              "A nao conformidade mudou de status durante a operacao. Recarregue e tente novamente.",
            );
          }

          await ctx.audit("nonConformance", id, {
            action: "disposition",
            changes: {
              disposition: {
                old: existing.disposition,
                new: input.disposition,
              },
              justification: {
                old: existing.dispositionJustification,
                new: input.justification || null,
              },
            },
            reason: input.justification || null,
          });

          return row;
        },
      );

      return c.json(updated);
    },
  )

  // =========================================================================
  // POST /:id/resolve - Resolve/close an NC
  // =========================================================================
  .post(
    "/:id/resolve",
    ...withLabPermission({ non_conformance: ["update"] }),
    zValidator("json", ResolveNonConformanceSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const existing = await requireLabNonConformance(
            ctx.o,
            c.req.param("id"),
          );
          const id = existing.id;

          if (
            !NON_CONFORMANCE_MACHINE.canTransition(existing.status, "resolve")
          ) {
            throw invalid(
              "invalid_request",
              "Nao conformidade ja foi resolvida",
            );
          }

          if (!existing.disposition) {
            throw invalid(
              "invalid_request",
              "Defina a disposicao antes de resolver a nao conformidade",
            );
          }

          const [row] = await ctx.o
            .update(nonConformance)
            .set({
              correctionTaken: input.correctionTaken,
              resolvedAt: new Date(),
              resolvedBy: session.user.id,
              status: NON_CONFORMANCE_MACHINE.requireTargetOf(
                existing.status,
                "resolve",
              ),
            })
            // Defense-in-depth (SEC-08): repeat the tenant scope proven by the SELECT
            // above so the UPDATE stays org-scoped even if the guarding read is
            // refactored away. Reuses the in-scope member.organizationId.
            .where(
              and(
                eq(nonConformance.id, id),
                eq(nonConformance.organizationId, member.organizationId),
                eq(nonConformance.status, existing.status),
              ),
            )
            .returning();
          if (!row) {
            // The compare-and-set on the status matched no row: the record moved
            // under the caller.
            throw conflict(
              "status_transition_conflict",
              "A nao conformidade mudou de status durante a operacao. Recarregue e tente novamente.",
            );
          }

          await ctx.audit("nonConformance", id, {
            action: "resolve",
            changes: {
              status: { old: existing.status, new: "resolved" },
              correctionTaken: {
                old: existing.correctionTaken,
                new: input.correctionTaken,
              },
            },
          });

          return row;
        },
      );

      return c.json({
        message: "Nao conformidade resolvida com sucesso",
        data: updated,
      });
    },
  )

  // =========================================================================
  // POST /:id/escalate-to-capa - Create CAPA from NC
  // =========================================================================
  .post(
    "/:id/escalate-to-capa",
    ...withLabPermission({ non_conformance: ["escalate"] }),
    zValidator("json", EscalateToCapaSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const escalated = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const existing = await requireLabNonConformance(
            ctx.o,
            c.req.param("id"),
          );
          const id = existing.id;

          if (existing.capaId) {
            throw invalid(
              "invalid_request",
              "Nao conformidade ja possui CAPA vinculada",
            );
          }

          if (
            input.responsibleId &&
            !(await userIsOrganizationMember(
              member.organizationId,
              input.responsibleId,
              ctx.o,
            ))
          ) {
            throw invalid(
              "invalid_request",
              "Responsavel nao encontrado ou nao pertence a organizacao",
            );
          }

          const newCapa = await createCorrectiveActionRecord(
            {
              organizationId: member.organizationId,
              actorUserId: session.user.id,
              title: `CAPA originada da ${existing.ncNumber}`,
              description: existing.description,
              source: "nc_detection",
              // #426 Phase 2: OOT provenance — assessors can trace a CAPA
              // back to the out-of-tolerance event (and its trigger) from
              // the reference alone.
              sourceReference:
                existing.type === "out_of_tolerance"
                  ? `${existing.ncNumber} (fora de tolerância${
                      existing.triggerSource === "standard_recall"
                        ? " — recall de padrão"
                        : ""
                    })`
                  : existing.ncNumber,
              detectionDate: existing.detectedAt,
              rootCauseAnalysis: input.rootCauseAnalysis || null,
              actionPlan: input.actionPlan || null,
              responsibleId: input.responsibleId || null,
              dueDate: input.dueDate ? new Date(input.dueDate) : null,
              ipAddress: ctx.actor.ipAddress,
            },
            ctx.o,
          );

          // Link NC to CAPA
          await ctx.o
            .update(nonConformance)
            .set({ capaId: newCapa.id })
            // Defense-in-depth (SEC-08): repeat the tenant scope proven by the SELECT
            // above so the UPDATE stays org-scoped even if the guarding read is
            // refactored away. Reuses the in-scope member.organizationId.
            .where(
              and(
                eq(nonConformance.id, id),
                eq(nonConformance.organizationId, member.organizationId),
              ),
            );

          await ctx.audit("nonConformance", id, {
            action: "escalate_to_capa",
            changes: {
              capaId: { old: null, new: newCapa.id },
              capaNumber: newCapa.capaNumber,
            },
          });

          // Notify admins/owners of escalation, after the commit: the
          // notification reads the CAPA back.
          ctx.afterCommit(() =>
            notifyNCEscalatedToCapa(
              id,
              existing.ncNumber,
              newCapa.id,
              newCapa.capaNumber,
              existing.description,
              member.organizationId,
              session.user.id,
            ),
          );

          return {
            nc: { ...existing, capaId: newCapa.id },
            capa: newCapa,
          };
        },
      );

      return c.json(
        { message: "CAPA criada com sucesso", data: escalated },
        201,
      );
    },
  )

  // =========================================================================
  // GET /:id/audit-log - Get audit log for an NC
  // =========================================================================
  .get(
    "/:id/audit-log",
    ...withLabPermission({ non_conformance: ["read"] }),
    async (c) => {
      return orgDb(c.get("member").organizationId).transaction(async (o) => {
        // Verify NC exists and belongs to organization
        const { id } = await requireLabNonConformance(o, c.req.param("id"));

        const logs = await o
          .select()
          .from(nonConformanceAuditLog)
          .where(eq(nonConformanceAuditLog.ncId, id))
          .orderBy(desc(nonConformanceAuditLog.performedAt));

        return c.json({ data: logs });
      });
    },
  )

  // =========================================================================
  // GET /:id/oot-notification - §7.10 customer-notification record for an
  // out-of-tolerance NC (#426 Phase 0). Null when the NC has none.
  // =========================================================================
  .get(
    "/:id/oot-notification",
    ...withLabPermission({ non_conformance: ["read"] }),
    async (c) => {
      return orgDb(c.get("member").organizationId).transaction(async (o) => {
        const { id } = await requireLabNonConformance(o, c.req.param("id"));

        const [notification] = await o
          .select({
            id: ootNotification.id,
            ncId: ootNotification.ncId,
            jobId: ootNotification.jobId,
            certificateNumber: ootNotification.certificateNumber,
            recipientName: ootNotification.recipientName,
            recipientEmail: ootNotification.recipientEmail,
            affectedScope: ootNotification.affectedScope,
            status: ootNotification.status,
            pdfR2Key: ootNotification.pdfR2Key,
            sentAt: ootNotification.sentAt,
            acknowledgedAt: ootNotification.acknowledgedAt,
            acknowledgedVia: ootNotification.acknowledgedVia,
            acknowledgedNote: ootNotification.acknowledgedNote,
            createdAt: ootNotification.createdAt,
            // Deliberately NOT selected: ackToken (the unguessable public link
            // must not leak through the authenticated read surface).
          })
          .from(ootNotification)
          .where(eq(ootNotification.ncId, id))
          .limit(1);

        return c.json({ data: notification ?? null });
      });
    },
  )

  // =========================================================================
  // POST /:id/oot-ack - Manually register the customer's acknowledgement of
  // the §7.10 notification (phone / e-mail confirmation collected offline).
  // =========================================================================
  .post(
    "/:id/oot-ack",
    ...withLabPermission({ non_conformance: ["update"] }),
    zValidator("json", RegisterOotAcknowledgementSchema),
    async (c) => {
      const member = c.get("member");
      const input = c.req.valid("json");

      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const existing = await requireLabNonConformance(
            ctx.o,
            c.req.param("id"),
          );
          const id = existing.id;

          const [notification] = await ctx.o
            .select()
            .from(ootNotification)
            .where(eq(ootNotification.ncId, id))
            .limit(1);

          if (!notification) {
            throw notFound(
              "not_found",
              "Esta nao conformidade nao possui notificacao 7.10",
            );
          }

          // First acknowledgement wins (decision Q34): the stamp is the
          // regulated evidence of receipt, so the update is conditional on
          // `acknowledged_at IS NULL` and a manual registration racing the
          // e-mailed link (or another registration) can never overwrite it.
          // Defense-in-depth (SEC-08): org predicate repeated in the WHERE.
          const [row] = await ctx.o
            .update(ootNotification)
            .set({
              status: "ACKNOWLEDGED",
              acknowledgedAt: new Date(),
              acknowledgedVia: "manual",
              acknowledgedNote: input.note,
            })
            .where(
              and(
                eq(ootNotification.id, notification.id),
                eq(ootNotification.organizationId, member.organizationId),
                isNull(ootNotification.acknowledgedAt),
                inArray(
                  ootNotification.status,
                  OOT_NOTIFICATION_MACHINE.allowedFrom("acknowledge"),
                ),
              ),
            )
            .returning();

          if (!row) {
            throw conflict(
              "ALREADY_ACKNOWLEDGED",
              "O recebimento desta notificação já foi confirmado. O primeiro registro foi mantido.",
            );
          }

          await ctx.audit("nonConformance", id, {
            action: "oot_acknowledged",
            changes: { acknowledgedVia: "manual" },
            reason: input.note,
          });

          // Like the public link: only the call that stamped notifies, and only
          // after the stamp is committed.
          ctx.afterCommit(() =>
            notifyOotAcknowledged(
              row.id,
              id,
              existing.ncNumber,
              member.organizationId,
            ),
          );

          return row;
        },
      );

      return c.json({ message: "Recebimento registrado", data: updated });
    },
  )

  // =========================================================================
  // GET /:id/oot-impact-assessment - Guided §7.10 impact-assessment record
  // for an out-of-tolerance NC (#426 Phase 2). Null while none exists.
  // =========================================================================
  .get(
    "/:id/oot-impact-assessment",
    ...withLabPermission({ non_conformance: ["read"] }),
    async (c) => {
      return orgDb(c.get("member").organizationId).transaction(async (o) => {
        const { id } = await requireLabNonConformance(o, c.req.param("id"));

        const [assessment] = await o
          .select()
          .from(ootImpactAssessment)
          .where(eq(ootImpactAssessment.ncId, id))
          .limit(1);

        return c.json({ data: assessment ?? null });
      });
    },
  )

  // =========================================================================
  // PUT /:id/oot-impact-assessment - Create/update the draft assessment.
  // Immutable once signed (§7.10.2 retained evidence).
  // =========================================================================
  .put(
    "/:id/oot-impact-assessment",
    ...withLabPermission({ non_conformance: ["update"] }),
    zValidator("json", SaveOotImpactAssessmentSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const saved = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const nc = await requireLabNonConformance(ctx.o, c.req.param("id"));
          const id = nc.id;

          if (nc.type !== "out_of_tolerance") {
            throw conflict(
              "conflict",
              "Avaliacao de impacto aplica-se apenas a NCs de fora de tolerancia",
            );
          }

          const [existing] = await ctx.o
            .select()
            .from(ootImpactAssessment)
            .where(eq(ootImpactAssessment.ncId, id))
            .limit(1);

          if (existing?.signedAt) {
            throw conflict(
              "ASSESSMENT_SIGNED",
              "Avaliacao de impacto ja assinada — registro imutavel",
            );
          }

          const values = {
            deviationSummary: input.deviationSummary,
            deviationMagnitude: input.deviationMagnitude ?? null,
            customerTolerance: input.customerTolerance ?? null,
            toleranceUnit: input.toleranceUnit ?? null,
            affectedFrom: input.affectedFrom
              ? new Date(input.affectedFrom)
              : null,
            affectedTo: input.affectedTo ? new Date(input.affectedTo) : null,
            items: input.items,
            conclusion: input.conclusion ?? null,
            correctiveActionNote: input.correctiveActionNote ?? null,
          };

          const [row] = existing
            ? await ctx.o
                .update(ootImpactAssessment)
                .set(values)
                .where(
                  and(
                    eq(ootImpactAssessment.id, existing.id),
                    eq(
                      ootImpactAssessment.organizationId,
                      member.organizationId,
                    ),
                  ),
                )
                .returning()
            : await ctx.o
                .insert(ootImpactAssessment)
                .values({
                  ...values,
                  organizationId: member.organizationId,
                  ncId: id,
                  createdBy: session.user.id,
                })
                .returning();

          await ctx.audit("nonConformance", id, {
            action: "impact_assessment_saved",
            changes: { conclusion: input.conclusion ?? null },
          });

          return row;
        },
      );

      return c.json({ message: "Avaliacao de impacto salva", data: saved });
    },
  )

  // =========================================================================
  // POST /:id/oot-impact-assessment/sign - Sign-off freezes the record.
  // Org-level admin/owner only (§7.10.1 defined responsibilities).
  // =========================================================================
  .post(
    "/:id/oot-impact-assessment/sign",
    ...withLabPermission({ non_conformance: ["update"] }),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");

      const signed = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          if (member.role !== "admin" && member.role !== "owner") {
            throw forbidden(
              "forbidden",
              "A assinatura da avaliacao de impacto requer um administrador ou responsavel",
            );
          }

          const { id } = await requireLabNonConformance(
            ctx.o,
            c.req.param("id"),
          );

          const [assessment] = await ctx.o
            .select()
            .from(ootImpactAssessment)
            .where(eq(ootImpactAssessment.ncId, id))
            .limit(1);

          if (!assessment) {
            throw notFound(
              "not_found",
              "Nenhuma avaliacao de impacto para assinar",
            );
          }
          if (assessment.signedAt) {
            throw conflict("ASSESSMENT_SIGNED", "Avaliacao ja assinada");
          }
          if (!assessment.conclusion) {
            throw conflict(
              "CONCLUSION_REQUIRED",
              "Defina a conclusao antes de assinar a avaliacao",
            );
          }

          const [row] = await ctx.o
            .update(ootImpactAssessment)
            .set({ signedBy: session.user.id, signedAt: new Date() })
            .where(
              and(
                eq(ootImpactAssessment.id, assessment.id),
                eq(ootImpactAssessment.organizationId, member.organizationId),
                // Guard against a concurrent sign racing this one.
                sql`${ootImpactAssessment.signedAt} IS NULL`,
              ),
            )
            .returning();

          if (!row) {
            throw conflict("ASSESSMENT_SIGNED", "Avaliacao ja assinada");
          }

          await ctx.audit("nonConformance", id, {
            action: "impact_assessment_signed",
            changes: { conclusion: row.conclusion },
          });

          return row;
        },
      );

      return c.json({
        message: "Avaliacao de impacto assinada",
        data: signed,
      });
    },
  );
