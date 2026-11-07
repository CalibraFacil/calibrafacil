import type {
  ContaAzulAppSaveResponse as ContractContaAzulAppSaveResponse,
  ContaAzulAppSummary as ContractContaAzulAppSummary,
  ContaAzulCatalogItem as ContractContaAzulCatalogItem,
  ContaAzulScheduleResponse as ContractContaAzulScheduleResponse,
  ContaAzulScheduleRow as ContractContaAzulScheduleRow,
  IntegrationRun as ContractIntegrationRun,
  IntegrationRunItemsResponse as ContractIntegrationRunItemsResponse,
  IntegrationSummary as ContractIntegrationSummary,
  IntegrationsResponse,
  SyncPreviewResponse as ContractSyncPreviewResponse,
  UnitAssignmentRole,
} from '@calibra-facil/contracts'

export type OrganizationMember = {
  id: string
  userId: string
  role: string
  createdAt: Date
  user: {
    id: string
    name: string
    email: string
    image?: string
  }
}

export type OrganizationInvitation = {
  id: string
  email: string
  role: string
  status: string
  expiresAt: Date
  inviterId: string
}

// The unit governance DTOs are the endpoint definitions' types
// (`@calibra-facil/contracts`, `endpoints/units.ts`).
export type {
  GovernanceActivityEntry,
  GovernanceMember,
  GovernanceViewer,
  OrganizationUnit,
  UnitAssignmentRole,
} from '@calibra-facil/contracts'

export type EditableUnitAssignmentRole = UnitAssignmentRole | 'none'

// Integrations: the DTOs are the contract schemas' types (`endpoints/integrations.ts`).
export type IntegrationRun = ContractIntegrationRun
export type SyncTarget = IntegrationRun['target']
export type IntegrationRunItemsResponse = ContractIntegrationRunItemsResponse
export type IntegrationSummary = ContractIntegrationSummary
export type ContaAzulCatalogItem = ContractContaAzulCatalogItem
export type ContaAzulAppSummary = ContractContaAzulAppSummary
export type ContaAzulAppSaveResponse = ContractContaAzulAppSaveResponse
export type ContaAzulScheduleRow = ContractContaAzulScheduleRow
export type ContaAzulScheduleResponse = ContractContaAzulScheduleResponse
export type SettingsIntegrationsData = IntegrationsResponse
export type SyncPreviewResponse = ContractSyncPreviewResponse
