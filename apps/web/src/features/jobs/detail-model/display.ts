import { formatCalibrationValue } from '@calibra-facil/shared'
import { isMassCompositionValue } from '@/components/method-runtime/mass-composition-utils'
import { formatInstant } from '@calibra-facil/shared/format'
import { type JobStatus, type ReviewMethodColumn } from './types'

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  DRAFT: 'Rascunho',
  IN_PROGRESS: 'Em Execução',
  REVIEW: 'Em Revisão',
  GENERATING_PDF: 'Gerando PDF',
  RENDER_FAILED: 'Falha na emissão',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  CANCELED: 'Cancelado',
  SUPERSEDED: 'Retificado',
}

export const JOB_STATUS_VARIANTS: Record<
  JobStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  DRAFT: 'secondary',
  IN_PROGRESS: 'default',
  REVIEW: 'outline',
  GENERATING_PDF: 'outline',
  RENDER_FAILED: 'destructive',
  APPROVED: 'default',
  REJECTED: 'destructive',
  CANCELED: 'secondary',
  SUPERSEDED: 'outline',
}

export const PHASE_DISPLAY_LABELS: Record<'before' | 'after', string> = {
  before: 'Antes do ajuste',
  after: 'Após o ajuste',
}

/**
 * Display label for a measurement-table column in flat (ungrouped) tables.
 * Method labels carry only the replicate ("Leitura 1") while the phase lives
 * in the column's `phase` metadata, so outside a phase-grouped layout the
 * phase is prefixed back in to keep the column unambiguous. Labels that
 * already mention the phase (older snapshots, eccentricity columns) pass
 * through unchanged.
 */
export function reviewColumnDisplayLabel(column: ReviewMethodColumn): string {
  const phase = column.phase
  if (phase !== 'before' && phase !== 'after') return column.label
  if (/antes|ap[óo]s/i.test(column.label)) return column.label
  return `${PHASE_DISPLAY_LABELS[phase]} · ${column.label}`
}

export const REVIEW_ACTION_BUTTON_CLASS =
  'min-h-10 active:scale-[0.96] transition-[background-color,color,box-shadow,border-color,transform]'

export const REVIEW_SURFACE_CLASS =
  'min-w-0 rounded-2xl bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10'

export const PRIORITY_REVIEW_FIELD_KEYS = [
  'pontos_indicacao',
  'excentricidade',
  'repetibilidade',
]

export const PRIORITY_REVIEW_FORMULA_KEYS = [
  'erro_indicacao_antes',
  'margem_conformidade_antes',
  'erro_indicacao_apos',
  'margem_conformidade_apos',
  'incerteza_expandida_antes',
  'incerteza_expandida_apos',
  'maior_desvio_excentricidade_antes',
  'maior_desvio_excentricidade_apos',
  'maior_repetibilidade',
  'repetibilidade_desvio_apos',
]

/** A moment (approved, performed, created) on the laboratory's day. */
export function formatDate(dateString: string | null | undefined): string {
  return formatInstant(dateString, 'date', { empty: '-' })
}

export function formatDateTime(dateString: string | null | undefined): string {
  return formatInstant(dateString, 'date-time', { empty: '-' })
}

export function getFinancialVariant(status: string | null | undefined) {
  switch (status) {
    case 'PAID':
      return 'outline'
    case 'OVERDUE':
      return 'destructive'
    case 'ISSUED':
      return 'default'
    case 'DRAFT':
      return 'secondary'
    case 'UNBILLED':
    default:
      return 'secondary'
  }
}

export function formatReviewValue(value: unknown, unit?: string): string {
  if (value === null || value === undefined || value === '') return '-'
  if (isMassCompositionValue(value)) return value.label
  const formatted = formatCalibrationValue(value)
  return unit ? `${formatted} ${unit}` : formatted
}
