import { createRouter } from "../../server/router";
import { financeEndpoints } from "@calibra-facil/contracts";
import { mount } from "../../lib/endpoint-mount";
import { CERTIFICATE_ISSUED_JOB_STATUSES } from "@calibra-facil/schemas";
import { isOneOf } from "@calibra-facil/shared/status-vocabulary";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import {
  BILLING_DOCUMENT_MACHINE,
  RECEIVABLE_INSTALLMENT_MACHINE,
} from "@calibra-facil/schemas/machines";
import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  billingDocument,
  billingDocumentItem,
  calibrationJob,
  customer,
  organizationUnit,
  receivableInstallment,
  service,
} from "@calibra-facil/db/schema";
import {
  DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS,
  resolveIssuedDueDate,
} from "@calibra-facil/shared";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import {
  buildDefaultDueDate,
  ensureJobCommercialSnapshotFromJob,
  generateBillingDocumentNumber,
} from "../../lib/finance";
import {
  getDocumentById,
  getDocumentByPublicId,
  requireDocumentInUnitScope,
  requireDocumentRouteId,
  requireLabDocument,
} from "../../lib/billing-document-access";
import { invalid, notFound } from "../../lib/domain-errors";
import { withOrg } from "../../lib/org-context";
import { orgDb } from "../../lib/org-db";
import { buildUnitScopeCondition } from "../../lib/units";
import { requestActor } from "../../middleware/request-actor";

/** The document's status under a row lock for the caller's transaction (BILLING_DOCUMENT_MACHINE). */
async function lockBillingDocumentStatus(o: Pick<OrgDb, "select">, id: number) {
  const [row] = await o
    .select({ status: billingDocument.status })
    .from(billingDocument)
    .where(eq(billingDocument.id, id))
    .limit(1)
    .for("update");
  return row?.status ?? null;
}

const PREFIX = "/api/finance/documents";

export const financeDocumentsRouter = createRouter<{
  Variables: AuthVariables;
}>();
mount(
  financeDocumentsRouter,
  PREFIX,
  financeEndpoints.listDocuments,
  withLabPermission({ financial: ["read"] }),
  async (c, { query }) => {
    const member = c.get("member");
    const conditions = [
      eq(billingDocument.organizationId, member.organizationId),
      buildUnitScopeCondition(billingDocument.unitId, member),
    ];

    if (query.customerId) {
      conditions.push(eq(billingDocument.customerId, query.customerId));
    }

    if (query.status) {
      conditions.push(eq(billingDocument.status, query.status));
    }

    if (query.query) {
      conditions.push(
        ilike(
          sql<string>`coalesce(${billingDocument.documentNumber}, '') || ' ' || coalesce(${customer.name}, '')`,
          `%${query.query}%`,
        ),
      );
    }

    const documents = await orgDb(member.organizationId).transaction((o) =>
      o
        .select({
          id: billingDocument.id,
          publicId: billingDocument.publicId,
          documentNumber: billingDocument.documentNumber,
          status: billingDocument.status,
          customerId: billingDocument.customerId,
          customerName: customer.name,
          unitId: billingDocument.unitId,
          unitName: organizationUnit.name,
          issueDate: billingDocument.issueDate,
          dueDate: billingDocument.dueDate,
          subtotalCents: billingDocument.subtotalCents,
          discountCents: billingDocument.discountCents,
          totalCents: billingDocument.totalCents,
          currency: billingDocument.currency,
          exportStatus: billingDocument.exportStatus,
          exportedAt: billingDocument.exportedAt,
          createdAt: billingDocument.createdAt,
          updatedAt: billingDocument.updatedAt,
        })
        .from(billingDocument)
        .innerJoin(customer, eq(billingDocument.customerId, customer.id))
        .innerJoin(
          organizationUnit,
          eq(billingDocument.unitId, organizationUnit.id),
        )
        .where(and(...conditions))
        .orderBy(desc(billingDocument.createdAt)),
    );

    return { data: documents };
  },
);
mount(
  financeDocumentsRouter,
  PREFIX,
  financeEndpoints.listEligibleJobs,
  withLabPermission({ financial: ["document_create"] }),
  async (c, { query }) => {
    const member = c.get("member");
    const conditions = [
      eq(calibrationJob.organizationId, member.organizationId),
      buildUnitScopeCondition(calibrationJob.unitId, member),
      inArray(calibrationJob.status, CERTIFICATE_ISSUED_JOB_STATUSES),
    ];

    if (query.customerId) {
      conditions.push(eq(calibrationJob.customerId, query.customerId));
    }

    if (query.query) {
      conditions.push(ilike(calibrationJob.jobId, `%${query.query}%`));
    }

    // One transaction: the listing and the commercial snapshots it creates for
    // jobs that have none yet (the same writes the single statements made).
    const eligibleJobs = await orgDb(member.organizationId).transaction(
      async (o) => {
        const jobs = await o
          .select({
            id: calibrationJob.id,
            jobId: calibrationJob.jobId,
            customerId: calibrationJob.customerId,
            customerName: customer.name,
            unitId: calibrationJob.unitId,
            unitName: organizationUnit.name,
            serviceId: calibrationJob.serviceId,
            serviceName: service.name,
            servicePrice: service.price,
            currency: service.currency,
            approvedAt: calibrationJob.approvedAt,
          })
          .from(calibrationJob)
          .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
          .innerJoin(
            organizationUnit,
            eq(calibrationJob.unitId, organizationUnit.id),
          )
          .innerJoin(service, eq(calibrationJob.serviceId, service.id))
          .where(and(...conditions))
          .orderBy(
            desc(calibrationJob.approvedAt),
            desc(calibrationJob.createdAt),
          )
          .limit(query.limit);

        const existingLinks = await o
          .select({
            jobId: billingDocumentItem.jobId,
          })
          .from(billingDocumentItem)
          .innerJoin(
            billingDocument,
            eq(billingDocumentItem.documentId, billingDocument.id),
          )
          .where(
            and(
              eq(billingDocument.organizationId, member.organizationId),
              inArray(billingDocument.status, [
                "DRAFT",
                "ISSUED",
                "PAID",
                "OVERDUE",
              ]),
              inArray(
                billingDocumentItem.jobId,
                jobs.map((job) => job.id),
              ),
            ),
          );

        const blockedJobIds = new Set(
          existingLinks.flatMap((item) => (item.jobId ? [item.jobId] : [])),
        );
        const eligible = [];

        for (const job of jobs) {
          if (blockedJobIds.has(job.id)) {
            continue;
          }

          const snapshot = await ensureJobCommercialSnapshotFromJob(
            {
              jobId: job.id,
              organizationId: member.organizationId,
            },
            o,
          );

          eligible.push({
            ...job,
            priceCents: snapshot.priceCents ?? 0,
            paymentTermDays: snapshot.paymentTermDays,
            snapshotId: snapshot.id,
          });
        }

        return eligible;
      },
    );

    return { data: eligibleJobs };
  },
);
mount(
  financeDocumentsRouter,
  PREFIX,
  financeEndpoints.createDocument,
  withLabPermission({ financial: ["document_create"] }),
  async (c, { body: input }) => {
    const member = c.get("member");

    const document = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const jobs = await ctx.o
          .select({
            id: calibrationJob.id,
            jobId: calibrationJob.jobId,
            customerId: calibrationJob.customerId,
            unitId: calibrationJob.unitId,
            serviceId: calibrationJob.serviceId,
            status: calibrationJob.status,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, member.organizationId),
              buildUnitScopeCondition(calibrationJob.unitId, member),
              inArray(calibrationJob.id, input.jobIds),
            ),
          );

        if (jobs.length !== input.jobIds.length) {
          throw notFound(
            "billing_jobs_not_found",
            "Uma ou mais ordens nao foram encontradas",
          );
        }

        const invalidJobs = jobs.filter(
          (job) => !isOneOf(CERTIFICATE_ISSUED_JOB_STATUSES, job.status),
        );
        if (invalidJobs.length > 0) {
          throw invalid(
            "billing_jobs_not_billable",
            "Apenas ordens aprovadas ou retificadas podem ser faturadas",
          );
        }

        const existingLinks = await ctx.o
          .select({
            jobId: billingDocumentItem.jobId,
            documentNumber: billingDocument.documentNumber,
          })
          .from(billingDocumentItem)
          .innerJoin(
            billingDocument,
            eq(billingDocumentItem.documentId, billingDocument.id),
          )
          .where(
            and(
              eq(billingDocument.organizationId, member.organizationId),
              inArray(billingDocument.status, [
                "DRAFT",
                "ISSUED",
                "PAID",
                "OVERDUE",
              ]),
              inArray(billingDocumentItem.jobId, input.jobIds),
            ),
          );

        if (existingLinks.length > 0) {
          throw invalid(
            "billing_jobs_already_documented",
            `Uma ou mais ordens ja possuem documento ativo (${existingLinks[0]?.documentNumber ?? "sem numero"})`,
          );
        }

        const snapshots: Awaited<
          ReturnType<typeof ensureJobCommercialSnapshotFromJob>
        >[] = [];
        for (const job of jobs) {
          snapshots.push(
            await ensureJobCommercialSnapshotFromJob(
              {
                actorUserId: ctx.actor.userId,
                jobId: job.id,
                organizationId: member.organizationId,
              },
              ctx.o,
            ),
          );
        }

        const firstJob = jobs[0]!;
        const sharedCustomerId = firstJob.customerId;
        const sharedUnitId = firstJob.unitId;
        const sharedCurrency = snapshots[0]?.currency ?? "BRL";

        if (
          jobs.some(
            (job, index) =>
              job.customerId !== sharedCustomerId ||
              job.unitId !== sharedUnitId ||
              (snapshots[index]?.currency ?? "BRL") !== sharedCurrency,
          )
        ) {
          throw invalid(
            "billing_jobs_not_consolidatable",
            "A cobranca consolidada exige ordens do mesmo cliente, unidade e moeda",
          );
        }

        if (input.mode === "single" && jobs.length !== 1) {
          throw invalid(
            "billing_single_job_mode_violation",
            "O modo por OS aceita apenas uma ordem por documento",
          );
        }

        const subtotalCents = snapshots.reduce(
          (sum, snapshot) => sum + (snapshot.priceCents ?? 0),
          0,
        );
        const paymentTermDays =
          Math.max(
            ...snapshots.map((snapshot) => snapshot.paymentTermDays),
            DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS,
          ) || DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS;
        const dueDate = input.dueDate
          ? new Date(input.dueDate)
          : buildDefaultDueDate(paymentTermDays);
        const discountCents = input.discountCents ?? 0;
        const totalCents = Math.max(subtotalCents - discountCents, 0);

        const [created] = await ctx.o
          .insert(billingDocument)
          .values({
            organizationId: member.organizationId,
            customerId: sharedCustomerId,
            unitId: sharedUnitId,
            agreementId:
              snapshots.find((snapshot) => snapshot.agreementId)?.agreementId ??
              null,
            dueDate,
            currency: sharedCurrency,
            subtotalCents,
            discountCents,
            totalCents,
            notes: input.notes?.trim() || null,
            createdBy: ctx.actor.userId,
            updatedBy: ctx.actor.userId,
          })
          .returning();

        if (!created) {
          throw new Error("Falha ao criar documento financeiro");
        }

        await ctx.o.insert(billingDocumentItem).values(
          jobs.map((job, index) => ({
            organizationId: member.organizationId,
            documentId: created.id,
            jobId: job.id,
            jobCommercialSnapshotId: snapshots[index]?.id ?? null,
            description: snapshots[index]?.serviceName ?? job.jobId,
            quantity: 1,
            unitPriceCents: snapshots[index]?.priceCents ?? 0,
            totalCents: snapshots[index]?.priceCents ?? 0,
            sortOrder: index,
          })),
        );

        await ctx.audit("financialDocument", created.id, {
          action: "document.create",
          changes: {
            jobIds: jobs.map((job) => job.id),
            mode: input.mode,
            subtotalCents,
            discountCents,
            totalCents,
          },
        });

        return created;
      },
    );

    return { data: document };
  },
);
mount(
  financeDocumentsRouter,
  PREFIX,
  financeEndpoints.getDocument,
  withLabPermission({ financial: ["read"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const publicId = params.id;

    const document = await orgDb(member.organizationId).transaction((o) =>
      getDocumentByPublicId(o, member.organizationId, publicId),
    );
    if (!document) {
      throw notFound("billing_document_not_found", "Documento nao encontrado");
    }
    requireDocumentInUnitScope(member, document.unitId);

    return { data: document };
  },
);
mount(
  financeDocumentsRouter,
  PREFIX,
  financeEndpoints.updateDocument,
  withLabPermission({ financial: ["document_create"] }),
  async (c, { params, body: input }) => {
    const member = c.get("member");
    const id = requireDocumentRouteId(params.id);

    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabDocument(ctx.o, member, id);

        if (existing.status !== "DRAFT") {
          throw invalid(
            "billing_document_not_draft",
            "Apenas documentos em rascunho podem ser editados",
          );
        }

        const nextItems = existing.items.map((item) => {
          const incoming = input.items?.find(
            (candidate) => candidate.id === item.id,
          );
          if (!incoming) return item;

          return {
            ...item,
            description: incoming.description,
            quantity: incoming.quantity,
            unitPriceCents: incoming.unitPriceCents,
            totalCents: incoming.quantity * incoming.unitPriceCents,
          };
        });

        const hasSnapshotDivergence = nextItems.some((item) => {
          if (!item.jobCommercialSnapshotId) {
            return false;
          }

          return (
            item.quantity !== 1 ||
            item.description !==
              (item.snapshotServiceName ?? item.description) ||
            item.unitPriceCents !==
              (item.snapshotPriceCents ?? item.unitPriceCents)
          );
        });

        if (hasSnapshotDivergence && !input.reason?.trim()) {
          throw invalid(
            "billing_document_edit_reason_required",
            "Edicoes divergentes do snapshot exigem motivo",
          );
        }

        const subtotalCents = nextItems.reduce(
          (sum, item) => sum + item.totalCents,
          0,
        );
        const discountCents = input.discountCents ?? 0;
        const totalCents = Math.max(subtotalCents - discountCents, 0);

        await ctx.o
          .update(billingDocument)
          .set({
            dueDate: input.dueDate ? new Date(input.dueDate) : existing.dueDate,
            notes:
              input.notes === undefined
                ? existing.notes
                : input.notes.trim() || null,
            discountCents,
            subtotalCents,
            totalCents,
            updatedAt: new Date(),
            updatedBy: ctx.actor.userId,
          })
          .where(eq(billingDocument.id, id));

        for (const item of nextItems) {
          await ctx.o
            .update(billingDocumentItem)
            .set({
              description: item.description,
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              totalCents: item.totalCents,
              updatedAt: new Date(),
            })
            .where(eq(billingDocumentItem.id, item.id));
        }

        await ctx.audit("financialDocument", id, {
          action: "document.update",
          changes: {
            reason: input.reason ?? null,
            dueDate: input.dueDate ?? existing.dueDate.toISOString(),
            discountCents,
            subtotalCents,
            totalCents,
          },
          reason: input.reason?.trim() || null,
        });

        const detail = await getDocumentById(ctx.o, member.organizationId, id);
        if (!detail) {
          throw notFound(
            "billing_document_not_found",
            "Documento nao encontrado",
          );
        }
        return detail;
      },
    );

    return { data: updated };
  },
);
mount(
  financeDocumentsRouter,
  PREFIX,
  financeEndpoints.issueDocument,
  withLabPermission({ financial: ["document_issue"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const id = requireDocumentRouteId(params.id);

    // `ctx.tx` is the raw transaction the numbering helper needs (it takes an
    // advisory lock with raw SQL); everything else goes through `ctx.o`.
    const issued = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabDocument(ctx.o, member, id);

        // Locked: the number below is allocated only for a draft that stays
        // a draft until this transaction commits.
        const lockedStatus = await lockBillingDocumentStatus(ctx.o, id);
        if (
          !lockedStatus ||
          !BILLING_DOCUMENT_MACHINE.canTransition(lockedStatus, "issue")
        ) {
          throw invalid(
            "billing_document_not_draft",
            "Documento ja foi emitido ou encerrado",
          );
        }

        const documentNumber = await generateBillingDocumentNumber(
          member.organizationId,
          ctx.tx,
        );
        const issueDate = new Date();
        const effectiveDueDate = resolveIssuedDueDate(
          existing.dueDate,
          issueDate,
          DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS,
        );

        await ctx.o
          .update(billingDocument)
          .set({
            documentNumber,
            status: BILLING_DOCUMENT_MACHINE.requireTargetOf(
              lockedStatus,
              "issue",
            ),
            issueDate,
            dueDate: effectiveDueDate,
            issuedBy: ctx.actor.userId,
            updatedBy: ctx.actor.userId,
            updatedAt: issueDate,
          })
          .where(eq(billingDocument.id, id));

        const [existingInstallment] = await ctx.o
          .select({ id: receivableInstallment.id })
          .from(receivableInstallment)
          .where(eq(receivableInstallment.documentId, id))
          .limit(1);

        if (!existingInstallment) {
          await ctx.o.insert(receivableInstallment).values({
            organizationId: member.organizationId,
            documentId: id,
            installmentNumber: 1,
            status: "OPEN",
            dueDate: effectiveDueDate,
            amountCents: existing.totalCents,
            currency: existing.currency,
          });
        }

        await ctx.audit("financialDocument", id, {
          action: "document.issue",
          changes: {
            documentNumber,
            issueDate: issueDate.toISOString(),
            dueDate: effectiveDueDate.toISOString(),
          },
        });

        const detail = await getDocumentById(ctx.o, member.organizationId, id);
        if (!detail) {
          throw notFound(
            "billing_document_not_found",
            "Documento nao encontrado",
          );
        }
        return detail;
      },
    );

    return { data: issued };
  },
);
mount(
  financeDocumentsRouter,
  PREFIX,
  financeEndpoints.voidDocument,
  withLabPermission({ financial: ["document_void"] }),
  async (c, { params, body: input }) => {
    const member = c.get("member");
    const id = requireDocumentRouteId(params.id);

    const voided = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        await requireLabDocument(ctx.o, member, id);

        const lockedStatus = await lockBillingDocumentStatus(ctx.o, id);
        if (
          !lockedStatus ||
          !BILLING_DOCUMENT_MACHINE.canTransition(lockedStatus, "void")
        ) {
          throw invalid(
            "billing_document_already_void",
            "Documento ja esta anulado",
          );
        }

        await ctx.o
          .update(billingDocument)
          .set({
            status: BILLING_DOCUMENT_MACHINE.requireTargetOf(
              lockedStatus,
              "void",
            ),
            voidReason: input.reason,
            voidedBy: ctx.actor.userId,
            updatedAt: new Date(),
            updatedBy: ctx.actor.userId,
          })
          .where(eq(billingDocument.id, id));

        // `void` of RECEIVABLE_INSTALLMENT_MACHINE: every installment goes
        // with its document.
        await ctx.o
          .update(receivableInstallment)
          .set({
            status: "VOID",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(receivableInstallment.documentId, id),
              inArray(
                receivableInstallment.status,
                RECEIVABLE_INSTALLMENT_MACHINE.allowedFrom("void"),
              ),
            ),
          );

        await ctx.audit("financialDocument", id, {
          action: "document.void",
          changes: {
            reason: input.reason,
          },
          reason: input.reason,
        });

        const detail = await getDocumentById(ctx.o, member.organizationId, id);
        if (!detail) {
          throw notFound(
            "billing_document_not_found",
            "Documento nao encontrado",
          );
        }
        return detail;
      },
    );

    return { data: voided };
  },
);
