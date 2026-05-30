import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight02Icon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { SectionPanel, StatusChip } from '@/features/backoffice/console'
import { useBackofficeVitalsData } from '@/features/backoffice/queries'

const PLAN_ORDER = ['ENTERPRISE', 'PROFESSIONAL', 'STANDARD', 'FREE'] as const

const PLAN_LABELS: Record<string, string> = {
  FREE: 'Free',
  STANDARD: 'Standard',
  PROFESSIONAL: 'Professional',
  ENTERPRISE: 'Enterprise',
}

export function RevenuePanel() {
  const query = useBackofficeVitalsData()
  const subs = query.data?.subscriptions

  return (
    <SectionPanel
      eyebrow="Receita"
      title="Assinaturas"
      description="Estado comercial da carteira — base, trials, inadimplência e renovações próximas."
      action={
        <Button
          variant="ghost"
          size="sm"
          className="min-h-10 transition-transform active:scale-[0.96]"
          render={<Link to="/backoffice/commercial-checkouts" />}
        >
          Abrir Receita
          <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" />
        </Button>
      }
      contentClassName="space-y-4"
    >
      {query.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[5.5rem] rounded-xl" />
          ))}
        </div>
      ) : subs ? (
        <>
          <StaggerGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StaggerItem>
              <SignalTile
                label="Ativas"
                value={subs.active}
                tone={subs.active > 0 ? 'ok' : 'neutral'}
                hint={`de ${subs.total}`}
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                label="Em trial"
                value={subs.trialing}
                tone={subs.trialing > 0 ? 'info' : 'neutral'}
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                label="Inadimplentes"
                value={subs.pastDue}
                tone={subs.pastDue > 0 ? 'critical' : 'ok'}
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                label="Renovações 30d"
                value={subs.renewalsDue30d}
                tone={subs.renewalsDue30d > 0 ? 'warning' : 'neutral'}
              />
            </StaggerItem>
          </StaggerGroup>

          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Distribuição por plano
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PLAN_ORDER.filter((plan) => (subs.byPlan[plan] ?? 0) > 0).map(
                (plan) => (
                  <StatusChip key={plan} tone="neutral">
                    {PLAN_LABELS[plan] ?? plan}
                    <span className="font-mono tabular-nums">
                      {subs.byPlan[plan] ?? 0}
                    </span>
                  </StatusChip>
                ),
              )}
              {subs.total === 0 ? (
                <span className="text-sm text-muted-foreground">
                  Nenhuma assinatura ainda.
                </span>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </SectionPanel>
  )
}
