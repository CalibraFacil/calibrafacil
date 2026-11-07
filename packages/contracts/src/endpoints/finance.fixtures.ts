import type {
  BillingDocumentListItem,
  CashForecastEnvelope,
  FinanceOverview,
} from "./finance";

/**
 * Contract-valid example payloads for the finance endpoints, for tests in any
 * package. `finance.test.ts` parses every builder against its response schema.
 */

export function buildBillingDocumentListItem(
  overrides: Partial<BillingDocumentListItem> = {},
): BillingDocumentListItem {
  return {
    id: 1,
    publicId: "doc-1",
    documentNumber: "FAT-2026-0001",
    status: "ISSUED",
    customerId: 1,
    customerName: "Metalúrgica Alfa Ltda",
    unitId: 1,
    unitName: "Matriz",
    issueDate: "2026-05-01T00:00:00.000Z",
    dueDate: "2026-05-29T00:00:00.000Z",
    subtotalCents: 10000,
    discountCents: 0,
    totalCents: 10000,
    currency: "BRL",
    exportStatus: "NOT_EXPORTED",
    exportedAt: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

export function buildFinanceOverview(): FinanceOverview {
  return {
    totals: {
      issuedCents: 10000,
      openCents: 10000,
      overdueCents: 0,
      receivedCents: 0,
    },
    counts: {
      draftDocuments: 0,
      issuedDocuments: 1,
      overdueDocuments: 0,
      paidDocuments: 0,
    },
    aging: { "0_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0 },
    recentDocuments: [
      {
        id: 1,
        publicId: "doc-1",
        documentNumber: "FAT-2026-0001",
        status: "ISSUED",
        exportStatus: "NOT_EXPORTED",
        totalCents: 10000,
        dueDate: "2026-05-29T00:00:00.000Z",
        issueDate: "2026-05-01T00:00:00.000Z",
        customerName: "Metalúrgica Alfa Ltda",
        unitName: "Matriz",
      },
    ],
    pendingExports: 1,
  };
}

export function buildCashForecast(): CashForecastEnvelope {
  const empty = { confirmedCents: 0, projectedCents: 0, confirmedCount: 0 };
  return {
    buckets: {
      OVERDUE: empty,
      THIS_WEEK: {
        confirmedCents: 10000,
        projectedCents: 0,
        confirmedCount: 1,
      },
      NEXT_WEEK: empty,
      IN_30_DAYS: empty,
      IN_60_DAYS: empty,
      IN_90_DAYS: empty,
    },
    totals: { confirmedCents: 10000, projectedCents: 0, overdueCents: 0 },
  };
}
