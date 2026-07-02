import type { ServiceOrdersListData as ClientRuntimeServiceOrdersListData } from '@calibra-facil/client-runtime'
import type { ServiceOrderFinancialStatus } from '@calibra-facil/shared'

export const SERVICE_ORDER_STATUSES = [
  'opened',
  'awaiting_tech_evaluation',
  'under_evaluation',
  'awaiting_quote_approval',
  'quote_approved',
  'quote_rejected',
  'repair_in_progress',
  'awaiting_calibration',
  'calibration_in_progress',
  'awaiting_final_review',
  'ready_for_pickup',
  'delivered',
  'closed',
  'canceled',
  'warranty_return',
] as const

export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number]

export type ServiceOrderListItem = Omit<
  ClientRuntimeServiceOrdersListData['data'][number],
  'status'
> & {
  status: ServiceOrderStatus
  syncState?: string | null
}

export type ServiceOrdersListData = Omit<
  ClientRuntimeServiceOrdersListData,
  'data'
> & {
  data: ServiceOrderListItem[]
}

export type ServiceOrdersListQueryInput = {
  organizationId: string
  page: number
  limit: number
  search: string
  statusFilter: ServiceOrderStatus | ''
}

export type ServiceOrderFinancialStatusResponse = {
  data: ServiceOrderFinancialStatus
}

export type ServiceOrderItemType =
  | 'service'
  | 'part'
  | 'external_service'
  | 'freight'
  | 'discount'
  | 'evaluation_fee'
  | 'other'

export type ServiceOrderRecommendedAction =
  | 'repair'
  | 'calibration_only'
  | 'return_without_repair'
  | 'condemned'
  | 'warranty_service'
  | 'external_service_required'

export type ServiceOrderExecutionResult =
  | 'repaired'
  | 'not_repaired'
  | 'condemned'
  | 'returned_without_service'
  | 'sent_to_third_party'

export type ServiceOrderQuoteItem = {
  id: number
  type: ServiceOrderItemType
  description: string
  quantity: number
  unit: string
  unitPriceCents: number
  totalPriceCents: number
  taxable?: boolean
  warrantyCovered?: boolean
  notes?: string | null
  materialId?: number | null
}

export type ServiceOrderQuote = {
  id: number
  status: string
  totalCents: number
  version: number
  validUntil?: string | null
  paymentTerms?: string | null
  deliveryEstimate?: string | null
  warrantyTerms?: string | null
  clientMessage?: string | null
  subtotalServicesCents?: number
  subtotalPartsCents?: number
  freightCents?: number
  discountCents?: number
  items: ServiceOrderQuoteItem[]
}

export type ServiceOrderEvaluation = {
  id: number
  diagnosis: string
  detectedIssues?: string | null
  recommendedAction: ServiceOrderRecommendedAction
  requiresQuote: boolean
  requiresClientApproval: boolean
  calibrationRecommended: boolean
  clientVisibleNotes?: string | null
  internalNotes?: string | null
  evaluatedAt: string
}

export type ServiceOrderExecution = {
  id: number
  startedAt: string
  finishedAt?: string | null
  servicePerformed?: string | null
  partsUsedSummary?: string | null
  technicalNotes?: string | null
  calibrationRequiredAfterRepair: boolean
  result?: ServiceOrderExecutionResult | null
  items: ServiceOrderQuoteItem[]
}

export type ServiceOrderDeliveryDocument = {
  id: number
  documentNumber: string
  version: number
  pdfR2Key?: string | null
  issuedAt?: string | null
}

export type ServiceOrderDetail = {
  id: number
  serviceOrderNumber: string
  organizationName?: string | null
  organizationCnpj?: string | null
  organizationPhone?: string | null
  organizationEmail?: string | null
  organizationStreet?: string | null
  organizationNumber?: string | null
  organizationNeighbourhood?: string | null
  organizationCity?: string | null
  organizationState?: string | null
  organizationCep?: string | null
  priority: string
  statusLabel: string
  customerName: string
  customerTaxId?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  assetName: string
  assetTag?: string | null
  assetSerialNumber?: string | null
  assetMetrologyRegime?: 'INDUSTRIAL' | 'LEGAL' | 'UNKNOWN' | null
  unitName?: string | null
  assetSnapshot?: {
    assetName: string
    assetType?: string | null
    manufacturer?: string | null
    model?: string | null
    serialNumber?: string | null
    patrimonyNumber?: string | null
    capacity?: string | null
    resolution?: string | null
    observedIdentification?: string | null
    displaySpecs?: Array<{ label: string; value: string }> | null
  } | null
  claimedDefect: string
  intakeCondition: string
  accessories?: string | null
  invoiceRemittanceNumber?: string | null
  invoiceRemittanceKey?: string | null
  carrierName?: string | null
  thirdPartyName?: string | null
  oldSealNumber?: string | null
  newSealNumber?: string | null
  inmetroRepairSealNumber?: string | null
  inmetroRepairSealIssuedAt?: string | null
  inmetroRepairSealAppliedAt?: string | null
  inmetroRepairSealNotes?: string | null
  deliveredAt?: string | null
  deliveredToName?: string | null
  deliveredToDocument?: string | null
  deliveryMethod?: 'pickup_at_lab' | 'ship_to_client' | 'third_party_pickup'
  deliveryNotes?: string | null
  clientVisibleNotes?: string | null
  internalNotes?: string | null
  isExternalService?: boolean
  openedAt: string
  serviceStartedAt?: string | null
  evaluations: ServiceOrderEvaluation[]
  quotes: ServiceOrderQuote[]
  execution?: ServiceOrderExecution | null
  deliveryDocuments: ServiceOrderDeliveryDocument[]
  events: Array<{
    id: number
    eventType: string
    actorType?: string | null
    actorName?: string | null
    createdAt: string
  }>
}

export type NewServiceOrderCustomer = {
  id: number
  name: string
  taxId: string | null
  email: string | null
  phone: string | null
  compliance?: {
    qualificationStatus?: 'pending' | 'qualified' | 'suspended' | 'expired'
  } | null
}

export type NewServiceOrderCustomersData = {
  data: NewServiceOrderCustomer[]
}

export type NewServiceOrderAsset = {
  id: number
  customerId: number
  customerName: string
  name: string
  tag: string
  serialNumber: string | null
  manufacturer: string | null
  model: string | null
  assetTypeName: string | null
  status: string
}

export type NewServiceOrderAssetsData = {
  data: NewServiceOrderAsset[]
}
