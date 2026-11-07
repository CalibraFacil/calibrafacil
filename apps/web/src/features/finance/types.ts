import type {
  BillingDocumentDetails as ContractBillingDocumentDetails,
  BillingDocumentListItem as ContractBillingDocumentListItem,
  ContractListItem as ContractContractListItem,
  ErpExportRow,
  FinanceOverview,
  ReceiptRow as ContractReceiptRow,
} from '@calibra-facil/contracts'

// The finance DTOs are the contract's (`@calibra-facil/contracts`,
// `endpoints/finance.ts`); the names below are the views the pages use.
export type BillingDocumentDetails = ContractBillingDocumentDetails
export type BillingDocumentListItem = ContractBillingDocumentListItem
export type ContractListItem = ContractContractListItem
export type FinanceOverviewResponse = FinanceOverview
export type ErpExportsResponse = { data: ErpExportRow[] }
export type ReceiptRow = ContractReceiptRow
export type FinanceReceiptsData = { data: ReceiptRow[] }

export type FinanceSearchQueryInput = {
  search: string
}

export type FinanceBillingMode = 'single' | 'consolidated'

type FinanceContractCustomerOption = {
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
