import { queryOptions, useQuery } from '@tanstack/react-query'
import { AlertCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { calibraApi } from '@/utils/api'
import { formatFinanceMoney } from '@/lib/finance-formatters'
import {
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from '@/components/instrument-panel'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

type Stage =
  | 'READY_TO_BILL'
  | 'SENT_TO_FINANCE'
  | 'INVOICED'
  | 'PARTIALLY_COLLECTED'
  | 'COLLECTED'

const STAGE_ORDER: ReadonlyArray<Stage> = [
  'READY_TO_BILL',
  'SENT_TO_FINANCE',
  'INVOICED',
  'PARTIALLY_COLLECTED',
  'COLLECTED',
]

const STAGE_LABEL: Record<Stage, string> = {
  READY_TO_BILL: 'Pronto para faturar',
  SENT_TO_FINANCE: 'Enviado ao financeiro',
  INVOICED: 'Faturado',
  PARTIALLY_COLLECTED: 'Recebimento parcial',
  COLLECTED: 'Recebido',
}

const STAGE_TONE: Record<Stage, SignalTone> = {
  READY_TO_BILL: 'info',
  SENT_TO_FINANCE: 'neutral',
  INVOICED: 'neutral',
  PARTIALLY_COLLECTED: 'warning',
  COLLECTED: 'ok',
}

interface StageBucket {
  count: number
  totalCents: number
}

interface OperationsToCashSummary {
  stages: Record<Stage, StageBucket>
  needsAttention: {
    overdueCount: number
    blockedCount: number
    overdueCents: number
    blockedCents: number
  }
}

interface ClassifiedItem {
  serviceOrderId: number
  serviceOrderNumber: string
  customer: { id: number; name: string }
  unit: { id: number; name: string }
  amountCents: number
  currency: string
  stage: Stage
  isOverdue: boolean
  isBlocked: boolean
}

interface OperationsToCashEnvelope {
  summary: OperationsToCashSummary
  items: ClassifiedItem[]
}

function operationsToCashQueryOptions() {
  return queryOptions<OperationsToCashEnvelope>({
    queryKey: ['finance', 'operations-to-cash'],
    queryFn: () =>
      calibraApi.finance.getOperationsToCash<OperationsToCashEnvelope>(),
  })
}

export function OperationsToCashPage() {
  const { data, isLoading, error } = useQuery(operationsToCashQueryOptions())

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {STAGE_ORDER.map((stage) => (
          <Skeleton key={stage} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (error || !data) {
    return (
      <Panel className="flex items-center gap-3 p-5 text-sm text-destructive">
        <HugeiconsIcon icon={AlertCircleIcon} className="size-5" />
        Não foi possível carregar o painel.
      </Panel>
    )
  }

  const attention = data.summary.needsAttention
  const showAttention =
    attention.overdueCount > 0 || attention.blockedCount > 0

  return (
    <StaggerGroup className="space-y-6">
      <StaggerItem>
        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          data-testid="operations-to-cash-stages"
        >
          {STAGE_ORDER.map((stage) => {
            const bucket = data.summary.stages[stage]
            return (
              <div key={stage} data-testid={`stage-card-${stage}`} data-stage={stage}>
                <SignalTile
                  tone={bucket.count > 0 ? STAGE_TONE[stage] : 'neutral'}
                  label={STAGE_LABEL[stage]}
                  value={bucket.count}
                  hint={formatFinanceMoney(bucket.totalCents)}
                />
              </div>
            )
          })}
        </div>
      </StaggerItem>

      {showAttention ? (
        <StaggerItem>
          <Panel className="p-5 sm:p-6" data-testid="operations-to-cash-attention">
            <PanelHeader
              eyebrow="Atenção"
              title="Requer atenção"
              description="Ordens que travam a conversão em caixa."
            />
            <div className="mt-4 space-y-2">
              {attention.overdueCount > 0 ? (
                <div className="flex items-center justify-between rounded-lg bg-destructive/10 px-3 py-2 text-sm shadow-[inset_0_0_0_1px_rgba(239,68,68,0.18)]">
                  <Badge
                    variant="outline"
                    className="border-destructive/40 text-destructive"
                  >
                    Vencidas
                  </Badge>
                  <span className="font-mono tabular-nums">
                    {attention.overdueCount} OS ·{' '}
                    {formatFinanceMoney(attention.overdueCents)}
                  </span>
                </div>
              ) : null}
              {attention.blockedCount > 0 ? (
                <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)]">
                  <Badge variant="outline">Bloqueadas</Badge>
                  <span className="font-mono tabular-nums">
                    {attention.blockedCount} OS ·{' '}
                    {formatFinanceMoney(attention.blockedCents)}
                  </span>
                </div>
              ) : null}
            </div>
          </Panel>
        </StaggerItem>
      ) : null}

      {data.items.length === 0 ? (
        <StaggerItem>
          <Panel className="p-5 text-sm text-muted-foreground">
            Sem OS faturáveis no momento.
          </Panel>
        </StaggerItem>
      ) : null}
    </StaggerGroup>
  )
}
