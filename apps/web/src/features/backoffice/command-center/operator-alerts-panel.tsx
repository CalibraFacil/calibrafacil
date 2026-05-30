import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowRight02Icon,
  CheckmarkCircle01Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { SignalTone } from '@/components/instrument-panel'
import {
  ConsoleEmpty,
  SectionPanel,
  StatusChip,
} from '@/features/backoffice/console'
import { useBackofficeOperatorAlertsData } from '@/features/backoffice/queries'
import type { BackofficeOperatorAlert } from '@/features/backoffice/types'

const SEVERITY_TONES: Record<string, SignalTone> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
}

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Crítico',
  warning: 'Atenção',
  info: 'Info',
}

function useAlertActions() {
  const queryClient = useQueryClient()
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ['backoffice', 'operator-alerts'],
    })

  const acknowledge = useMutation({
    mutationFn: (id: number) =>
      calibraApi.backoffice.acknowledgeOperatorAlert(id),
    onSuccess: async () => {
      toast.success('Alerta reconhecido')
      await invalidate()
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Falha ao reconhecer alerta',
      ),
  })

  const recompute = useMutation({
    mutationFn: () => calibraApi.backoffice.recomputeOperatorAlerts(),
    onSuccess: async () => {
      await invalidate()
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Falha ao recalcular alertas',
      ),
  })

  return { acknowledge, recompute }
}

/**
 * Operator-addressed alert feed (gap #5). Proactive risk signals recomputed by the
 * `operator-alerts` cron — the team is finally notified, not just labs. Operators
 * acknowledge here; "Recalcular" runs the engine on demand between cron ticks.
 */
export function OperatorAlertsPanel() {
  const query = useBackofficeOperatorAlertsData()
  const { acknowledge, recompute } = useAlertActions()
  const alerts = query.data?.data ?? []

  return (
    <SectionPanel
      eyebrow="Alertas"
      title="Alertas operacionais"
      description="Riscos que exigem a equipe — contas suspensas, offboarding próximo, comps expirando."
      action={
        <div className="flex items-center gap-2">
          {alerts.length > 0 ? (
            <StatusChip tone="critical">{alerts.length} aberto(s)</StatusChip>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            className="min-h-9 transition-transform active:scale-[0.96]"
          >
            <HugeiconsIcon icon={RefreshIcon} className="size-4" />
            Recalcular
          </Button>
        </div>
      }
    >
      {query.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <ConsoleEmpty
          icon={CheckmarkCircle01Icon}
          title="Nenhum alerta aberto"
          description="Tudo sob controle — riscos proativos aparecem aqui."
        />
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              onAcknowledge={() => acknowledge.mutate(alert.id)}
              acknowledging={acknowledge.isPending}
            />
          ))}
        </div>
      )}
    </SectionPanel>
  )
}

function AlertRow({
  alert,
  onAcknowledge,
  acknowledging,
}: {
  alert: BackofficeOperatorAlert
  onAcknowledge: () => void
  acknowledging: boolean
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
      <div className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip
            tone={SEVERITY_TONES[alert.severity] ?? 'neutral'}
            icon={Alert02Icon}
          >
            {SEVERITY_LABELS[alert.severity] ?? alert.severity}
          </StatusChip>
          <span className="text-sm font-medium">{alert.title}</span>
        </span>
        {alert.detail ? (
          <p className="mt-1 text-xs text-muted-foreground">{alert.detail}</p>
        ) : null}
        {alert.organizationId ? (
          <Link
            to="/backoffice/accounts/$id"
            params={{ id: alert.organizationId }}
            className="group mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground"
          >
            <span className="truncate">
              {alert.organizationName ?? alert.organizationId}
            </span>
            <HugeiconsIcon
              icon={ArrowRight02Icon}
              className="size-3 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        ) : null}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onAcknowledge}
        disabled={acknowledging}
        className="min-h-9 shrink-0"
      >
        <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-4" />
        Reconhecer
      </Button>
    </div>
  )
}
