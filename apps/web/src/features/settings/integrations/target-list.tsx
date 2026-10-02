import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, Alert02Icon } from '@hugeicons/core-free-icons'

import type {
  IntegrationRunMode,
  IntegrationScheduleFrequency,
} from '@calibra-facil/shared'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import {
  formatIntegrationDateTime,
  getIntegrationTargetSummary,
  getTargetSpecificWarnings,
  integrationCoveragePercentage,
  integrationScheduleStatusLabel,
  integrationTargetMeta,
} from '@/features/settings/integrations-model'
import type { IntegrationSummary, SyncTarget } from '@/features/settings/types'
import type { ConnectorMutations } from './mutations'

type ScheduleChoice = {
  label: string
  mode: IntegrationRunMode
  frequency?: IntegrationScheduleFrequency
}

const scheduleChoices: ScheduleChoice[] = [
  { label: 'Manual', mode: 'manual_only' },
  { label: 'Diário', mode: 'scheduled', frequency: 'daily' },
  { label: 'Semanal', mode: 'scheduled', frequency: 'weekly' },
  { label: 'Desligado', mode: 'disabled' },
]

function activeScheduleLabel(mode: IntegrationRunMode, frequency: string) {
  if (mode === 'disabled') return 'Desligado'
  if (mode === 'scheduled') return frequency === 'weekly' ? 'Semanal' : 'Diário'
  return 'Manual'
}

export function IntegrationTargetList({
  className,
  integration,
  renderExtra,
  schedule,
  sync,
  targets,
}: {
  className?: string
  integration: IntegrationSummary
  /** Optional per-target slot (mapping editor + preview for the generic ERP). */
  renderExtra?: (target: SyncTarget) => ReactNode
  schedule: ConnectorMutations['schedule']
  sync: ConnectorMutations['sync']
  targets: readonly SyncTarget[]
}) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2', className)}>
      {targets.map((target) => {
        const summary = getIntegrationTargetSummary(integration, target)
        const meta = integrationTargetMeta[target]
        const percentage = integrationCoveragePercentage(summary.coverage)
        const targetWarnings = getTargetSpecificWarnings(summary)
        const scheduleStatusProblem =
          summary.schedule.status === 'blocked' ||
          summary.schedule.status === 'failing'
        // Scope pending state to the actual target being mutated so triggering
        // sync/schedule on one row doesn't disable every other row's button.
        const thisTargetSyncing =
          sync.isPending && sync.variables?.target === target
        const thisTargetRescheduling =
          schedule.isPending && schedule.variables?.target === target

        return (
          <div
            key={target}
            className="flex flex-col rounded-lg bg-card p-3.5 ring-1 ring-inset ring-border/70"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-none">
                  {meta.label}
                </p>
                <p className="mt-1 text-xs text-pretty text-muted-foreground">
                  {meta.description}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 gap-1 px-2 text-xs active:scale-[0.96]"
                      disabled={thisTargetRescheduling}
                    />
                  }
                >
                  {scheduleStatusProblem ? (
                    <HugeiconsIcon
                      icon={Alert02Icon}
                      className="size-3.5 text-destructive"
                    />
                  ) : null}
                  {activeScheduleLabel(
                    summary.schedule.mode,
                    summary.schedule.frequency,
                  )}
                  <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Agendamento</DropdownMenuLabel>
                    {scheduleChoices.map((choice) => {
                      const active =
                        choice.mode === summary.schedule.mode &&
                        (choice.mode !== 'scheduled' ||
                          choice.frequency === summary.schedule.frequency)
                      return (
                        <DropdownMenuItem
                          key={choice.label}
                          onClick={() =>
                            schedule.mutate({
                              target,
                              mode: choice.mode,
                              frequency: choice.frequency,
                            })
                          }
                          className={cn(
                            active && 'font-medium text-foreground',
                          )}
                        >
                          {choice.label}
                          {active ? (
                            <span className="ml-auto text-xs text-muted-foreground">
                              atual
                            </span>
                          ) : null}
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Status:{' '}
                    {integrationScheduleStatusLabel(summary.schedule.status)}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Cobertura remota</span>
                <span className="font-medium tabular-nums">
                  {summary.coverage.linkedCount}/{summary.coverage.localCount}
                </span>
              </div>
              <Progress value={percentage} className="h-1.5" />
            </div>

            <p className="mt-2.5 text-xs text-muted-foreground">
              {summary.lastSuccessfulRunAt
                ? `Último sucesso · ${formatIntegrationDateTime(summary.lastSuccessfulRunAt)}`
                : 'Ainda não sincronizado'}
              {summary.consecutiveFailures > 0
                ? ` · ${summary.consecutiveFailures} falha(s) seguidas`
                : ''}
            </p>

            {targetWarnings.length > 0 ? (
              <ul className="mt-2.5 space-y-1">
                {targetWarnings.map((warning) => (
                  <li
                    key={`${warning.target}:${warning.code}`}
                    className={cn(
                      'flex items-start gap-1.5 text-xs text-pretty',
                      warning.severity === 'error'
                        ? 'text-destructive'
                        : 'text-amber-600 dark:text-amber-400',
                    )}
                  >
                    <HugeiconsIcon
                      icon={Alert02Icon}
                      className="mt-0.5 size-3.5 shrink-0"
                    />
                    <span>{warning.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {renderExtra ? (
              <div className="mt-3">{renderExtra(target)}</div>
            ) : null}

            <div className="mt-3 flex justify-end pt-1">
              <Button
                size="sm"
                className="active:scale-[0.96]"
                onClick={() => sync.mutate({ target })}
                disabled={thisTargetSyncing || summary.blocked}
              >
                {thisTargetSyncing ? (
                  <>
                    <Spinner className="mr-1.5 size-3.5" />
                    Sincronizando…
                  </>
                ) : (
                  meta.syncLabel
                )}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
