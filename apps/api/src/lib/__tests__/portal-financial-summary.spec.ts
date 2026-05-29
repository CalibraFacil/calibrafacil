import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceOrderFinancialStatus } from "@calibra-facil/shared";

const mocks = vi.hoisted(() => ({
  remoteDocumentLinks: [] as Array<{
    localEntityId: string;
    metadata: Record<string, unknown> | null;
  }>,
}));

vi.mock("@calibra-facil/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => mocks.remoteDocumentLinks),
      })),
    })),
  },
}));

import {
  resolvePortalFinancialDocumentHrefs,
  toPortalServiceOrderFinancialSummary,
} from "../portal-financial-summary";

function financialStatus(
  overrides: Partial<ServiceOrderFinancialStatus> = {},
): ServiceOrderFinancialStatus {
  return {
    serviceOrderId: 42,
    serviceOrderNumber: "OS-42",
    status: "AWAITING_PAYMENT",
    label: "Aguardando confirmação de pagamento",
    description: "Aguardando confirmação de pagamento",
    readinessStatus: "SENT",
    blockers: [],
    amountCents: 10000,
    currency: "BRL",
    billingDocument: {
      id: 7,
      documentNumber: "F-7",
      status: "ISSUED",
      exportStatus: "EXPORTED",
      issuedAt: "2026-05-01T12:00:00.000Z",
      dueDate: "2026-06-10T00:00:00.000Z",
      totalCents: 10000,
      currency: "BRL",
    },
    installments: [
      {
        id: 11,
        installmentNumber: 1,
        status: "OPEN",
        label: "Aguardando pagamento",
        amountCents: 10000,
        currency: "BRL",
        dueDate: "2026-06-10T00:00:00.000Z",
        paidAt: null,
        paymentMethod: null,
      },
    ],
    installmentsSummary: {
      total: 1,
      totalCents: 10000,
      paidCents: 0,
      openCents: 10000,
      overdueCents: 0,
      paidCount: 0,
      openCount: 1,
      overdueCount: 0,
      voidCount: 0,
    },
    receipts: [],
    fiscalDocument: {
      availability: "NONE",
      label: "Sem documento fiscal",
      number: null,
      issuedAt: null,
      accessKey: null,
      xmlAvailable: false,
      consultationOnly: true,
      lastSyncedAt: null,
    },
    freshness: {
      status: "fresh",
      lastSyncedAt: "2026-05-02T12:00:00.000Z",
      label: "Sincronizado",
    },
    providerEvidence: {
      label: "Sincronizado via Conta Azul",
      integrationState: "connected",
      reconnectPath: null,
    },
    ...overrides,
  };
}

describe("toPortalServiceOrderFinancialSummary", () => {
  beforeEach(() => {
    mocks.remoteDocumentLinks = [];
  });

  it("hides the portal card when the provider is absent or disconnected", () => {
    expect(
      toPortalServiceOrderFinancialSummary(
        financialStatus({ providerEvidence: null }),
      ),
    ).toMatchObject({ visible: false, state: null });

    expect(
      toPortalServiceOrderFinancialSummary(
        financialStatus({
          providerEvidence: {
            label: "Reconecte Conta Azul para atualizar o status",
            integrationState: "disconnected",
            reconnectPath: "/dashboard/settings/integrations#financial-erp",
          },
        }),
      ),
    ).toMatchObject({ visible: false, state: null });
  });

  it("maps an open exported document to payment pending without provider wording", () => {
    const summary = toPortalServiceOrderFinancialSummary(financialStatus());

    expect(summary).toMatchObject({
      visible: true,
      state: "PAYMENT_PENDING",
      dueDate: "2026-06-10T00:00:00.000Z",
      paidAt: null,
      openAmountCents: 10000,
      overdueAmountCents: 0,
      freshness: "fresh",
    });
    expect(JSON.stringify(summary)).not.toContain("Conta Azul");
    expect(JSON.stringify(summary)).not.toContain("ERP");
  });

  it("maps an exported invoice without installments to invoice available", () => {
    const summary = toPortalServiceOrderFinancialSummary(
      financialStatus({
        status: "INVOICE_AVAILABLE",
        installments: [],
      }),
    );

    expect(summary).toMatchObject({
      visible: true,
      state: "INVOICE_AVAILABLE",
      dueDate: "2026-06-10T00:00:00.000Z",
      paidAt: null,
      openAmountCents: 10000,
      overdueAmountCents: 0,
    });
  });

  it("maps paid evidence and exposes receipt and fiscal document rows", () => {
    const summary = toPortalServiceOrderFinancialSummary(
      financialStatus({
        status: "PAID",
        billingDocument: {
          id: 7,
          documentNumber: "F-7",
          status: "PAID",
          exportStatus: "EXPORTED",
          issuedAt: "2026-05-01T12:00:00.000Z",
          dueDate: "2026-06-10T00:00:00.000Z",
          totalCents: 10000,
          currency: "BRL",
        },
        installments: [
          {
            id: 11,
            installmentNumber: 1,
            status: "PAID",
            label: "Pago",
            amountCents: 10000,
            currency: "BRL",
            dueDate: "2026-06-10T00:00:00.000Z",
            paidAt: "2026-06-08T09:00:00.000Z",
            paymentMethod: "PIX",
          },
        ],
        receipts: [
          {
            id: 19,
            installmentId: 11,
            receivedAt: "2026-06-08T10:00:00.000Z",
            amountCents: 10000,
            paymentMethod: "PIX",
            reference: null,
          },
        ],
        fiscalDocument: {
          availability: "AVAILABLE",
          label: "Disponível",
          number: "123",
          issuedAt: "2026-06-09T10:00:00.000Z",
          accessKey: "access-key",
          xmlAvailable: true,
          consultationOnly: true,
          lastSyncedAt: "2026-06-09T10:30:00.000Z",
        },
      }),
    );

    expect(summary.state).toBe("PAID");
    expect(summary.dueDate).toBeNull();
    expect(summary.paidAt).toBe("2026-06-08T10:00:00.000Z");
    expect(summary.openAmountCents).toBe(0);
    expect(summary.documents.map((document) => document.label)).toEqual([
      "Fatura",
      "Documento fiscal",
      "Recibo",
    ]);
    expect(summary.documents.every((document) => document.href === null)).toBe(
      true,
    );
  });

  it("attaches customer-safe document hrefs supplied by the portal signer", () => {
    const summary = toPortalServiceOrderFinancialSummary(
      financialStatus({
        status: "PAID",
        billingDocument: {
          id: 7,
          documentNumber: "F-7",
          status: "PAID",
          exportStatus: "EXPORTED",
          issuedAt: "2026-05-01T12:00:00.000Z",
          dueDate: "2026-06-10T00:00:00.000Z",
          totalCents: 10000,
          currency: "BRL",
        },
        installments: [
          {
            id: 11,
            installmentNumber: 1,
            status: "PAID",
            label: "Pago",
            amountCents: 10000,
            currency: "BRL",
            dueDate: "2026-06-10T00:00:00.000Z",
            paidAt: "2026-06-08T09:00:00.000Z",
            paymentMethod: "PIX",
          },
        ],
        receipts: [
          {
            id: 19,
            installmentId: 11,
            receivedAt: "2026-06-08T10:00:00.000Z",
            amountCents: 10000,
            paymentMethod: "PIX",
            reference: null,
          },
        ],
        fiscalDocument: {
          availability: "AVAILABLE",
          label: "Disponível",
          number: "123",
          issuedAt: "2026-06-09T10:00:00.000Z",
          accessKey: "access-key",
          xmlAvailable: true,
          consultationOnly: true,
          lastSyncedAt: "2026-06-09T10:30:00.000Z",
        },
      }),
      {
        documentHrefs: {
          invoice: "https://signed.example/invoice.pdf",
          fiscalDocument: "https://signed.example/fiscal.xml",
          receipts: { 19: "https://signed.example/receipt.pdf" },
        },
      },
    );

    expect(summary.documents).toEqual([
      expect.objectContaining({
        kind: "invoice",
        href: "https://signed.example/invoice.pdf",
      }),
      expect.objectContaining({
        kind: "fiscal_document",
        href: "https://signed.example/fiscal.xml",
      }),
      expect.objectContaining({
        kind: "receipt",
        href: "https://signed.example/receipt.pdf",
      }),
    ]);
  });

  it("suppresses document rows that have neither a link nor availability evidence", () => {
    const summary = toPortalServiceOrderFinancialSummary(
      financialStatus({
        status: "PAID",
        billingDocument: {
          id: 7,
          documentNumber: "F-7",
          status: "PAID",
          exportStatus: "EXPORTED",
          issuedAt: null,
          dueDate: "2026-06-10T00:00:00.000Z",
          totalCents: 10000,
          currency: "BRL",
        },
        receipts: [
          {
            id: 19,
            installmentId: 11,
            receivedAt: "",
            amountCents: 10000,
            paymentMethod: "PIX",
            reference: null,
          },
        ],
        fiscalDocument: {
          availability: "AVAILABLE",
          label: "Disponível",
          number: null,
          issuedAt: null,
          accessKey: null,
          xmlAvailable: false,
          consultationOnly: true,
          lastSyncedAt: null,
        },
      }),
    );

    expect(summary.documents).toEqual([]);
  });

  it("clamps open amount to zero for a paid document with residual open installments", () => {
    const summary = toPortalServiceOrderFinancialSummary(
      financialStatus({
        status: "PAID",
        billingDocument: {
          id: 7,
          documentNumber: "F-7",
          status: "PAID",
          exportStatus: "EXPORTED",
          issuedAt: "2026-05-01T12:00:00.000Z",
          dueDate: "2026-06-10T00:00:00.000Z",
          totalCents: 10000,
          currency: "BRL",
        },
        installments: [
          {
            id: 11,
            installmentNumber: 1,
            status: "OPEN",
            label: "Aguardando pagamento",
            amountCents: 10000,
            currency: "BRL",
            dueDate: "2026-06-10T00:00:00.000Z",
            paidAt: null,
            paymentMethod: null,
          },
        ],
      }),
    );

    expect(summary.state).toBe("PAID");
    expect(summary.openAmountCents).toBe(0);
  });

  it("maps overdue only when there is an overdue amount", () => {
    const overdue = toPortalServiceOrderFinancialSummary(
      financialStatus({
        status: "OVERDUE",
        billingDocument: {
          id: 7,
          documentNumber: "F-7",
          status: "OVERDUE",
          exportStatus: "EXPORTED",
          issuedAt: "2026-05-01T12:00:00.000Z",
          dueDate: "2026-05-10T00:00:00.000Z",
          totalCents: 10000,
          currency: "BRL",
        },
        installments: [
          {
            id: 11,
            installmentNumber: 1,
            status: "OVERDUE",
            label: "Em atraso",
            amountCents: 10000,
            currency: "BRL",
            dueDate: "2026-05-10T00:00:00.000Z",
            paidAt: null,
            paymentMethod: null,
          },
        ],
      }),
    );
    expect(overdue.state).toBe("OVERDUE");
    expect(overdue.dueDate).toBe("2026-05-10T00:00:00.000Z");
    expect(overdue.overdueAmountCents).toBe(10000);

    const zeroAmount = toPortalServiceOrderFinancialSummary(
      financialStatus({
        status: "OVERDUE",
        billingDocument: {
          id: 7,
          documentNumber: "F-7",
          status: "OVERDUE",
          exportStatus: "EXPORTED",
          issuedAt: "2026-05-01T12:00:00.000Z",
          dueDate: "2026-05-10T00:00:00.000Z",
          totalCents: 10000,
          currency: "BRL",
        },
        installments: [],
      }),
    );
    expect(zeroAmount.state).toBe("PAYMENT_PENDING");
    expect(zeroAmount.overdueAmountCents).toBe(0);
  });

  it("keeps stale provider states as last-known customer state", () => {
    const summary = toPortalServiceOrderFinancialSummary(
      financialStatus({
        status: "STATUS_UNAVAILABLE",
        freshness: {
          status: "stale",
          lastSyncedAt: "2026-05-02T12:00:00.000Z",
          label: "Sincronizado com avisos",
        },
      }),
    );

    expect(summary.visible).toBe(true);
    expect(summary.state).toBe("PAYMENT_PENDING");
    expect(summary.freshness).toBe("stale");
  });

  it("hides local blockers and service orders without a billing document", () => {
    expect(
      toPortalServiceOrderFinancialSummary(
        financialStatus({
          status: "READY_FOR_BILLING",
          billingDocument: null,
          installments: [],
        }),
      ),
    ).toMatchObject({ visible: false, state: null });
  });

  it("hides void billing documents on the service-order surface", () => {
    expect(
      toPortalServiceOrderFinancialSummary(
        financialStatus({
          status: "VOID",
          billingDocument: {
            id: 7,
            documentNumber: "F-7",
            status: "VOID",
            exportStatus: "EXPORTED",
            issuedAt: "2026-05-01T12:00:00.000Z",
            dueDate: "2026-06-10T00:00:00.000Z",
            totalCents: 10000,
            currency: "BRL",
          },
          installments: [],
        }),
      ),
    ).toMatchObject({ visible: false, state: null });
  });
});

describe("resolvePortalFinancialDocumentHrefs", () => {
  beforeEach(() => {
    mocks.remoteDocumentLinks = [];
  });

  it("resolves signed links for valid local invoice, fiscal, and receipt artifacts", async () => {
    const signer = vi.fn(async (r2Key: string) => `https://signed/${r2Key}`);
    mocks.remoteDocumentLinks = [
      {
        localEntityId: "billing_document:7:sale_pdf",
        metadata: { documentKind: "sale_pdf", r2Key: "invoices/7.pdf" },
      },
      {
        localEntityId: "nfe:access-key:xml",
        metadata: {
          documentKind: "fiscal_xml",
          localArtifact: { xmlR2Key: "fiscal/access-key.xml" },
        },
      },
      {
        localEntityId: "payment_receipt:19:pdf",
        metadata: {
          documentKind: "receipt_pdf",
          localArtifact: { r2Key: "receipts/19.pdf" },
        },
      },
    ];

    await expect(
      resolvePortalFinancialDocumentHrefs({
        organizationId: "lab-org-1",
        billingDocumentId: 7,
        fiscalAccessKey: "access-key",
        receiptIds: [19],
        signer,
      }),
    ).resolves.toEqual({
      invoice: "https://signed/invoices/7.pdf",
      fiscalDocument: "https://signed/fiscal/access-key.xml",
      receipts: { 19: "https://signed/receipts/19.pdf" },
    });
  });

  it("ignores pending, unavailable, mismatched, and malformed remote-document links", async () => {
    const signer = vi.fn(async (r2Key: string) => `https://signed/${r2Key}`);
    mocks.remoteDocumentLinks = [
      {
        localEntityId: "billing_document:7:sale_pdf",
        metadata: { documentKind: "sale_pdf", r2Key: "pending/invoice.pdf" },
      },
      {
        localEntityId: "billing_document:8:sale_pdf",
        metadata: {
          documentKind: "sale_pdf",
          r2Key: "invoices/unavailable.pdf",
          status: "unavailable",
        },
      },
      {
        localEntityId: "receipt:20:pdf",
        metadata: { documentKind: "sale_pdf", r2Key: "receipts/wrong.pdf" },
      },
      {
        localEntityId: "payment_receipt:19abc:pdf",
        metadata: { documentKind: "receipt_pdf", r2Key: "receipts/19.pdf" },
      },
    ];

    await expect(
      resolvePortalFinancialDocumentHrefs({
        organizationId: "lab-org-1",
        billingDocumentId: 7,
        fiscalAccessKey: "access-key",
        receiptIds: [19, 20],
        signer,
      }),
    ).resolves.toEqual({
      invoice: null,
      fiscalDocument: null,
      receipts: {},
    });
  });
});
