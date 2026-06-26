import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Calendar03Icon,
  CheckmarkBadge02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Alert02Icon,
  CalendarRemove01Icon,
  PackageRemoveIcon,
  Edit02Icon,
} from '@hugeicons/core-free-icons'

import {
  useAssetAuditLogData,
  useAssetDetailData,
} from '@/features/assets/queries'
import {
  buildAssetCalibrationStatus,
  formatDate,
  type AssetCalibrationLevel,
} from '@/features/assets/detail-model'
import type { AssetStatus } from '@/features/assets/types'
import {
  AuditTimeline,
  buildAuditTimelineEvents,
} from '@/components/audit-timeline'
import { clientRouteId } from '@/lib/route-identifiers'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SpecificationsDisplay } from '@/components/specifications-display'
import {
  ACTION_BUTTON_CLASS,
  BlueprintField,
  BlueprintGrid,
  BlueprintOverlay,
  InfoHint,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from '@/components/instrument-panel'
import {
  ECCENTRICITY_INDICATOR_SPEC_KEY,
  EccentricityIndicator,
  isEccentricityIndicatorPosition,
  isWeighingScaleAssetType,
} from '@/components/eccentricity-indicator'
import { cn } from '@/lib/utils'

type HugeIcon = Parameters<typeof HugeiconsIcon>[0]['icon']

const statusLabels: Record<AssetStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  MAINTENANCE: 'Em Manutenção',
  SCRAPPED: 'Descartado',
}

const statusVariants: Record<
  AssetStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  ACTIVE: 'default',
  INACTIVE: 'secondary',
  MAINTENANCE: 'outline',
  SCRAPPED: 'destructive',
}

function parseStatus(status: string): AssetStatus {
  switch (status) {
    case 'INACTIVE':
    case 'MAINTENANCE':
    case 'SCRAPPED':
      return status
    default:
      return 'ACTIVE'
  }
}

const LEVEL_ICON: Record<AssetCalibrationLevel, HugeIcon> = {
  valid: CheckmarkBadge02Icon,
  due_soon: Alert02Icon,
  overdue: CalendarRemove01Icon,
  unscheduled: Calendar03Icon,
  retired: PackageRemoveIcon,
}

const EMBLEM_CLASS: Record<SignalTone, string> = {
  ok: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  critical: 'bg-destructive/12 text-destructive',
  warning: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
  info: 'bg-primary/12 text-primary',
  neutral: 'bg-muted text-muted-foreground',
}

const VERDICT_TEXT_CLASS: Record<SignalTone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  critical: 'text-destructive',
  warning: 'text-amber-700 dark:text-amber-400',
  info: 'text-primary',
  neutral: 'text-foreground',
}

function pluralDays(count: number): string {
  return count === 1 ? 'dia' : 'dias'
}

export function AssetDetailPage({ id }: { id: string }) {
  const { data: asset, isLoading, error } = useAssetDetailData(id)
  // Audit log for ISO 17025 compliance (Clause 8.4)
  const { data: auditLogData } = useAssetAuditLogData(id)

  if (isLoading) {
    return <AssetDetailSkeleton />
  }

  if (error || !asset) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          Erro ao carregar informações do ativo.
        </p>
      </Panel>
    )
  }

  const specifications = asset.specifications ?? null
  const definition = asset.assetTypeDefinition ?? null
  const visibleDefinition =
    definition?.filter(
      (field) => field.key !== ECCENTRICITY_INDICATOR_SPEC_KEY,
    ) ?? null
  const hasSpecs = Boolean(visibleDefinition && visibleDefinition.length > 0)
  const selectedIndicatorPosition = isEccentricityIndicatorPosition(
    specifications?.[ECCENTRICITY_INDICATOR_SPEC_KEY],
  )
    ? specifications?.[ECCENTRICITY_INDICATOR_SPEC_KEY]
    : null
  const showEccentricityIndicator = isWeighingScaleAssetType({
    name: asset.assetTypeName,
    slug: asset.assetTypeSlug,
  })

  const calibration = buildAssetCalibrationStatus(asset)
  const days = calibration.daysUntilNext

  const nextHint =
    days === null
      ? calibration.level === 'retired'
        ? 'descartado'
        : 'aguardando definição do cliente'
      : days < 0
        ? `há ${Math.abs(days)} ${pluralDays(Math.abs(days))}`
        : days === 0
          ? 'hoje'
          : `em ${days} ${pluralDays(days)}`

  const remainingValue = days === null ? '—' : String(Math.abs(days))
  const remainingHint =
    days === null
      ? 'sem prazo'
      : days < 0
        ? 'dias em atraso'
        : days === 0
          ? 'vence hoje'
          : 'dias restantes'

  const auditEvents = auditLogData?.data?.length
    ? buildAuditTimelineEvents(auditLogData.data)
    : []

  return (
    <div className="space-y-6">
      {/* Identity + calibration-health hero — all the asset's headline data in one place */}
      <Panel className="relative overflow-hidden">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {asset.tag}
              </p>
              <h1 className="text-balance text-2xl font-semibold tracking-tight">
                {asset.name}
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                <Link
                  to="/dashboard/clients/$id"
                  params={{
                    id: clientRouteId({
                      name: asset.customerName,
                      taxId: asset.customerTaxId,
                    }),
                  }}
                  className="underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  {asset.customerName}
                </Link>
              </p>
            </div>
            <Badge
              variant={statusVariants[parseStatus(asset.status)]}
              className="shrink-0"
            >
              {statusLabels[parseStatus(asset.status)]}
            </Badge>
          </div>

          <div className="grid gap-4 border-t border-foreground/10 pt-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="flex items-start gap-4">
              <span
                className={cn(
                  'relative flex size-14 shrink-0 items-center justify-center rounded-2xl',
                  EMBLEM_CLASS[calibration.tone],
                )}
              >
                <HugeiconsIcon
                  icon={LEVEL_ICON[calibration.level]}
                  className="size-7"
                />
              </span>
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Validade da calibração
                  <InfoHint label="Sobre a validade da calibração">
                    O intervalo de recalibração garante que o instrumento
                    permaneça dentro das tolerâncias declaradas. Após o
                    vencimento, os resultados deixam de ter rastreabilidade
                    assegurada até a nova calibração.
                  </InfoHint>
                </p>
                <p
                  className={cn(
                    'text-balance text-2xl font-semibold',
                    VERDICT_TEXT_CLASS[calibration.tone],
                  )}
                >
                  {calibration.label}
                </p>
                <p className="mt-0.5 text-pretty text-sm text-muted-foreground">
                  {calibration.description}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
              <Button
                render={
                  <Link to="/dashboard/assets/$id/edit" params={{ id }} />
                }
                className={cn(ACTION_BUTTON_CLASS, 'w-full sm:w-auto')}
              >
                <HugeiconsIcon icon={Edit02Icon} className="mr-2 size-4" />
                Editar ativo
              </Button>
            </div>
          </div>

          <StaggerGroup className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
            <StaggerItem>
              <SignalTile
                icon={Calendar03Icon}
                label="Próxima calibração"
                value={formatDate(asset.nextCalibrationDate)}
                hint={nextHint}
                tone={calibration.tone}
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={Clock01Icon}
                label="Validade restante"
                value={remainingValue}
                hint={remainingHint}
                tone={calibration.tone}
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={CheckmarkCircle02Icon}
                label="Última calibração"
                value={formatDate(asset.lastCalibrationDate)}
                hint="registrada"
                tone="neutral"
              />
            </StaggerItem>
          </StaggerGroup>
        </div>
      </Panel>

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-w-0 space-y-6">
          <Panel className="p-4 sm:p-5">
            <PanelHeader
              eyebrow="Identificação"
              title="Dados do instrumento"
              description="Informações usadas para reconhecer o ativo no laboratório e nos certificados."
            />
            <BlueprintGrid className="mt-4 sm:grid-cols-2 lg:grid-cols-3">
              <BlueprintField label="Número de série" mono>
                {asset.serialNumber || '—'}
              </BlueprintField>
              <BlueprintField label="Fabricante">
                {asset.manufacturer || '—'}
              </BlueprintField>
              <BlueprintField label="Modelo">
                {asset.model || '—'}
              </BlueprintField>
              <BlueprintField label="Tipo de instrumento">
                {asset.assetTypeName || '—'}
              </BlueprintField>
              {asset.baseMeasurementUnit ? (
                <BlueprintField label="Unidade base">
                  <Badge variant="secondary" className="font-mono">
                    {asset.baseMeasurementUnit}
                  </Badge>
                </BlueprintField>
              ) : null}
            </BlueprintGrid>
          </Panel>

          {hasSpecs || showEccentricityIndicator ? (
            <Panel className="p-4 sm:p-5">
              <PanelHeader
                eyebrow="Características"
                title="Especificações técnicas"
                description="Parâmetros do instrumento aplicados durante a calibração."
              />
              {hasSpecs ? (
                <div className="mt-4">
                  <SpecificationsDisplay
                    definition={visibleDefinition ?? []}
                    specifications={specifications}
                    activeMassUnit={asset.baseMeasurementUnit ?? null}
                  />
                </div>
              ) : null}
              {showEccentricityIndicator ? (
                <EccentricityIndicator
                  value={selectedIndicatorPosition}
                  readOnly
                  className={hasSpecs ? 'mt-5' : 'mt-4 border-t-0 pt-0'}
                />
              ) : null}
            </Panel>
          ) : null}

          {asset.comments ? (
            <Panel className="p-4 sm:p-5">
              <PanelHeader eyebrow="Notas" title="Observações" />
              <p className="mt-4 whitespace-pre-wrap text-pretty text-sm leading-6 text-muted-foreground">
                {asset.comments}
              </p>
            </Panel>
          ) : null}
        </main>

        <aside className="min-w-0 space-y-6 xl:sticky xl:top-6">
          <Panel className="p-4 sm:p-5">
            <PanelHeader eyebrow="Programação" title="Calibração" />
            <BlueprintGrid className="mt-4">
              <BlueprintField label="Última calibração" mono>
                {formatDate(asset.lastCalibrationDate)}
              </BlueprintField>
              <BlueprintField
                label={
                  <span className="inline-flex items-center gap-1">
                    Próxima calibração
                    <InfoHint label="Sobre a próxima calibração">
                      A periodicidade de calibração é definida pelo cliente no
                      portal — o laboratório não atribui periodicidade (NBR
                      ISO/IEC 17025 §7.8.4.3). Exibida aqui somente para
                      consulta.
                    </InfoHint>
                  </span>
                }
                mono
              >
                {formatDate(asset.nextCalibrationDate)}
              </BlueprintField>
            </BlueprintGrid>
          </Panel>

          {auditEvents.length > 0 ? (
            <Panel className="p-4 sm:p-5">
              <PanelHeader
                eyebrow="Atividade"
                title="Histórico de alterações"
              />
              <div className="mt-4">
                <AuditTimeline events={auditEvents} showCard={false} />
              </div>
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

function AssetDetailSkeleton(): ReactNode {
  return (
    <div className="space-y-6">
      <Panel className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <Skeleton className="size-14 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-7 w-52" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <div className="mt-5 grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-[88px] rounded-xl" />
          ))}
        </div>
      </Panel>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    </div>
  )
}
