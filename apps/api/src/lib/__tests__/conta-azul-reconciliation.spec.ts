import { describe, expect, it } from "vitest";
import {
  buildContaAzulReceivableInstallmentLinkMetadata,
  buildContaAzulReceivableEventLinkMetadata,
  buildContaAzulPaymentReceiptSummary,
  decimalToCents,
  extractBillingDocumentExternalId,
  extractReceivableItems,
  extractReceivableTotalItems,
  mapContaAzulPaymentMethod,
  matchContaAzulInstallmentToBillingDocument,
} from "../conta-azul-reconciliation";

describe("Conta Azul reconciliation helpers", () => {
  it("extracts receivable items from supported response envelopes", () => {
    const installment = {
      id: "installment-1",
      status: "PENDENTE",
    };

    expect(extractReceivableItems([installment])).toEqual([installment]);
    expect(extractReceivableItems({ items: [installment] })).toEqual([
      installment,
    ]);
    expect(extractReceivableItems({ itens: [installment] })).toEqual([
      installment,
    ]);
    expect(extractReceivableTotalItems([installment])).toBe(1);
    expect(
      extractReceivableTotalItems({ items: [installment], totalItems: 12 }),
    ).toBe(12);
    expect(
      extractReceivableTotalItems({ itens: [installment], itens_totais: 13 }),
    ).toBe(13);
    expect(extractReceivableTotalItems({ items: [installment] })).toBeNull();
  });

  it("matches Conta Azul installments back to CalibraFácil billing documents", () => {
    expect(
      extractBillingDocumentExternalId({
        id: "installment-1",
        status: "QUITADO",
        nota: "Origem CalibraFácil: billing_document:42",
      }),
    ).toBe("billing_document:42");

    expect(
      matchContaAzulInstallmentToBillingDocument({
        id: "installment-1",
        status: "QUITADO",
        indice: 2,
        descricao: "Fatura FIN-42",
        evento: {
          referencia: "billing_document:42",
        },
      }),
    ).toMatchObject({
      externalId: "billing_document:42",
      documentId: 42,
      installmentNumber: 2,
    });
  });

  it("normalizes payment methods and decimal amounts", () => {
    expect(mapContaAzulPaymentMethod("PIX")).toBe("PIX");
    expect(mapContaAzulPaymentMethod("BOLETO_BANCARIO")).toBe("BOLETO");
    expect(mapContaAzulPaymentMethod("DEPOSITO_BANCARIO")).toBe(
      "BANK_TRANSFER",
    );
    expect(mapContaAzulPaymentMethod("CHEQUE")).toBe("OTHER");
    expect(mapContaAzulPaymentMethod("DESCONHECIDO")).toBeNull();

    expect(decimalToCents(123.45)).toBe(12345);
    expect(decimalToCents(10.005)).toBe(1001);
    expect(decimalToCents(null)).toBeNull();
  });

  it("builds idempotent payment receipt summaries from Conta Azul parcels", () => {
    expect(
      buildContaAzulPaymentReceiptSummary({
        installment: {
          id: "installment-1",
          status: "RECEBIDO_PARCIAL",
          valor_pago: 50,
          metodo_pagamento: "PIX",
        },
        localAmountCents: 15000,
      }),
    ).toEqual({
      amountCents: 5000,
      paymentMethod: "PIX",
      reference: "conta_azul:installment-1",
    });

    expect(
      buildContaAzulPaymentReceiptSummary({
        installment: {
          id: "installment-2",
          status: "QUITADO",
        },
        localAmountCents: 15000,
      }),
    ).toEqual({
      amountCents: 15000,
      paymentMethod: "OTHER",
      reference: "conta_azul:installment-2",
    });

    expect(
      buildContaAzulPaymentReceiptSummary({
        installment: {
          id: "installment-3",
          status: "PENDENTE",
        },
        localAmountCents: 15000,
      }),
    ).toBeNull();
  });

  it("builds non-PII link metadata for polled receivable events", () => {
    const metadata = buildContaAzulReceivableEventLinkMetadata({
      installment: {
        id: "installment-1",
        status: "QUITADO",
        indice: 2,
        nota: "Origem CalibraFácil: billing_document:42",
        descricao: "Fatura FIN-42",
        evento: {
          id: "event-1",
          referencia: "billing_document:42",
        },
      },
      protocolId: "protocol-1",
    });

    expect(metadata).toEqual({
      provider: "conta_azul",
      resource: "financeiro/eventos-financeiros/contas-a-receber",
      source: "payment_poll",
      installmentId: "installment-1",
      installmentIndex: 2,
      protocolId: "protocol-1",
    });
    expect(JSON.stringify(metadata)).not.toContain("billing_document:42");
    expect(JSON.stringify(metadata)).not.toContain("FIN-42");
  });

  it("builds receivable installment link metadata for polled parcels", () => {
    const installment = {
      id: "installment-1",
      status: "QUITADO",
      indice: 2,
      nota: "Origem CalibraFácil: billing_document:42",
      evento: {
        id: "event-1",
        referencia: "billing_document:42",
      },
    };
    const matched = matchContaAzulInstallmentToBillingDocument(installment);

    if (!matched) {
      throw new Error("expected matched installment");
    }

    expect(
      buildContaAzulReceivableInstallmentLinkMetadata({
        installment,
        matched,
      }),
    ).toEqual({
      provider: "conta_azul",
      resource: "financeiro/eventos-financeiros/parcelas",
      source: "payment_poll",
      billingDocumentExternalId: "billing_document:42",
      installmentNumber: 2,
      eventId: "event-1",
    });
  });
});
