import type {
  FinancialPaymentMethod,
  IntegrationSyncCursor,
} from "@calibra-facil/shared";
import type {
  ContaAzulInstallment,
  ContaAzulReceivableSearchResponse,
} from "./conta-azul-client";

export type ContaAzulMatchedInstallment = {
  externalId: string;
  documentId: number;
  installmentNumber: number;
  installment: ContaAzulInstallment;
};

const BILLING_DOCUMENT_REF_PATTERN = /billing_document:(\d+)/i;

export function decimalToCents(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function extractReceivableItems(
  response: ContaAzulReceivableSearchResponse | ContaAzulInstallment[],
) {
  if (Array.isArray(response)) return response;
  return response.items ?? response.itens ?? [];
}

export function extractReceivableTotalItems(
  response: ContaAzulReceivableSearchResponse | ContaAzulInstallment[],
) {
  if (Array.isArray(response)) return response.length;

  const total = response.totalItems ?? response.itens_totais;
  return typeof total === "number" && Number.isFinite(total) && total >= 0
    ? total
    : null;
}

export function extractBillingDocumentExternalId(
  installment: ContaAzulInstallment,
) {
  const candidates = [
    installment.nota,
    installment.descricao,
    installment.evento?.referencia,
  ];

  for (const candidate of candidates) {
    const match = candidate?.match(BILLING_DOCUMENT_REF_PATTERN);
    if (match?.[1]) {
      return `billing_document:${match[1]}`;
    }
  }

  return null;
}

export function matchContaAzulInstallmentToBillingDocument(
  installment: ContaAzulInstallment,
): ContaAzulMatchedInstallment | null {
  const externalId = extractBillingDocumentExternalId(installment);
  if (!externalId) return null;

  const documentId = Number(externalId.slice("billing_document:".length));
  if (!Number.isInteger(documentId) || documentId <= 0) return null;

  const installmentNumber =
    typeof installment.indice === "number" &&
    Number.isInteger(installment.indice) &&
    installment.indice > 0
      ? installment.indice
      : 1;

  return {
    externalId,
    documentId,
    installmentNumber,
    installment,
  };
}

export function mapContaAzulPaymentMethod(
  method: string | null | undefined,
): FinancialPaymentMethod | null {
  switch (method) {
    case "CARTAO_CREDITO":
    case "CARTAO_CREDITO_VIA_LINK":
      return "CREDIT_CARD";
    case "PIX":
      return "PIX";
    case "BOLETO_BANCARIO":
      return "BOLETO";
    case "TRANSFERENCIA_BANCARIA":
    case "DEPOSITO_BANCARIO":
      return "BANK_TRANSFER";
    case "DINHEIRO":
      return "CASH";
    case "CHEQUE":
    case "CARTAO_DEBITO":
    case "OUTRO":
    case "CARTEIRA_DIGITAL":
    case "CASHBACK":
      return "OTHER";
    default:
      return null;
  }
}

export function buildContaAzulPaymentReceiptSummary(params: {
  installment: ContaAzulInstallment;
  localAmountCents: number;
}) {
  const amountCents =
    decimalToCents(params.installment.valor_pago) ??
    (params.installment.status === "QUITADO" ? params.localAmountCents : null);

  if (amountCents === null || amountCents <= 0) return null;

  return {
    amountCents,
    paymentMethod:
      mapContaAzulPaymentMethod(params.installment.metodo_pagamento) ?? "OTHER",
    reference: `conta_azul:${params.installment.id}`,
  };
}

export function buildContaAzulPollingCursor(params: {
  previousCursor: IntegrationSyncCursor;
  nextLastRemoteUpdatedAt: string;
  processedCount: number;
  updatedCount: number;
}): IntegrationSyncCursor {
  return {
    ...params.previousCursor,
    lastRemoteUpdatedAt: params.nextLastRemoteUpdatedAt,
    lastSuccessfulPollAt: new Date().toISOString(),
    nextPage: null,
    state: {
      ...params.previousCursor.state,
      processedCount: params.processedCount,
      updatedCount: params.updatedCount,
    },
  };
}

export function buildContaAzulReceivableEventLinkMetadata(params: {
  installment: ContaAzulInstallment;
  protocolId?: string | null;
}) {
  return {
    provider: "conta_azul",
    resource: "financeiro/eventos-financeiros/contas-a-receber",
    source: "payment_poll",
    installmentId: params.installment.id,
    ...(typeof params.installment.indice === "number"
      ? { installmentIndex: params.installment.indice }
      : {}),
    ...(params.protocolId ? { protocolId: params.protocolId } : {}),
  };
}

export function buildContaAzulReceivableInstallmentLinkMetadata(params: {
  installment: ContaAzulInstallment;
  matched: ContaAzulMatchedInstallment;
}) {
  return {
    provider: "conta_azul",
    resource: "financeiro/eventos-financeiros/parcelas",
    source: "payment_poll",
    billingDocumentExternalId: params.matched.externalId,
    installmentNumber: params.matched.installmentNumber,
    ...(params.installment.evento?.id
      ? { eventId: params.installment.evento.id }
      : {}),
  };
}
