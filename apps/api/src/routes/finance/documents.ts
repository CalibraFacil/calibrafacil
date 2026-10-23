import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  billingDocument,
  billingDocumentItem,
  calibrationJob,
  customer,
  financialAuditLog,
  jobCommercialSnapshot,
  organizationUnit,
  paymentReceipt,
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
import { orgDb } from "../../lib/org-db";
import { orgTransactionWithExecutor } from "../../lib/org-transaction";
import { buildUnitScopeCondition } from "../../lib/units";

const ListDocumentsQuerySchema = z.object({
  query: z.string().trim().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  status: z.enum(["DRAFT", "ISSUED", "PAID", "OVERDUE", "VOID"]).optional(),
});

const EligibleJobsQuerySchema = z.object({
  query: z.string().trim().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  mode: z.enum(["single", "consolidated"]).default("single"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const CreateDocumentSchema = z.object({
  mode: z.enum(["single", "consolidated"]).default("single"),
  jobIds: z.array(z.number().int().positive()).min(1),
  dueDate: z.string().datetime().optional(),
  notes: z.string().trim().max(5000).optional(),
  discountCents: z.number().int().min(0).default(0),
});

const UpdateDocumentItemSchema = z.object({
  id: z.number().int().positive(),
  description: z.string().trim().min(1).max(240),
  quantity: z.number().int().min(1).max(999).default(1),
  unitPriceCents: z.number().int().min(0),
});

const UpdateDocumentSchema = z.object({
  dueDate: z.string().datetime().optional(),
  notes: z.string().trim().max(5000).optional(),
  discountCents: z.number().int().min(0).default(0),
  reason: z.string().trim().max(500).optional(),
  items: z.array(UpdateDocumentItemSchema).optional(),
});

const VoidDocumentSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

async function getDocumentById(
  o: OrgDb,
  organizationId: string,
  documentId: number,
) {
  const [document] = await o
    .select({
      id: billingDocument.id,
      publicId: billingDocument.publicId,
      organizationId: billingDocument.organizationId,
      customerId: billingDocument.customerId,
      customerName: customer.name,
      unitId: billingDocument.unitId,
      unitName: organizationUnit.name,
      agreementId: billingDocument.agreementId,
      documentNumber: billingDocument.documentNumber,
      status: billingDocument.status,
      issueDate: billingDocument.issueDate,
      dueDate: billingDocument.dueDate,
      currency: billingDocument.currency,
      subtotalCents: billingDocument.subtotalCents,
      discountCents: billingDocument.discountCents,
      totalCents: billingDocument.totalCents,
      notes: billingDocument.notes,
      exportStatus: billingDocument.exportStatus,
      exportedAt: billingDocument.exportedAt,
      createdAt: billingDocument.createdAt,
      updatedAt: billingDocument.updatedAt,
      voidReason: billingDocument.voidReason,
    })
    .from(billingDocument)
    .innerJoin(customer, eq(billingDocument.customerId, customer.id))
    .innerJoin(
      organizationUnit,
      eq(billingDocument.unitId, organizationUnit.id),
    )
    .where(
      and(
        eq(billingDocument.id, documentId),
        eq(billingDocument.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!document) {
    return null;
  }

  const [items, installments, receipts, audit] = await Promise.all([
    o
      .select({
        id: billingDocumentItem.id,
        documentId: billingDocumentItem.documentId,
        jobId: billingDocumentItem.jobId,
        jobDisplayId: calibrationJob.jobId,
        jobCommercialSnapshotId: billingDocumentItem.jobCommercialSnapshotId,
        snapshotServiceName: jobCommercialSnapshot.serviceName,
        snapshotPriceCents: jobCommercialSnapshot.priceCents,
        description: billingDocumentItem.description,
        quantity: billingDocumentItem.quantity,
        unitPriceCents: billingDocumentItem.unitPriceCents,
        totalCents: billingDocumentItem.totalCents,
        sortOrder: billingDocumentItem.sortOrder,
      })
      .from(billingDocumentItem)
      .leftJoin(
        calibrationJob,
        eq(billingDocumentItem.jobId, calibrationJob.id),
      )
      .leftJoin(
        jobCommercialSnapshot,
        eq(
          billingDocumentItem.jobCommercialSnapshotId,
          jobCommercialSnapshot.id,
        ),
      )
      .where(eq(billingDocumentItem.documentId, document.id))
      .orderBy(billingDocumentItem.sortOrder, billingDocumentItem.id),
    o
      .select()
      .from(receivableInstallment)
      .where(eq(receivableInstallment.documentId, document.id))
      .orderBy(receivableInstallment.installmentNumber),
    o
      .select({
        id: paymentReceipt.id,
        installmentId: paymentReceipt.installmentId,
        amountCents: paymentReceipt.amountCents,
        paymentMethod: paymentReceipt.paymentMethod,
        reference: paymentReceipt.reference,
        notes: paymentReceipt.notes,
        receivedAt: paymentReceipt.receivedAt,
      })
      .from(paymentReceipt)
      .innerJoin(
        receivableInstallment,
        eq(paymentReceipt.installmentId, receivableInstallment.id),
      )
      .where(eq(receivableInstallment.documentId, document.id))
      .orderBy(desc(paymentReceipt.receivedAt)),
    o
      .select()
      .from(financialAuditLog)
      .where(
        and(
          eq(financialAuditLog.organizationId, organizationId),
          eq(financialAuditLog.entityType, "document"),
          eq(financialAuditLog.entityId, String(document.id)),
        ),
      )
      .orderBy(desc(financialAuditLog.performedAt)),
  ]);

  return {
    ...document,
    items,
    installments,
    receipts,
    audit,
  };
}

async function getDocumentByPublicId(
  o: OrgDb,
  organizationId: string,
  publicId: string,
) {
  const [row] = await o
    .select({ id: billingDocument.id })
    .from(billingDocument)
    .where(
      and(
        eq(billingDocument.publicId, publicId),
        eq(billingDocument.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return getDocumentById(o, organizationId, row.id);
}

function isDocumentOutsideActiveUnitScope(
  member: AuthVariables["member"],
  unitId: number,
) {
  return member.selectedUnitScope !== "all" && unitId !== member.activeUnitId;
}

export const financeDocumentsRouter = new Hono<{ Variables: AuthVariables }>()
  .get(
    "/",
    ...withLabPermission({ financial: ["read"] }),
    zValidator("query", ListDocumentsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const query = c.req.valid("query");
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

      return c.json({ data: documents });
    },
  )
  .get(
    "/eligible-jobs",
    ...withLabPermission({ financial: ["document_create"] }),
    zValidator("query", EligibleJobsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const query = c.req.valid("query");
      const conditions = [
        eq(calibrationJob.organizationId, member.organizationId),
        buildUnitScopeCondition(calibrationJob.unitId, member),
        inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
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

      return c.json({ data: eligibleJobs });
    },
  )
  .post(
    "/",
    ...withLabPermission({ financial: ["document_create"] }),
    zValidator("json", CreateDocumentSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const outcome = await orgDb(member.organizationId).transaction(
        async (o) => {
          const jobs = await o
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
            return { status: "jobs_not_found" as const };
          }

          const invalidJobs = jobs.filter(
            (job) => !["APPROVED", "SUPERSEDED"].includes(job.status),
          );
          if (invalidJobs.length > 0) {
            return { status: "jobs_not_billable" as const };
          }

          const existingLinks = await o
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
            return {
              status: "already_documented" as const,
              documentNumber: existingLinks[0]?.documentNumber ?? "sem numero",
            };
          }

          const snapshots: Awaited<
            ReturnType<typeof ensureJobCommercialSnapshotFromJob>
          >[] = [];
          for (const job of jobs) {
            snapshots.push(
              await ensureJobCommercialSnapshotFromJob(
                {
                  actorUserId: session.user.id,
                  jobId: job.id,
                  organizationId: member.organizationId,
                },
                o,
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
            return { status: "not_consolidatable" as const };
          }

          if (input.mode === "single" && jobs.length !== 1) {
            return { status: "single_mode_violation" as const };
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

          const [document] = await o
            .insert(billingDocument)
            .values({
              organizationId: member.organizationId,
              customerId: sharedCustomerId,
              unitId: sharedUnitId,
              agreementId:
                snapshots.find((snapshot) => snapshot.agreementId)
                  ?.agreementId ?? null,
              dueDate,
              currency: sharedCurrency,
              subtotalCents,
              discountCents,
              totalCents,
              notes: input.notes?.trim() || null,
              createdBy: session.user.id,
              updatedBy: session.user.id,
            })
            .returning();

          if (!document) {
            throw new Error("Falha ao criar documento financeiro");
          }

          await o.insert(billingDocumentItem).values(
            jobs.map((job, index) => ({
              organizationId: member.organizationId,
              documentId: document.id,
              jobId: job.id,
              jobCommercialSnapshotId: snapshots[index]?.id ?? null,
              description: snapshots[index]?.serviceName ?? job.jobId,
              quantity: 1,
              unitPriceCents: snapshots[index]?.priceCents ?? 0,
              totalCents: snapshots[index]?.priceCents ?? 0,
              sortOrder: index,
            })),
          );

          await o.insert(financialAuditLog).values({
            organizationId: member.organizationId,
            entityType: "document",
            entityId: String(document.id),
            action: "document.create",
            changes: {
              jobIds: jobs.map((job) => job.id),
              mode: input.mode,
              subtotalCents,
              discountCents,
              totalCents,
            },
            performedBy: session.user.id,
          });

          return { status: "ok" as const, document };
        },
      );

      if (outcome.status === "jobs_not_found") {
        return c.json(
          { error: "Uma ou mais ordens nao foram encontradas" },
          404,
        );
      }
      if (outcome.status === "jobs_not_billable") {
        return c.json(
          {
            error: "Apenas ordens aprovadas ou retificadas podem ser faturadas",
          },
          400,
        );
      }
      if (outcome.status === "already_documented") {
        return c.json(
          {
            error: `Uma ou mais ordens ja possuem documento ativo (${outcome.documentNumber})`,
          },
          400,
        );
      }
      if (outcome.status === "not_consolidatable") {
        return c.json(
          {
            error:
              "A cobranca consolidada exige ordens do mesmo cliente, unidade e moeda",
          },
          400,
        );
      }
      if (outcome.status === "single_mode_violation") {
        return c.json(
          { error: "O modo por OS aceita apenas uma ordem por documento" },
          400,
        );
      }

      return c.json({ data: outcome.document }, 201);
    },
  )
  .get("/:id", ...withLabPermission({ financial: ["read"] }), async (c) => {
    const member = c.get("member");
    const publicId = c.req.param("id");

    const document = await orgDb(member.organizationId).transaction((o) =>
      getDocumentByPublicId(o, member.organizationId, publicId),
    );
    if (!document) {
      return c.json({ error: "Documento nao encontrado" }, 404);
    }

    if (isDocumentOutsideActiveUnitScope(member, document.unitId)) {
      return c.json(
        { error: "Documento fora do escopo da unidade ativa" },
        403,
      );
    }

    return c.json({ data: document });
  })
  .put(
    "/:id",
    ...withLabPermission({ financial: ["document_create"] }),
    zValidator("json", UpdateDocumentSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (!Number.isInteger(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const outcome = await orgDb(member.organizationId).transaction(
        async (o) => {
          const existing = await getDocumentById(o, member.organizationId, id);
          if (!existing) return { status: "not_found" as const };

          if (isDocumentOutsideActiveUnitScope(member, existing.unitId)) {
            return { status: "outside_unit_scope" as const };
          }

          if (existing.status !== "DRAFT") {
            return { status: "not_draft" as const };
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
            return { status: "reason_required" as const };
          }

          const subtotalCents = nextItems.reduce(
            (sum, item) => sum + item.totalCents,
            0,
          );
          const discountCents = input.discountCents ?? 0;
          const totalCents = Math.max(subtotalCents - discountCents, 0);

          await o
            .update(billingDocument)
            .set({
              dueDate: input.dueDate
                ? new Date(input.dueDate)
                : existing.dueDate,
              notes:
                input.notes === undefined
                  ? existing.notes
                  : input.notes.trim() || null,
              discountCents,
              subtotalCents,
              totalCents,
              updatedAt: new Date(),
              updatedBy: session.user.id,
            })
            .where(eq(billingDocument.id, id));

          for (const item of nextItems) {
            await o
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

          await o.insert(financialAuditLog).values({
            organizationId: member.organizationId,
            entityType: "document",
            entityId: String(id),
            action: "document.update",
            changes: {
              reason: input.reason ?? null,
              dueDate: input.dueDate ?? existing.dueDate.toISOString(),
              discountCents,
              subtotalCents,
              totalCents,
            },
            performedBy: session.user.id,
            reason: input.reason?.trim() || null,
          });

          return {
            status: "ok" as const,
            updated: await getDocumentById(o, member.organizationId, id),
          };
        },
      );

      if (outcome.status === "not_found") {
        return c.json({ error: "Documento nao encontrado" }, 404);
      }
      if (outcome.status === "outside_unit_scope") {
        return c.json(
          { error: "Documento fora do escopo da unidade ativa" },
          403,
        );
      }
      if (outcome.status === "not_draft") {
        return c.json(
          { error: "Apenas documentos em rascunho podem ser editados" },
          400,
        );
      }
      if (outcome.status === "reason_required") {
        return c.json(
          { error: "Edicoes divergentes do snapshot exigem motivo" },
          400,
        );
      }

      return c.json({ data: outcome.updated });
    },
  )
  .post(
    "/:id/issue",
    ...withLabPermission({ financial: ["document_issue"] }),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);

      if (!Number.isInteger(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // `tx` is the raw transaction the numbering helper needs (it takes an
      // advisory lock with raw SQL); everything else goes through `o`.
      const outcome = await orgTransactionWithExecutor(
        member.organizationId,
        async (o, tx) => {
          const existing = await getDocumentById(o, member.organizationId, id);
          if (!existing) return { status: "not_found" as const };

          if (isDocumentOutsideActiveUnitScope(member, existing.unitId)) {
            return { status: "outside_unit_scope" as const };
          }

          if (existing.status !== "DRAFT") {
            return { status: "not_draft" as const };
          }

          const documentNumber = await generateBillingDocumentNumber(
            member.organizationId,
            tx,
          );
          const issueDate = new Date();
          const effectiveDueDate = resolveIssuedDueDate(
            existing.dueDate,
            issueDate,
            DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS,
          );

          await o
            .update(billingDocument)
            .set({
              documentNumber,
              status: "ISSUED",
              issueDate,
              dueDate: effectiveDueDate,
              issuedBy: session.user.id,
              updatedBy: session.user.id,
              updatedAt: issueDate,
            })
            .where(eq(billingDocument.id, id));

          const [existingInstallment] = await o
            .select({ id: receivableInstallment.id })
            .from(receivableInstallment)
            .where(eq(receivableInstallment.documentId, id))
            .limit(1);

          if (!existingInstallment) {
            await o.insert(receivableInstallment).values({
              organizationId: member.organizationId,
              documentId: id,
              installmentNumber: 1,
              status: "OPEN",
              dueDate: effectiveDueDate,
              amountCents: existing.totalCents,
              currency: existing.currency,
            });
          }

          await o.insert(financialAuditLog).values({
            organizationId: member.organizationId,
            entityType: "document",
            entityId: String(id),
            action: "document.issue",
            changes: {
              documentNumber,
              issueDate: issueDate.toISOString(),
              dueDate: effectiveDueDate.toISOString(),
            },
            performedBy: session.user.id,
          });

          return {
            status: "ok" as const,
            issued: await getDocumentById(o, member.organizationId, id),
          };
        },
      );

      if (outcome.status === "not_found") {
        return c.json({ error: "Documento nao encontrado" }, 404);
      }
      if (outcome.status === "outside_unit_scope") {
        return c.json(
          { error: "Documento fora do escopo da unidade ativa" },
          403,
        );
      }
      if (outcome.status === "not_draft") {
        return c.json({ error: "Documento ja foi emitido ou encerrado" }, 400);
      }

      return c.json({ data: outcome.issued });
    },
  )
  .post(
    "/:id/void",
    ...withLabPermission({ financial: ["document_void"] }),
    zValidator("json", VoidDocumentSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (!Number.isInteger(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const outcome = await orgDb(member.organizationId).transaction(
        async (o) => {
          const existing = await getDocumentById(o, member.organizationId, id);
          if (!existing) return { status: "not_found" as const };

          if (isDocumentOutsideActiveUnitScope(member, existing.unitId)) {
            return { status: "outside_unit_scope" as const };
          }

          if (existing.status === "VOID") {
            return { status: "already_void" as const };
          }

          await o
            .update(billingDocument)
            .set({
              status: "VOID",
              voidReason: input.reason,
              voidedBy: session.user.id,
              updatedAt: new Date(),
              updatedBy: session.user.id,
            })
            .where(eq(billingDocument.id, id));

          await o
            .update(receivableInstallment)
            .set({
              status: "VOID",
              updatedAt: new Date(),
            })
            .where(eq(receivableInstallment.documentId, id));

          await o.insert(financialAuditLog).values({
            organizationId: member.organizationId,
            entityType: "document",
            entityId: String(id),
            action: "document.void",
            changes: {
              reason: input.reason,
            },
            performedBy: session.user.id,
            reason: input.reason,
          });

          return {
            status: "ok" as const,
            voided: await getDocumentById(o, member.organizationId, id),
          };
        },
      );

      if (outcome.status === "not_found") {
        return c.json({ error: "Documento nao encontrado" }, 404);
      }
      if (outcome.status === "outside_unit_scope") {
        return c.json(
          { error: "Documento fora do escopo da unidade ativa" },
          403,
        );
      }
      if (outcome.status === "already_void") {
        return c.json({ error: "Documento ja esta anulado" }, 400);
      }

      return c.json({ data: outcome.voided });
    },
  );
