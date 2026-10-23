import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle02Icon,
  CheckmarkBadge02Icon,
  Target02Icon,
  RulerIcon,
  FunctionIcon,
  Calendar03Icon,
} from '@hugeicons/core-free-icons'
import { Badge } from '@calibra-facil/ui/badge'
import {
  formatDate,
  type ApprovedJobRecordData,
} from '@/features/jobs/detail-model'
import {
  BlueprintOverlay,
  Panel,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@calibra-facil/ui/instrument-panel'
import { cn } from '@/lib/utils'
import { CertificateReleaseControl } from '@/features/finance/certificate-release'

export function ApprovedRecordHero({
  job,
  isSuperseded,
  isOutOfToleranceAsFound,
  pointsTotal,
  pointsWithin,
  standardsCount,
  expandedUncertainty,
}: {
  job: ApprovedJobRecordData
  isSuperseded: boolean
  isOutOfToleranceAsFound: boolean
  pointsTotal: number
  pointsWithin: number
  standardsCount: number
  expandedUncertainty: string | null | undefined
}) {
  const { methodSnapshot } = job

  return (
    <Panel className="relative overflow-hidden">
      <BlueprintOverlay />
      <div className="relative flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span
              className={cn(
                'relative flex size-16 shrink-0 items-center justify-center rounded-full',
                isSuperseded
                  ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
                  : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'absolute inset-1 rounded-full border border-dashed',
                  isSuperseded
                    ? 'border-amber-500/40'
                    : 'border-emerald-500/40',
                )}
              />
              <HugeiconsIcon icon={CheckmarkBadge02Icon} className="size-8" />
            </span>
            <div className="min-w-0">
              <h1 className="text-balance font-mono text-2xl font-semibold tracking-tight">
                {job.jobId}
              </h1>
              <p className="mt-0.5 text-pretty text-sm text-muted-foreground">
                {job.serviceName}
                {methodSnapshot.methodName && (
                  <span className="ml-2 text-xs">
                    ({methodSnapshot.methodName} v{methodSnapshot.methodVersion}
                    )
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            <Badge
              variant={isSuperseded ? 'outline' : 'default'}
              className={cn(
                isSuperseded
                  ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                  : 'bg-emerald-600 text-white',
              )}
            >
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                className="mr-1 h-3 w-3"
              />
              {isSuperseded ? 'Retificado' : 'Aprovado'}
            </Badge>
            {isOutOfToleranceAsFound && (
              <Badge variant="destructive">
                Fora de tolerância (como encontrado)
              </Badge>
            )}
            <CertificateReleaseControl
              calibrationJobId={job.id}
              jobStatus={job.status}
            />
          </div>
        </div>

        <StaggerGroup className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
          {pointsTotal > 0 && (
            <StaggerItem>
              <SignalTile
                icon={Target02Icon}
                label="Pontos na tolerância"
                value={`${pointsWithin}/${pointsTotal}`}
                hint="pontos"
                tone={pointsWithin === pointsTotal ? 'ok' : 'warning'}
              />
            </StaggerItem>
          )}
          <StaggerItem>
            <SignalTile
              icon={RulerIcon}
              label="Rastreabilidade"
              value={String(standardsCount)}
              hint="padrões"
              tone={standardsCount > 0 ? 'info' : 'neutral'}
            />
          </StaggerItem>
          {expandedUncertainty && (
            <StaggerItem>
              <SignalTile
                icon={FunctionIcon}
                label="Incerteza U (máx.)"
                value={expandedUncertainty}
                hint="expandida"
                tone="neutral"
              />
            </StaggerItem>
          )}
          <StaggerItem>
            <SignalTile
              icon={Calendar03Icon}
              label="Aprovado em"
              value={formatDate(job.approvedAt)}
              hint={job.approverName ?? undefined}
              tone="neutral"
            />
          </StaggerItem>
        </StaggerGroup>
      </div>
    </Panel>
  )
}
