import type {
  ServiceOrderCreateResponse,
  ServiceOrderDetail,
  ServiceOrdersListResponse,
} from "./service-orders";

/**
 * Contract-valid example payloads for the service-order endpoints, for tests in
 * any package. `service-orders.test.ts` parses every builder against its
 * response schema.
 */

export function buildServiceOrdersListResponse(): ServiceOrdersListResponse {
  return {
    data: [
      {
        id: 1,
        publicId: "so_0001",
        serviceOrderNumber: "OS-2026-0001",
        customerName: "Metalúrgica Alfa Ltda",
        assetName: "Balança 300 kg",
        assetSerialNumber: "SN-1",
        status: "opened",
        statusLabel: "Aberta",
        priority: "normal",
        responsibleTechnicianName: null,
        openedAt: "2026-01-10T12:00:00.000Z",
        quotedAt: null,
        approvedAt: null,
        totalApprovedCents: 0,
        totalQuotedCents: 0,
        unitName: "Matriz",
      },
    ],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  };
}

export function buildServiceOrderCreateResponse(): ServiceOrderCreateResponse {
  return {
    data: { id: 1, publicId: "so_0001", serviceOrderNumber: "OS-2026-0001" },
  };
}

export function buildServiceOrderDetail(
  overrides: Partial<ServiceOrderDetail> = {},
): ServiceOrderDetail {
  return {
    id: 1,
    publicId: "so_0001",
    serviceOrderNumber: "OS-2026-0001",
    status: "opened",
    statusLabel: "Aberta",
    priority: "normal",
    customerId: 1,
    customerName: "Metalúrgica Alfa Ltda",
    assetId: 1,
    assetName: "Balança 300 kg",
    assetSerialNumber: "SN-1",
    unitName: "Matriz",
    responsibleTechnicianId: null,
    claimedDefect: "Não liga",
    intakeCondition: "Riscos na carcaça",
    accessories: null,
    intakeType: "counter",
    deliveryMethod: "pickup_at_lab",
    clientVisibleNotes: null,
    internalNotes: null,
    openedAt: "2026-01-10T12:00:00.000Z",
    updatedAt: "2026-01-10T12:00:00.000Z",
    assetSnapshot: null,
    evaluations: [],
    quotes: [],
    execution: null,
    deliveryDocuments: [],
    events: [],
    ...overrides,
  };
}
