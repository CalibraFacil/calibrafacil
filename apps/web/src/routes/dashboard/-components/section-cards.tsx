import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  Calendar03Icon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  PercentCircleIcon,
} from '@hugeicons/core-free-icons'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface SectionCardsProps {
  pendingCalibrations: number
  approvedThisMonth: number
  expiringStandards: number
  approvalRate: number
  overdueJobs: number
  isLoading?: boolean
}

export function SectionCards({
  pendingCalibrations,
  approvedThisMonth,
  expiringStandards,
  approvalRate,
  overdueJobs,
  isLoading,
}: SectionCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <Card key={i} size="sm" className="rounded-2xl">
            <CardHeader>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-9 w-16" />
            </CardHeader>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-5">
      <MetricCard
        icon={Clock01Icon}
        label="Pendentes"
        value={pendingCalibrations}
        badge="Em aberto"
      />
      <MetricCard
        icon={CheckmarkCircle01Icon}
        label="Aprovadas no mês"
        value={approvedThisMonth}
        badge="Concluídas"
        tone="success"
      />
      <MetricCard
        icon={Calendar03Icon}
        label="Padrões expirando"
        value={expiringStandards}
        badge="Próx. 30 dias"
        tone={expiringStandards > 0 ? 'warning' : 'neutral'}
      />
      <MetricCard
        icon={PercentCircleIcon}
        label="Taxa de aprovação"
        value={`${approvalRate.toFixed(1)}%`}
        badge="Este mês"
      />
      <MetricCard
        icon={Alert02Icon}
        label="Em atraso"
        value={overdueJobs}
        badge={overdueJobs > 0 ? 'Atenção' : 'OK'}
        tone={overdueJobs > 0 ? 'critical' : 'neutral'}
      />
    </div>
  )
}

function MetricCard({
  icon,
  label,
  value,
  badge,
  tone = 'neutral',
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  label: string
  value: number | string
  badge: string
  tone?: 'neutral' | 'success' | 'warning' | 'critical'
}) {
  return (
    <Card
      size="sm"
      className="rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_28px_rgba(0,0,0,0.04)]"
    >
      <CardHeader className="pb-0">
        <CardDescription>
          <span className="flex items-center gap-2 text-pretty">
            <span
              className={cn(
                'flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground',
                tone === 'success' &&
                  'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                tone === 'warning' &&
                  'bg-amber-500/10 text-amber-700 dark:text-amber-400',
                tone === 'critical' && 'bg-destructive/10 text-destructive',
              )}
            >
              <HugeiconsIcon icon={icon} className="size-4" />
            </span>
            {label}
          </span>
        </CardDescription>
        <CardAction>
          <Badge
            variant={
              tone === 'critical'
                ? 'destructive'
                : tone === 'success'
                  ? 'default'
                  : 'outline'
            }
          >
            {badge}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <CardTitle
          className={cn(
            'text-3xl font-semibold tabular-nums',
            tone === 'success' && 'text-emerald-700 dark:text-emerald-400',
            tone === 'warning' && 'text-amber-700 dark:text-amber-400',
            tone === 'critical' && 'text-destructive',
          )}
        >
          {value}
        </CardTitle>
      </CardContent>
    </Card>
  )
}
