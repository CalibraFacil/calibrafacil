import type {
  CompetenceListItem,
  CompetencesMatrixResponse,
  TrainingRecordListItem,
  TrainingType as ContractTrainingType,
} from '@calibra-facil/contracts'
import type { CompetenceStatus } from '@calibra-facil/schemas/machines'

export type { CompetenceStatus }

// The competence and training DTOs are the contract's
// (`@calibra-facil/contracts`, `endpoints/competences.ts` and
// `endpoints/training-records.ts`); the names below are the views the pages use.
export type CompetenceRow = CompetenceListItem
export type CompetencesMatrixData = CompetencesMatrixResponse
export type TrainingType = ContractTrainingType
export type AssignableTrainingRecord = TrainingRecordListItem

export type CompetencesListQueryInput = {
  organizationId: string
  page: number
  limit: number
  statusFilter: CompetenceStatus | ''
}
