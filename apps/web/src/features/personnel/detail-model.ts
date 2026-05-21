import type {
  AssignableTrainingRecord,
  CompetenceStatus,
  TrainingType,
} from './types'

export const COMPETENCE_WORKFLOW_STEPS: CompetenceStatus[] = [
  'REQUESTED',
  'TRAINING_ASSIGNED',
  'IN_TRAINING',
  'PENDING_EVALUATION',
  'ACTIVE',
]

export const TRAINING_TYPE_LABELS: Record<TrainingType, string> = {
  internal: 'Interno',
  external: 'Externo',
  ojt: 'Em Serviço',
  proficiency_test: 'Teste de Proficiência',
}

export const TRAINING_STATUS_LABELS: Record<string, string> = {
  planned: 'Planejado',
  in_progress: 'Em Andamento',
  completed: 'Concluído',
  failed: 'Reprovado',
}

const TRAINING_TYPE_SET = new Set<string>(Object.keys(TRAINING_TYPE_LABELS))

export type CompetenceEvaluationPayload = {
  passed: boolean
  notes?: string
  qualifiedAt?: string
  expiresAt?: string
}

export type CreateTrainingRecordDraft = {
  userId: string
  title: string
  type: TrainingType
  provider: string
  description: string
  startDate: string
  endDate: string
}

export function formatCompetenceDate(dateString: string | null | undefined) {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function getTodayDateInputValue(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function toISOStringFromDateInput(value: string) {
  return new Date(`${value}T00:00:00`).toISOString()
}

export function isTrainingType(value: string): value is TrainingType {
  return TRAINING_TYPE_SET.has(value)
}

export function isTerminalInactiveStatus(status: CompetenceStatus) {
  return (
    status === 'SUSPENDED' || status === 'EXPIRED' || status === 'CANCELLED'
  )
}

export function canCancelCompetenceStatus(status: CompetenceStatus) {
  return (
    status === 'REQUESTED' ||
    status === 'TRAINING_ASSIGNED' ||
    status === 'IN_TRAINING' ||
    status === 'PENDING_EVALUATION'
  )
}

export function canRenewCompetenceStatus(status: CompetenceStatus) {
  return status === 'EXPIRED' || status === 'SUSPENDED'
}

export function getCompetenceWorkflowStepIndex(status: CompetenceStatus) {
  return COMPETENCE_WORKFLOW_STEPS.indexOf(status)
}

export function isWorkflowStepCompleted(
  currentStatus: CompetenceStatus,
  stepIndex: number,
) {
  return getCompetenceWorkflowStepIndex(currentStatus) > stepIndex
}

export function isWorkflowStepCurrent(
  currentStatus: CompetenceStatus,
  step: CompetenceStatus,
) {
  return currentStatus === step
}

export function filterAssignableTrainingRecords(
  records: AssignableTrainingRecord[],
  competenceId: string,
) {
  const numericCompetenceId = Number(competenceId)
  return records.filter(
    (record) =>
      record.competenceId === null ||
      record.competenceId === numericCompetenceId,
  )
}

export function toggleTrainingSelection(
  current: number[],
  trainingId: number,
  checked: boolean,
) {
  if (checked) {
    return current.includes(trainingId) ? current : [...current, trainingId]
  }
  return current.filter((id) => id !== trainingId)
}

export function createTrainingRecordPayload(draft: CreateTrainingRecordDraft) {
  return {
    userId: draft.userId,
    title: draft.title.trim(),
    type: draft.type,
    provider: draft.provider.trim() || undefined,
    description: draft.description.trim() || undefined,
    startDate: toISOStringFromDateInput(draft.startDate),
    endDate: draft.endDate
      ? toISOStringFromDateInput(draft.endDate)
      : undefined,
  }
}

export function createCompetenceEvaluationPayload({
  passed,
  notes,
  expiresAt,
  now = new Date(),
}: {
  passed: boolean
  notes: string
  expiresAt: string
  now?: Date
}): CompetenceEvaluationPayload {
  return {
    passed,
    notes: notes || undefined,
    qualifiedAt: passed ? now.toISOString() : undefined,
    expiresAt:
      passed && expiresAt ? new Date(expiresAt).toISOString() : undefined,
  }
}
