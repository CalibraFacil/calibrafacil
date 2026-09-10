import type { SignalTone } from '@/components/instrument-panel'
import type {
  DashboardJob,
  DashboardJobStatus,
  DashboardStats,
} from '@/features/dashboard/queries'

/**
 * Pure view-model for the lab dashboard. Everything the page renders is derived
 * here from the `/api/dashboard/stats` aggregate so the instrument cluster keeps
 * a fixed shape: every stage and every signal is always present, and a healthy
 * lab reads as an `ok` zero rather than as a missing panel.
 */

export const STATUS_LABEL: Record<DashboardJobStatus, string> = {
  DRAFT: 'Preparação',
  IN_PROGRESS: 'Em execução',
  REVIEW: 'Revisão',
  GENERATING_PDF: 'Emitindo',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CANCELED: 'Cancelada',
  SUPERSEDED: 'Substituída',
}

// — Pipeline —

export type PipelineStageStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'GENERATING_PDF'

export type PipelineStage = {
  status: PipelineStageStatus
  label: string
  count: number
  /** Share of open work, 0–1. */
  share: number
}

export const PIPELINE_STAGES: ReadonlyArray<{
  status: PipelineStageStatus
  label: string
}> = [
  { status: 'DRAFT', label: 'Preparação' },
  { status: 'IN_PROGRESS', label: 'Em execução' },
  { status: 'REVIEW', label: 'Revisão' },
  { status: 'GENERATING_PDF', label: 'Emitindo' },
]

export function buildPipeline(
  breakdown: DashboardStats['statusBreakdown'] | undefined,
): { stages: PipelineStage[]; open: number } {
  const counts = new Map<string, number>()
  for (const item of breakdown ?? []) counts.set(item.status, item.count)

  const open = PIPELINE_STAGES.reduce(
    (total, stage) => total + (counts.get(stage.status) ?? 0),
    0,
  )

  const stages = PIPELINE_STAGES.map((stage) => {
    const count = counts.get(stage.status) ?? 0
    return {
      ...stage,
      count,
      share: open > 0 ? count / open : 0,
    }
  })

  return { stages, open }
}

// — Health signals —

export type HealthSignalKey =
  | 'nc'
  | 'capa'
  | 'standards'
  | 'competences'
  | 'validity'
  | 'intake'

export type HealthSignal = {
  key: HealthSignalKey
  label: string
  value: number
  hint: string
  tone: SignalTone
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export function buildHealthSignals(data: DashboardStats): HealthSignal[] {
  const awaiting = data.nonConformancesAwaitingDisposition
  const ptIssues = data.ptPlanOverdue + data.spcChartsWithSignals

  return [
    {
      key: 'nc',
      label: 'NC abertas',
      value: data.openNonConformances,
      hint:
        awaiting > 0
          ? `${awaiting} sem disposição`
          : data.openNonConformances > 0
            ? 'em tratamento'
            : 'nenhuma pendente',
      tone:
        awaiting > 0
          ? 'critical'
          : data.openNonConformances > 0
            ? 'warning'
            : 'ok',
    },
    {
      key: 'capa',
      label: 'CAPA abertas',
      value: data.capasOpen,
      hint:
        data.capasOverdue > 0
          ? plural(data.capasOverdue, 'atrasada', 'atrasadas')
          : data.capasOpen > 0
            ? 'dentro do prazo'
            : 'nenhuma aberta',
      tone:
        data.capasOverdue > 0 ? 'critical' : data.capasOpen > 0 ? 'info' : 'ok',
    },
    {
      key: 'standards',
      label: 'Padrões a vencer',
      value: data.expiringStandards,
      hint: data.expiringStandards > 0 ? 'em 30 dias' : 'rastreabilidade ok',
      tone: data.expiringStandards > 0 ? 'warning' : 'ok',
    },
    {
      key: 'competences',
      label: 'Competências',
      value: data.competencesExpiring,
      hint:
        data.competencesPendingEvaluation > 0
          ? `${plural(data.competencesPendingEvaluation, 'avaliação', 'avaliações')} pendentes`
          : data.competencesExpiring > 0
            ? 'expiram em 30 dias'
            : 'equipe em dia',
      tone:
        data.competencesExpiring > 0 || data.competencesPendingEvaluation > 0
          ? 'warning'
          : 'ok',
    },
    {
      key: 'validity',
      label: 'PT · SPC',
      value: ptIssues,
      hint:
        ptIssues > 0
          ? data.spcChartsWithSignals > 0
            ? `${plural(data.spcChartsWithSignals, 'carta com sinal', 'cartas com sinal')}`
            : 'plano de PT atrasado'
          : data.ptRoundsPending > 0
            ? `${plural(data.ptRoundsPending, 'rodada pendente', 'rodadas pendentes')}`
            : 'resultados válidos',
      tone:
        ptIssues > 0 ? 'critical' : data.ptRoundsPending > 0 ? 'warning' : 'ok',
    },
    {
      key: 'intake',
      label: 'Solicitações',
      value: data.pendingCalibrationRequests,
      hint:
        data.serviceOrdersInProgress > 0
          ? `${plural(data.serviceOrdersInProgress, 'OS em andamento', 'OS em andamento')}`
          : data.pendingCalibrationRequests > 0
            ? 'aguardam triagem'
            : 'fila de entrada vazia',
      tone: data.pendingCalibrationRequests > 0 ? 'info' : 'neutral',
    },
  ]
}

// — Work queue —

export type QueueView = 'due' | 'review' | 'recent'

export const QUEUE_VIEWS: ReadonlyArray<{ value: QueueView; label: string }> = [
  { value: 'due', label: 'Prazo' },
  { value: 'review', label: 'Revisão' },
  { value: 'recent', label: 'Recentes' },
]

/**
 * Managers approve, so their queue opens on what is waiting for them; everyone
 * else opens on deadlines. Falls back to deadlines when nothing awaits review.
 */
export function defaultQueueView(
  data: DashboardStats | undefined,
  isManager: boolean,
): QueueView {
  if (isManager && (data?.reviewQueue.length ?? 0) > 0) return 'review'
  return 'due'
}

export function selectQueueJobs(
  data: DashboardStats | undefined,
  view: QueueView,
): DashboardJob[] {
  if (!data) return []
  switch (view) {
    case 'due':
      return data.dueSoonJobs
    case 'review':
      return data.reviewQueue
    case 'recent':
      return data.recentJobs
  }
}

// — Throughput trend —

export type TrendPoint = { date: string; approved: number; rejected: number }

export type TrendWindow = 30 | 90

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10)
}

/**
 * The API only returns days that had a decision; fill the window so the area
 * chart is continuous and quiet weeks read as flat rather than as gaps.
 */
export function buildTrendSeries(
  trend: DashboardStats['calibrationTrend'] | undefined,
  days: TrendWindow,
  today = new Date(),
): TrendPoint[] {
  const byDay = new Map<string, TrendPoint>()
  for (const point of trend ?? []) {
    byDay.set(String(point.date).slice(0, 10), {
      date: String(point.date).slice(0, 10),
      approved: point.approved,
      rejected: point.rejected,
    })
  }

  const series: TrendPoint[] = []
  const cursor = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
  )
  cursor.setUTCDate(cursor.getUTCDate() - (days - 1))

  for (let index = 0; index < days; index += 1) {
    const key = isoDay(cursor)
    series.push(byDay.get(key) ?? { date: key, approved: 0, rejected: 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return series
}

export function sumTrend(series: TrendPoint[]) {
  return series.reduce(
    (totals, point) => ({
      approved: totals.approved + point.approved,
      rejected: totals.rejected + point.rejected,
    }),
    { approved: 0, rejected: 0 },
  )
}

// — Dates —

export function daysUntil(dateString: string | null, today = new Date()) {
  if (!dateString) return null
  const due = new Date(dateString)
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  )
  return Math.round(
    (startOfDue.getTime() - startOfToday.getTime()) / 86_400_000,
  )
}

export function formatDueDate(
  dateString: string | null,
  isOverdue?: boolean | null,
  today = new Date(),
) {
  const difference = daysUntil(dateString, today)
  if (difference === null) return 'Sem prazo'

  if (difference < 0 || isOverdue) {
    const days = Math.max(1, Math.abs(difference))
    return `Atrasada há ${days} ${days === 1 ? 'dia' : 'dias'}`
  }
  if (difference === 0) return 'Hoje'
  if (difference === 1) return 'Amanhã'
  return `Em ${difference} dias`
}

export function formatStandardDue(
  dateString: string | null,
  today = new Date(),
) {
  const difference = daysUntil(dateString, today)
  if (difference === null) return 'Sem vencimento'
  if (difference < 0) return 'Vencido'
  if (difference === 0) return 'Vence hoje'
  if (difference === 1) return 'Vence amanhã'
  return `Vence em ${difference} dias`
}

export function formatShortDate(dateString: string | null) {
  if (!dateString) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(dateString))
}

export function jobTitle(job: DashboardJob) {
  return job.assetName ?? job.serviceName ?? job.jobId
}
