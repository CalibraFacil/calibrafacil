export type FinanceOverviewResponse = {
  totals: {
    issuedCents: number
    openCents: number
    overdueCents: number
    receivedCents: number
  }
  counts: {
    draftDocuments: number
    issuedDocuments: number
    overdueDocuments: number
    paidDocuments: number
  }
  aging: Record<string, number>
  recentDocuments: Array<{
    id: number
    documentNumber: string | null
    status: string
    exportStatus: string
    totalCents: number
    dueDate: string
    issueDate: string | null
    customerName: string
    unitName: string
  }>
  pendingExports: number
}

export type BillingDocumentListItem = {
  id: number
  documentNumber: string | null
  status: string
  customerId: number
  customerName: string
  unitId: number
  unitName: string
  issueDate: string | null
  dueDate: string
  subtotalCents: number
  discountCents: number
  totalCents: number
  currency: string
  exportStatus: string
  exportedAt: string | null
}

export type BillingDocumentsListData = {
  data: BillingDocumentListItem[]
}

export type BillingDocumentDetails = {
  id: number
  documentNumber: string | null
  status: string
  customerName: string
  unitName: string
  dueDate: string
  issueDate: string | null
  currency: string
  subtotalCents: number
  discountCents: number
  totalCents: number
  notes: string | null
  exportStatus: string
  exportedAt: string | null
  voidReason: string | null
  items: Array<{
    id: number
    jobId: number | null
    jobDisplayId: string | null
    description: string
    quantity: number
    unitPriceCents: number
    totalCents: number
  }>
  installments: Array<{
    id: number
    installmentNumber: number
    status: string
    dueDate: string
    amountCents: number
    currency: string
    paidAt: string | null
    paymentMethod: string | null
    paymentReference: string | null
  }>
  receipts: Array<{
    id: number
    amountCents: number
    paymentMethod: string
    reference: string | null
    receivedAt: string
  }>
  audit: Array<{
    id: number
    action: string
    reason: string | null
    performedAt: string
  }>
}

export type ContractListItem = {
  id: number
  customerId: number
  customerName: string
  status: string
  agreementCode: string | null
  title: string
  currency: string
  effectiveFrom: string
  effectiveTo: string | null
  defaultPaymentTermDays: number
  updatedAt: string
}

export type FinanceContractsListData = {
  data: ContractListItem[]
}

export type FinanceContractDetails = ContractListItem & {
  customerCompliance?: {
    qualificationStatus?: string | null
    qualityRequirementsAcknowledged?: boolean | null
    contractSignedAt?: string | null
    contractNumber?: string | null
  } | null
  serviceTerms: Array<{
    id: number
    serviceId: number
    unitId: number | null
    priceCents: number
    currency: string
  }>
  notes: string | null
}

export type FinanceSearchQueryInput = {
  search: string
}

export type FinanceBillingMode = 'single' | 'consolidated'

export type FinanceEligibleJob = {
  id: number
  jobId: string
  customerId: number
  customerName: string
  unitId: number
  unitName: string
  serviceId: number
  serviceName: string
  approvedAt: string | null
  priceCents: number
  currency: string
  paymentTermDays: number
  snapshotId: number
}

export type FinanceEligibleJobsData = {
  data: FinanceEligibleJob[]
}

export type FinanceContractCustomerOption = {
  id: number
  name: string
}

export type FinanceContractCustomerOptionsData = {
  data: FinanceContractCustomerOption[]
}

export type FinanceContractServiceOption = {
  id: number
  name: string
  price: number | null
  currency: string
}

export type FinanceContractServiceOptionsData = {
  data: FinanceContractServiceOption[]
}

export type ReceiptRow = {
  installmentId: number
  documentId: number
  documentNumber: string | null
  documentStatus: string
  customerName: string
  dueDate: string
  amountCents: number
  installmentStatus: string
  paidAt: string | null
  paymentMethod: string | null
  paymentReference: string | null
}

export type FinanceReceiptsData = {
  data: ReceiptRow[]
}

export type ErpExportsResponse = {
  billing: {
    planId: string
    planName: string
    hasCustomIntegrations: boolean
  }
  data: Array<{
    id: number
    documentNumber: string | null
    customerName: string
    status: string
    exportStatus: string
    exportedAt: string | null
    totalCents: number
    currency: string
    dueDate: string
    issueDate: string | null
  }>
}
