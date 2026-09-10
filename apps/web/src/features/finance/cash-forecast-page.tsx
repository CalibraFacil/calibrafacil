import { queryOptions, useQuery } from '@tanstack/react-query'
import { AlertCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { calibraApi } from '@/utils/api'
import { formatFinanceMoney } from '@/lib/finance-formatters'
import { Money } from '@/features/finance/finance-display'
import {
  BlueprintField,
  BlueprintGrid,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { Skeleton } from '@/components/ui/skeleton'

type Bucket =
  | 'THIS_WEEK'
  | 'NEXT_WEEK'
  | 'IN_30_DAYS'
  | 'IN_60_DAYS'
  | 'IN_90_DAYS'

const BUCKET_ORDER: ReadonlyArray<Bucket> = [
  'THIS_WEEK',
  'NEXT_WEEK',
  'IN_30_DAYS',
  'IN_60_DAYS',
  'IN_90_DAYS',
]

const BUCKET_LABEL: Record<Bucket, string> = {
  THIS_WEEK: 'Esta semana',
  NEXT_WEEK: 'Próxima semana',
  IN_30_DAYS: 'Em 30 dias',
  IN_60_DAYS: 'Em 60 dias',
  IN_90_DAYS: 'Em 90 dias',
}

interface BucketSummary {
  confirmedCents: number
  projectedCents: number
  confirmedCount: number
}

interface CashForecastEnvelope {
  buckets: Record<Bucket | 'OVERDUE', BucketSummary>
  totals: {
    confirmedCents: number
    projectedCents: number
    overdueCents: number
  }
}

function cashForecastQueryOptions() {
  return queryOptions<CashForecastEnvelope>({
    queryKey: ['finance', 'cash-forecast'],
    queryFn: () => calibraApi.finance.getCashForecast<CashForecastEnvelope>(),
  })
}

export function CashForecastPage() {
  const { data, isLoading, error } = useQuery(cashForecastQueryOptions())

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {BUCKET_ORDER.map((bucket) => (
          <Skeleton key={bucket} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (error || !data) {
    return (
      <Panel className="flex items-center gap-3 p-5 text-sm text-destructive">
        <HugeiconsIcon icon={AlertCircleIcon} className="size-5" />
        Não foi possível carregar a previsão.
      </Panel>
    )
  }

  return (
    <StaggerGroup className="space-y-6">
      {data.totals.overdueCents > 0 ? (
        <StaggerItem>
          <div data-testid="cash-forecast-overdue">
            <SignalTile
              icon={AlertCircleIcon}
              tone="critical"
              label="Vencidos"
              value={formatFinanceMoney(data.totals.overdueCents)}
              hint={`${data.buckets.OVERDUE.confirmedCount} parcelas`}
            />
          </div>
        </StaggerItem>
      ) : null}

      <StaggerItem>
        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          data-testid="cash-forecast-buckets"
        >
          {BUCKET_ORDER.map((bucket) => {
            const summary = data.buckets[bucket]
            return (
              <div
                key={bucket}
                data-testid={`bucket-${bucket}`}
                data-bucket={bucket}
              >
                <SignalTile
                  tone={summary.confirmedCents > 0 ? 'info' : 'neutral'}
                  label={BUCKET_LABEL[bucket]}
                  value={formatFinanceMoney(summary.confirmedCents)}
                  hint={`${summary.confirmedCount} parcelas`}
                />
                {summary.projectedCents > 0 ? (
                  <p className="mt-1 px-1 text-xs tabular-nums text-muted-foreground">
                    + {formatFinanceMoney(summary.projectedCents)} projetado
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      </StaggerItem>

      <StaggerItem>
        <Panel className="p-5 sm:p-6">
          <PanelHeader
            title="Totais em 90 dias"
            description="Parcelas confirmadas em aberto + projeção dos contratos recorrentes ativos."
          />
          <BlueprintGrid className="mt-4 grid-cols-1 sm:grid-cols-2">
            <BlueprintField label="Confirmado (parcelas)" mono>
              <Money cents={data.totals.confirmedCents} />
            </BlueprintField>
            <BlueprintField label="Projetado (recorrências)" mono>
              <Money cents={data.totals.projectedCents} tone="info" />
            </BlueprintField>
          </BlueprintGrid>
        </Panel>
      </StaggerItem>
    </StaggerGroup>
  )
}
