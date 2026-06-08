import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
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
  calculateFinancialDueDate,
} from "@calibra-facil/shared";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { requireFeature } from "../../middleware/tier-guard";
import {
  buildDefaultDueDate,
  ensureJobCommercialSnapshotFromJob,
  generateBillingDocumentNumber,
} from "../../lib/finance";
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

async function getDocumentById(organizationId: string, documentId: number) {
  const [document] = await db
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
    db
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
    db
      .select()
      .from(receivableInstallment)
      .where(eq(receivableInstallment.documentId, document.id))
      .orderBy(receivableInstallment.installmentNumber),
    db
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
    db
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

async function getDocumentByPublicId(organizationId: string, publicId: string) {
  const [row] = await db
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

  return getDocumentById(organizationId, row.id);
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
    requireFeature("financial"),
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

      const documents = await db
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
        .orderBy(desc(billingDocument.createdAt));

      return c.json({ data: documents });
    },
  )
  .get(
    "/eligible-jobs",
    ...withLabPermission({ financial: ["document_create"] }),
    requireFeature("financial"),
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

      const jobs = await db
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

      const existingLinks = await db
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
      const eligibleJobs = [];

      for (const job of jobs) {
        if (blockedJobIds.has(job.id)) {
          continue;
        }

        const snapshot = await ensureJobCommercialSnapshotFromJob({
          jobId: job.id,
          organizationId: member.organizationId,
        });

        eligibleJobs.push({
          ...job,
          priceCents: snapshot.priceCents ?? 0,
          paymentTermDays: snapshot.paymentTermDays,
          snapshotId: snapshot.id,
        });
      }

      return c.json({ data: eligibleJobs });
    },
  )
  .post(
    "/",
    ...withLabPermission({ financial: ["document_create"] }),
    requireFeature("financial"),
    zValidator("json", CreateDocumentSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const jobs = await db
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
        return c.json(
          { error: "Uma ou mais ordens nao foram encontradas" },
          404,
        );
      }

      const invalidJobs = jobs.filter(
        (job) => !["APPROVED", "SUPERSEDED"].includes(job.status),
      );
      if (invalidJobs.length > 0) {
        return c.json(
          {
            error: "Apenas ordens aprovadas ou retificadas podem ser faturadas",
          },
          400,
        );
      }

      const existingLinks = await db
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
        return c.json(
          {
            error: `Uma ou mais ordens ja possuem documento ativo (${existingLinks[0]?.documentNumber ?? "sem numero"})`,
          },
          400,
        );
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
            undefined,
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
        return c.json(
          {
            error:
              "A cobranca consolidada exige ordens do mesmo cliente, unidade e moeda",
          },
          400,
        );
      }

      if (input.mode === "single" && jobs.length !== 1) {
        return c.json(
          { error: "O modo por OS aceita apenas uma ordem por documento" },
          400,
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

      const [created] = await db.transaction(async (tx) => {
        const [document] = await tx
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
            createdBy: session.user.id,
            updatedBy: session.user.id,
          })
          .returning();

        if (!document) {
          throw new Error("Falha ao criar documento financeiro");
        }

        await tx.insert(billingDocumentItem).values(
          jobs.map((job, index) => ({
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

        await tx.insert(financialAuditLog).values({
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

        return [document];
      });

      return c.json({ data: created }, 201);
    },
  )
  .get(
    "/:id",
    ...withLabPermission({ financial: ["read"] }),
    requireFeature("financial"),
    async (c) => {
      const member = c.get("member");
      const publicId = c.req.param("id");

      const document = await getDocumentByPublicId(
        member.organizationId,
        publicId,
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
    },
  )
  .put(
    "/:id",
    ...withLabPermission({ financial: ["document_create"] }),
    requireFeature("financial"),
    zValidator("json", UpdateDocumentSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (!Number.isInteger(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const existing = await getDocumentById(member.organizationId, id);
      if (!existing) {
        return c.json({ error: "Documento nao encontrado" }, 404);
      }

      if (isDocumentOutsideActiveUnitScope(member, existing.unitId)) {
        return c.json(
          { error: "Documento fora do escopo da unidade ativa" },
          403,
        );
      }

      if (existing.status !== "DRAFT") {
        return c.json(
          { error: "Apenas documentos em rascunho podem ser editados" },
          400,
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
          item.description !== (item.snapshotServiceName ?? item.description) ||
          item.unitPriceCents !==
            (item.snapshotPriceCents ?? item.unitPriceCents)
        );
      });

      if (hasSnapshotDivergence && !input.reason?.trim()) {
        return c.json(
          { error: "Edicoes divergentes do snapshot exigem motivo" },
          400,
        );
      }

      const subtotalCents = nextItems.reduce(
        (sum, item) => sum + item.totalCents,
        0,
      );
      const discountCents = input.discountCents ?? 0;
      const totalCents = Math.max(subtotalCents - discountCents, 0);

      await db.transaction(async (tx) => {
        await tx
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
            updatedBy: session.user.id,
          })
          .where(eq(billingDocument.id, id));

        for (const item of nextItems) {
          await tx
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

        await tx.insert(financialAuditLog).values({
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
      });

      const updated = await getDocumentById(member.organizationId, id);
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/issue",
    ...withLabPermission({ financial: ["document_issue"] }),
    requireFeature("financial"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);

      if (!Number.isInteger(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const existing = await getDocumentById(member.organizationId, id);
      if (!existing) {
        return c.json({ error: "Documento nao encontrado" }, 404);
      }

      if (isDocumentOutsideActiveUnitScope(member, existing.unitId)) {
        return c.json(
          { error: "Documento fora do escopo da unidade ativa" },
          403,
        );
      }

      if (existing.status !== "DRAFT") {
        return c.json({ error: "Documento ja foi emitido ou encerrado" }, 400);
      }

      await db.transaction(async (tx) => {
        const documentNumber = await generateBillingDocumentNumber(
          member.organizationId,
          tx,
        );
        const issueDate = new Date();
        const effectiveDueDate =
          existing.dueDate instanceof Date &&
          existing.dueDate.getTime() > issueDate.getTime()
            ? existing.dueDate
            : calculateFinancialDueDate(
                issueDate,
                DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS,
              );

        await tx
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

        const [existingInstallment] = await tx
          .select({ id: receivableInstallment.id })
          .from(receivableInstallment)
          .where(eq(receivableInstallment.documentId, id))
          .limit(1);

        if (!existingInstallment) {
          await tx.insert(receivableInstallment).values({
            documentId: id,
            installmentNumber: 1,
            status: "OPEN",
            dueDate: effectiveDueDate,
            amountCents: existing.totalCents,
            currency: existing.currency,
          });
        }

        await tx.insert(financialAuditLog).values({
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
      });

      return c.json({ data: await getDocumentById(member.organizationId, id) });
    },
  )
  .post(
    "/:id/void",
    ...withLabPermission({ financial: ["document_void"] }),
    requireFeature("financial"),
    zValidator("json", VoidDocumentSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (!Number.isInteger(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const existing = await getDocumentById(member.organizationId, id);
      if (!existing) {
        return c.json({ error: "Documento nao encontrado" }, 404);
      }

      if (isDocumentOutsideActiveUnitScope(member, existing.unitId)) {
        return c.json(
          { error: "Documento fora do escopo da unidade ativa" },
          403,
        );
      }

      if (existing.status === "VOID") {
        return c.json({ error: "Documento ja esta anulado" }, 400);
      }

      await db.transaction(async (tx) => {
        await tx
          .update(billingDocument)
          .set({
            status: "VOID",
            voidReason: input.reason,
            voidedBy: session.user.id,
            updatedAt: new Date(),
            updatedBy: session.user.id,
          })
          .where(eq(billingDocument.id, id));

        await tx
          .update(receivableInstallment)
          .set({
            status: "VOID",
            updatedAt: new Date(),
          })
          .where(eq(receivableInstallment.documentId, id));

        await tx.insert(financialAuditLog).values({
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
      });

      return c.json({ data: await getDocumentById(member.organizationId, id) });
    },
  );
