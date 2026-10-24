import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  billingDocument,
  integrationConnection,
  financialAuditLog,
  paymentReceipt,
  receivableInstallment,
} from "@calibra-facil/db/schema";
import { recomputeCertificateReleasesForBillingDocument } from "../../lib/certificate-release-reconciliation";
import { inOrgTransaction } from "../../lib/org-transaction";
import {
  normalizeContaAzulConnectionConfig,
  type IntegrationSyncCursor,
  type RemoteStatusPollResult,
} from "@calibra-facil/shared";
import { and, eq } from "drizzle-orm";
import { type ContaAzulReceivableSearchResponse } from "../../lib/conta-azul-client";
import {
  buildContaAzulReceivableInstallmentLinkMetadata,
  buildContaAzulReceivableEventLinkMetadata,
  buildContaAzulPaymentReceiptSummary,
  extractReceivableItems,
  extractReceivableTotalItems,
  matchContaAzulInstallmentToBillingDocument,
} from "../../lib/conta-azul-reconciliation";
import { mapContaAzulInstallmentStatus } from "../../lib/conta-azul-mappers";
import type { IntegrationsEnv } from "../../lib/integrations-env";
import { getIntegrationRecord, writeIntegrationEvent } from "./records";
import {
  getIntegrationCursor,
  readCursorStateText,
  upsertIntegrationCursor,
} from "./conta-azul-schedule-state";
import { CONTA_AZUL_RECEIVABLES_CURSOR_TYPE } from "./constants";
import { formatContaAzulDateTime, parseRemoteDate } from "./conta-azul-due";
import { createContaAzulClientForRecord } from "./conta-azul-auth";
import { getExistingLink, upsertLink } from "./sync-state";

async function getDocumentStatusAfterInstallmentUpdate(
  o: OrgDb,
  documentId: number,
) {
  const installments = await o
    .select({ status: receivableInstallment.status })
    .from(receivableInstallment)
    .where(eq(receivableInstallment.documentId, documentId));

  if (
    installments.length > 0 &&
    installments.every((row) => row.status === "PAID")
  ) {
    return "PAID" as const;
  }
  if (installments.some((row) => row.status === "OVERDUE")) {
    return "OVERDUE" as const;
  }
  if (
    installments.length > 0 &&
    installments.every((row) => row.status === "VOID")
  ) {
    return "VOID" as const;
  }

  return "ISSUED" as const;
}

async function upsertContaAzulPaymentReceipt(
  o: OrgDb,
  params: {
    organizationId: string;
    recordedBy: string;
    installmentId: number;
    remoteInstallmentId: string;
    receivedAt: Date;
    amountCents: number;
    paymentMethod: NonNullable<
      typeof paymentReceipt.$inferInsert.paymentMethod
    >;
    reference: string;
  },
) {
  const [existing] = await o
    .select({ id: paymentReceipt.id })
    .from(paymentReceipt)
    .where(
      and(
        eq(paymentReceipt.installmentId, params.installmentId),
        eq(paymentReceipt.reference, params.reference),
      ),
    )
    .limit(1);

  if (existing) {
    await o
      .update(paymentReceipt)
      .set({
        receivedAt: params.receivedAt,
        amountCents: params.amountCents,
        paymentMethod: params.paymentMethod,
        notes: "Reconciliado automaticamente pela Conta Azul",
        updatedAt: new Date(),
      })
      .where(eq(paymentReceipt.id, existing.id));
    return existing.id;
  }

  const [created] = await o
    .insert(paymentReceipt)
    .values({
      organizationId: params.organizationId,
      installmentId: params.installmentId,
      recordedBy: params.recordedBy,
      receivedAt: params.receivedAt,
      amountCents: params.amountCents,
      paymentMethod: params.paymentMethod,
      reference: params.reference,
      notes: "Reconciliado automaticamente pela Conta Azul",
    })
    .returning();

  await o.insert(financialAuditLog).values({
    organizationId: params.organizationId,
    entityType: "receipt",
    entityId: String(created?.id ?? params.installmentId),
    action: "receipt.reconciled.conta_azul",
    changes: {
      installmentId: params.installmentId,
      remoteInstallmentId: params.remoteInstallmentId,
      amountCents: params.amountCents,
      paymentMethod: params.paymentMethod,
      receivedAt: params.receivedAt.toISOString(),
    },
    performedBy: params.recordedBy,
    reason: "Reconciliado automaticamente pela Conta Azul",
  });

  return created?.id ?? null;
}

export async function pollContaAzulBillingStatus(params: {
  integrationId: string;
  organizationId: string;
  env: IntegrationsEnv;
  limit?: number;
  now?: Date;
}): Promise<RemoteStatusPollResult> {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (!record || record.integration.provider !== "conta_azul") {
    throw new Error("Integração Conta Azul não encontrada");
  }

  const config = normalizeContaAzulConnectionConfig(record.connection.config);
  if (!config.enabledTargets.paymentStatusPolling) {
    throw new Error("Polling de pagamentos da Conta Azul está desativado");
  }

  const now = params.now ?? new Date();
  const storedCursor = await getIntegrationCursor({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    cursorType: CONTA_AZUL_RECEIVABLES_CURSOR_TYPE,
  });
  const lastRemoteUpdatedAt =
    storedCursor?.lastRemoteUpdatedAt?.toISOString() ??
    config.polling.receivablesLastRemoteUpdatedAt;
  const pendingNextPage =
    typeof storedCursor?.nextPage === "number" && storedCursor.nextPage > 0
      ? storedCursor.nextPage
      : null;
  const pendingWindowEndAt = parseRemoteDate(
    readCursorStateText(storedCursor, "windowEndAt"),
  );
  const windowEnd =
    pendingNextPage && pendingWindowEndAt ? pendingWindowEndAt : now;
  const from = lastRemoteUpdatedAt
    ? (parseRemoteDate(lastRemoteUpdatedAt) ??
      new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const requestedLimit = Math.max(1, Math.min(params.limit ?? 50, 500));
  const pageSize = Math.min(requestedLimit, 100);
  const client = await createContaAzulClientForRecord({
    record,
    env: params.env,
  });
  const items: ReturnType<typeof extractReceivableItems> = [];
  let page = pendingNextPage ?? 1;
  let totalItems: number | null = null;
  let nextPage: number | null = null;

  while (items.length < requestedLimit) {
    const response =
      await client.searchReceivableEvents<ContaAzulReceivableSearchResponse>({
        pagina: page,
        tamanho_pagina: pageSize,
        data_alteracao_de: formatContaAzulDateTime(from),
        data_alteracao_ate: formatContaAzulDateTime(windowEnd),
      });
    const pageItems = extractReceivableItems(response);
    totalItems = extractReceivableTotalItems(response);
    const remainingLimit = requestedLimit - items.length;
    const consumedItems = pageItems.slice(0, remainingLimit);

    items.push(...consumedItems);

    if (consumedItems.length < pageItems.length) {
      nextPage = page;
      break;
    }

    const hasMorePages =
      pageItems.length >= pageSize &&
      (totalItems === null || page * pageSize < totalItems);
    if (!hasMorePages) {
      break;
    }

    if (items.length >= requestedLimit) {
      nextPage = page + 1;
      break;
    }

    page += 1;
  }

  let updatedCount = 0;
  const warnings: string[] = [];

  for (const item of items) {
    const matched = matchContaAzulInstallmentToBillingDocument(item);
    if (!matched) {
      warnings.push(`Parcela ${item.id} sem referência CalibraFácil`);
      continue;
    }

    // The installment, its receipt and the document status are one unit of
    // work (no remote call inside): one transaction per item.
    const reconciled = await inOrgTransaction(
      params.organizationId,
      undefined,
      async (o) => {
        const [localInstallment] = await o
          .select({
            id: receivableInstallment.id,
            documentId: receivableInstallment.documentId,
            amountCents: receivableInstallment.amountCents,
            documentStatus: billingDocument.status,
          })
          .from(receivableInstallment)
          .innerJoin(
            billingDocument,
            eq(receivableInstallment.documentId, billingDocument.id),
          )
          .where(
            and(
              eq(billingDocument.id, matched.documentId),
              eq(billingDocument.organizationId, params.organizationId),
              eq(
                receivableInstallment.installmentNumber,
                matched.installmentNumber,
              ),
            ),
          )
          .limit(1);

        if (!localInstallment) {
          return null;
        }

        const mapped = mapContaAzulInstallmentStatus(item);
        const dueDate = parseRemoteDate(item.data_vencimento);
        const paidAt =
          mapped.installmentStatus === "PAID"
            ? (parseRemoteDate(item.data_pagamento) ??
              parseRemoteDate(item.data_alteracao) ??
              now)
            : null;
        const receiptSummary = buildContaAzulPaymentReceiptSummary({
          installment: item,
          localAmountCents: localInstallment.amountCents,
        });

        await o
          .update(receivableInstallment)
          .set({
            status: mapped.installmentStatus,
            ...(dueDate ? { dueDate } : {}),
            paidAt,
            paymentMethod: receiptSummary?.paymentMethod ?? null,
            paymentReference: item.nsu ?? item.id,
            updatedAt: new Date(),
          })
          .where(eq(receivableInstallment.id, localInstallment.id));

        if (receiptSummary) {
          await upsertContaAzulPaymentReceipt(o, {
            organizationId: params.organizationId,
            recordedBy: record.integration.createdBy,
            installmentId: localInstallment.id,
            remoteInstallmentId: item.id,
            receivedAt:
              parseRemoteDate(item.data_pagamento) ??
              parseRemoteDate(item.data_alteracao) ??
              now,
            amountCents: receiptSummary.amountCents,
            paymentMethod: receiptSummary.paymentMethod,
            reference: receiptSummary.reference,
          });
        }

        const documentStatus = await getDocumentStatusAfterInstallmentUpdate(
          o,
          localInstallment.documentId,
        );

        if (localInstallment.documentStatus !== "VOID") {
          await o
            .update(billingDocument)
            .set({
              status: documentStatus,
              updatedAt: new Date(),
            })
            .where(eq(billingDocument.id, localInstallment.documentId));
        }

        return { localInstallment, mapped, receiptSummary };
      },
    );

    if (!reconciled) {
      warnings.push(`Parcela local não encontrada para ${matched.externalId}`);
      continue;
    }
    const { localInstallment, mapped, receiptSummary } = reconciled;

    // Phase 2 slice 1: recompute certificate release state for any
    // calibration jobs linked (via service_order_certificate_link) to a
    // service order pointing at this billing document. Read-only with
    // respect to calibration_job.status / issued_certificate_snapshot.status.
    // It runs after the reconciliation above has committed (it reads it back).
    await recomputeCertificateReleasesForBillingDocument({
      organizationId: params.organizationId,
      billingDocumentId: localInstallment.documentId,
    });

    if (item.evento?.id) {
      const billingDocumentLink = await getExistingLink(
        params.organizationId,
        params.integrationId,
        "billing_document",
        matched.externalId,
      );
      const protocolId =
        billingDocumentLink?.remoteEntityType ===
          "conta_azul_receivable_protocol" &&
        billingDocumentLink.remoteEntityId !== item.evento.id
          ? billingDocumentLink.remoteEntityId
          : null;

      await upsertLink({
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        target: "billing_document",
        localEntityId: matched.externalId,
        remoteEntityId: item.evento.id,
        remoteDisplayId: item.evento.id,
        remoteEntityType: "conta_azul_receivable_event",
        metadata: buildContaAzulReceivableEventLinkMetadata({
          installment: item,
          protocolId,
        }),
      });
    }

    await upsertLink({
      integrationId: params.integrationId,
      organizationId: params.organizationId,
      target: "receivable_installment",
      localEntityId: `receivable_installment:${localInstallment.id}`,
      remoteEntityId: item.id,
      remoteDisplayId: item.id,
      remoteEntityType: "conta_azul_receivable_installment",
      metadata: buildContaAzulReceivableInstallmentLinkMetadata({
        installment: item,
        matched,
      }),
    });

    if (mapped.requiresReview) {
      warnings.push(`Parcela ${item.id} requer revisão manual`);
    }
    if (receiptSummary && mapped.installmentStatus !== "PAID") {
      warnings.push(`Parcela ${item.id} possui pagamento parcial`);
    }

    updatedCount += 1;
  }

  const completedWindow = nextPage === null;
  const nextLastRemoteUpdatedAt = completedWindow
    ? windowEnd.toISOString()
    : lastRemoteUpdatedAt;
  const nextConfig = normalizeContaAzulConnectionConfig({
    ...config,
    polling: {
      ...config.polling,
      receivablesLastRemoteUpdatedAt:
        nextLastRemoteUpdatedAt ??
        config.polling.receivablesLastRemoteUpdatedAt,
    },
  });

  const cursor: IntegrationSyncCursor = {
    cursorType: CONTA_AZUL_RECEIVABLES_CURSOR_TYPE,
    lastRemoteUpdatedAt: nextLastRemoteUpdatedAt,
    lastSuccessfulPollAt: now.toISOString(),
    nextPage,
    state: {
      processedCount: items.length,
      updatedCount,
      requestedLimit,
      pageSize,
      totalItems,
      ...(nextPage ? { windowEndAt: windowEnd.toISOString() } : {}),
    },
  };

  // The poll's bookkeeping (config watermark, cursor, event) commits together.
  await inOrgTransaction(params.organizationId, undefined, async (o) => {
    await o
      .update(integrationConnection)
      .set({
        config: nextConfig,
        updatedAt: new Date(),
      })
      .where(eq(integrationConnection.id, record.connection.id));

    await upsertIntegrationCursor(
      {
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        cursor,
      },
      o,
    );

    await writeIntegrationEvent(
      {
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        level: warnings.length > 0 ? "warning" : "info",
        event: "integration.conta_azul.payment_poll.completed",
        message: "Polling de pagamentos da Conta Azul concluído",
        details: {
          processedCount: items.length,
          updatedCount,
          warnings,
        },
      },
      o,
    );
  });

  return {
    processedCount: items.length,
    updatedCount,
    cursor,
    warnings,
  };
}
