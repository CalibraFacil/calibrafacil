import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkBadge02Icon,
  Alert02Icon,
  Target02Icon,
  TaskDone01Icon,
  ThermometerIcon,
  RulerIcon,
  Clock01Icon,
  FunctionIcon,
} from '@hugeicons/core-free-icons'
import {
  type JobVerdict,
  type JobVerdictLevel,
} from '@/features/jobs/detail-model'
import { type SignalTone } from '@calibra-facil/ui/instrument-panel'

type HugeIcon = Parameters<typeof HugeiconsIcon>[0]['icon']

export const VERDICT_PRESENTATION: Record<
  JobVerdictLevel,
  {
    label: string
    description: string
    tone: SignalTone
    icon: HugeIcon
  }
> = {
  conforme: {
    label: 'Conforme',
    description: 'Todos os critérios e pontos dentro da tolerância.',
    tone: 'ok',
    icon: CheckmarkBadge02Icon,
  },
  nao_conforme: {
    label: 'Não conforme',
    description: 'Há critérios reprovados ou pontos fora da tolerância.',
    tone: 'critical',
    icon: Alert02Icon,
  },
  atencao: {
    label: 'Conforme com ressalvas',
    description: 'Avisos ou condições ambientais exigem justificativa.',
    tone: 'warning',
    icon: Alert02Icon,
  },
  nao_avaliado: {
    label: 'Conformidade não avaliada',
    description:
      'Nenhum ponto com tolerância e nenhum critério de aceitação foram avaliados. Confira as leituras antes de aprovar.',
    tone: 'warning',
    icon: Alert02Icon,
  },
  incompleto: {
    label: 'Evidência incompleta',
    description: 'Faltam leituras ou resultados calculados.',
    tone: 'neutral',
    icon: Clock01Icon,
  },
}

export const VERDICT_EMBLEM_CLASS: Record<SignalTone, string> = {
  ok: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  critical: 'bg-destructive/12 text-destructive',
  warning: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
  info: 'bg-primary/12 text-primary',
  neutral: 'bg-muted text-muted-foreground',
}

export const VERDICT_TEXT_CLASS: Record<SignalTone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  critical: 'text-destructive',
  warning: 'text-amber-700 dark:text-amber-400',
  info: 'text-primary',
  neutral: 'text-foreground',
}

export function buildVerdictTiles(verdict: JobVerdict): Array<{
  key: string
  icon: HugeIcon
  label: string
  value: string
  hint?: string
  tone: SignalTone
}> {
  const tiles: Array<{
    key: string
    icon: HugeIcon
    label: string
    value: string
    hint?: string
    tone: SignalTone
  }> = [
    {
      key: 'points',
      icon: Target02Icon,
      label: 'Pontos na tolerância',
      value:
        verdict.pointsTotal > 0
          ? `${verdict.pointsWithin}/${verdict.pointsTotal}`
          : '-',
      hint: verdict.pointsTotal > 0 ? 'pontos' : 'sem pontos',
      tone:
        verdict.pointsTotal === 0
          ? 'neutral'
          : verdict.pointsOutOfTolerance > 0
            ? 'critical'
            : 'ok',
    },
    {
      key: 'criteria',
      icon: TaskDone01Icon,
      label: 'Critérios atendidos',
      value:
        verdict.criteriaTotal > 0
          ? `${verdict.criteriaPassed}/${verdict.criteriaTotal}`
          : '-',
      hint: verdict.criteriaTotal > 0 ? 'critérios' : 'nenhum',
      tone:
        verdict.criteriaTotal === 0
          ? 'neutral'
          : verdict.criteriaFailed > 0
            ? 'critical'
            : verdict.criteriaWarning > 0
              ? 'warning'
              : 'ok',
    },
    {
      key: 'environment',
      icon: ThermometerIcon,
      label: 'Ambiente',
      value:
        verdict.environment === 'within'
          ? 'Dentro'
          : verdict.environment === 'out'
            ? 'Fora'
            : '-',
      hint: 'condições',
      tone:
        verdict.environment === 'within'
          ? 'ok'
          : verdict.environment === 'out'
            ? 'warning'
            : 'neutral',
    },
    {
      key: 'traceability',
      icon: RulerIcon,
      label: 'Rastreabilidade',
      value: String(verdict.standardsCount),
      hint: 'padrões',
      tone: verdict.standardsCount > 0 ? 'info' : 'critical',
    },
  ]

  if (verdict.expandedUncertainty) {
    tiles.push({
      key: 'uncertainty',
      icon: FunctionIcon,
      label: 'Incerteza U (máx.)',
      value: verdict.expandedUncertainty,
      hint: 'expandida',
      tone: 'neutral',
    })
  }

  return tiles
}
