import type { z } from "zod";
import type {
  CreateServiceOrderSchema,
  UpdateServiceOrderSchema,
} from "@calibra-facil/schemas";

export type ServiceOrderStatus = string;

export type ServiceOrderListItem = {
  id: number;
  serviceOrderNumber: string;
  customerName: string;
  assetName: string;
  assetSerialNumber: string | null;
  status: ServiceOrderStatus;
  statusLabel: string;
  priority: string;
  responsibleTechnicianName: string | null;
  openedAt: string;
  quotedAt: string | null;
  approvedAt: string | null;
  totalApprovedCents: number;
  totalQuotedCents: number;
  unitName: string | null;
};

export type ServiceOrderDetail = {
  id: number;
  serviceOrderNumber: string;
  organizationName?: string | null;
  organizationCnpj?: string | null;
  organizationPhone?: string | null;
  organizationEmail?: string | null;
  organizationStreet?: string | null;
  organizationNumber?: string | null;
  organizationNeighbourhood?: string | null;
  organizationCity?: string | null;
  organizationState?: string | null;
  organizationCep?: string | null;
  priority: string;
  statusLabel: string;
  customerName: string;
  customerTaxId?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  assetName: string;
  assetTag?: string | null;
  assetSerialNumber?: string | null;
  unitName?: string | null;
  assetSnapshot?: {
    assetName: string;
    assetType?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    serialNumber?: string | null;
    patrimonyNumber?: string | null;
    capacity?: string | null;
    resolution?: string | null;
    observedIdentification?: string | null;
  } | null;
  claimedDefect: string;
  intakeCondition: string;
  accessories?: string | null;
  invoiceRemittanceNumber?: string | null;
  invoiceRemittanceKey?: string | null;
  carrierName?: string | null;
  thirdPartyName?: string | null;
  removedSealingMarkNumber?: string | null;
  affixedSealingMarkNumber?: string | null;
  inmetroRepairMarkNumber?: string | null;
  inmetroRepairMarkIssuedAt?: string | null;
  inmetroRepairMarkAppliedAt?: string | null;
  inmetroRepairMarkNotes?: string | null;
  deliveredAt?: string | null;
  deliveredToName?: string | null;
  deliveredToDocument?: string | null;
  deliveryMethod?: "pickup_at_lab" | "ship_to_client" | "third_party_pickup";
  deliveryNotes?: string | null;
  clientVisibleNotes?: string | null;
  internalNotes?: string | null;
  openedAt: string;
  evaluations: Array<Record<string, unknown>>;
  quotes: Array<{
    id: number;
    status: string;
    totalCents: number;
    version: number;
    validUntil?: string | null;
    paymentTerms?: string | null;
    deliveryEstimate?: string | null;
    warrantyTerms?: string | null;
    clientMessage?: string | null;
    subtotalServicesCents?: number;
    subtotalPartsCents?: number;
    freightCents?: number;
    discountCents?: number;
    items: Array<{
      id: number;
      type: string;
      description: string;
      quantity: number;
      unit: string;
      unitPriceCents: number;
      totalPriceCents: number;
      taxable?: boolean;
      warrantyCovered?: boolean;
      notes?: string | null;
    }>;
  }>;
  execution?: {
    id: number;
    startedAt: string;
    finishedAt?: string | null;
    servicePerformed?: string | null;
    partsUsedSummary?: string | null;
    technicalNotes?: string | null;
    calibrationRequiredAfterRepair: boolean;
    result?: string | null;
    items: Array<Record<string, unknown>>;
  } | null;
  deliveryDocuments: Array<{
    id: number;
    documentNumber: string;
    version: number;
    pdfR2Key?: string | null;
    issuedAt?: string | null;
  }>;
  events: Array<{
    id: number;
    eventType: string;
    actorType?: string | null;
    actorName?: string | null;
    createdAt: string;
  }>;
};

export type ServiceOrdersListData = {
  data: ServiceOrderListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type ServiceOrdersListInput = {
  page: number;
  limit: number;
  query?: string;
  status?: ServiceOrderStatus;
};

// Derived from the Zod schemas the service-order routes validate with
// (zValidator on Create/UpdateServiceOrderSchema) — z.input keeps fields
// with schema defaults optional for callers.
export type CreateServiceOrderInput = z.input<typeof CreateServiceOrderSchema>;

/** Partial update of an existing OS (detail-page edits). */
export type UpdateServiceOrderInput = z.input<typeof UpdateServiceOrderSchema>;

export type CreateServiceOrderResult = {
  data: {
    id: number;
    serviceOrderNumber?: string;
  };
};

export type ServiceOrderPricedItemInput = {
  type: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  taxable?: boolean;
  warrantyCovered?: boolean;
};

export type CreateServiceOrderQuoteInput = {
  validUntil?: string | null;
  paymentTerms?: string | null;
  deliveryEstimate?: string | null;
  warrantyTerms?: string | null;
  clientMessage?: string | null;
  internalNotes?: string | null;
  items: ServiceOrderPricedItemInput[];
};

export type SaveServiceOrderEvaluationInput = {
  diagnosis: string;
  detectedIssues?: string | null;
  recommendedAction: string;
  requiresQuote: boolean;
  requiresClientApproval: boolean;
  calibrationRecommended: boolean;
  clientVisibleNotes?: string | null;
  photos?: unknown[];
};

export type SendServiceOrderQuoteInput = {
  clientMessage?: string | null;
};

export type SaveServiceOrderExecutionInput = {
  servicePerformed?: string | null;
  partsUsedSummary?: string | null;
  technicalNotes?: string | null;
  calibrationRequiredAfterRepair?: boolean;
  result?: string;
  items?: ServiceOrderPricedItemInput[];
};

export type IssueServiceOrderDeliveryDocumentInput = {
  technicianSignatureData?: unknown | null;
  clientSignatureData?: unknown | null;
};

export type ServiceOrderRepairMarkInput = {
  inmetroRepairMarkNumber?: string | null;
  inmetroRepairMarkIssuedAt?: string | null;
  inmetroRepairMarkAppliedAt?: string | null;
  inmetroRepairMarkNotes?: string | null;
};

export type DeliverServiceOrderInput = {
  deliveryMethod: string;
  deliveredToName: string;
  deliveredToDocument?: string | null;
  deliveryNotes?: string | null;
  inmetroRepairMarkNumber?: string | null;
};

export type ServiceOrderDocumentUrl = {
  url: string;
};

export type ServiceOrderCommunicationStatus =
  | "sent"
  | "queued"
  | "retrying"
  | "failed"
  | "skipped";

export type ServiceOrderCommunicationEntry = {
  eventKey: string;
  channel: "email";
  status: ServiceOrderCommunicationStatus;
  recipientEmail: string | null;
  recipientSuppressed: boolean;
  sentAt: string | null;
  queuedAt: string | null;
  attempts: number;
  lastError: string | null;
};

export type ServiceOrderCommunicationsData = {
  data: ServiceOrderCommunicationEntry[];
};
