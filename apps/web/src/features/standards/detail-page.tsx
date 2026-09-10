import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertCircleIcon,
  Calendar03Icon,
  Clock01Icon,
  Edit02Icon,
  RefreshIcon,
  RulerIcon,
  Target02Icon,
} from '@hugeicons/core-free-icons'
import type { ReactNode } from 'react'

import {
  useStandardAuditLogData,
  useStandardDetailData,
} from '@/features/standards/queries'
import type { StandardStatus } from '@/features/standards/types'
import {
  AuditTimeline,
  buildAuditTimelineEvents,
} from '@/components/audit-timeline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ACTION_BUTTON_CLASS,
  BlueprintField,
  BlueprintGrid,
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from '@/components/instrument-panel'
import { metrologyKindDefinition } from '@/features/standards/metrology-kinds'
import { StandardCertificateDocumentPanel } from '@/features/standards/components/standard-certificate-document-panel'
import { StandardRecallPanel } from '@/features/standards/components/standard-recall-panel'
import { StandardSpcPanel } from '@/features/spc/components/standard-spc-panel'

interface CertifiedValue {
  nominal: string
  value: number
  uncertainty: number
  unit: string
  maxError?: number | null
  drift?: number | null
  buoyancy?: number | null
  coverageFactor?: number | null
  compositionProfile?: boolean
  profileKey?: string | null
  profileClass?: string | null
  profileQuantityAvailable?: number | null
}

interface MetrologyChannel {
  key: string
  label: string
  quantity: string
  value?: number | null
  correction?: number | null
  uncertainty?: number | null
  unit: string
  coverageFactor?: number | null
  drift?: number | null
  points?: Array<{
    reference?: number | null
    indication?: number | null
    meanReading?: number | null
    correction?: number | null
    uncertainty?: number | null
    unit: string
    coverageFactor?: number | null
    degreesOfFreedom?: number | null
    degreesOfFreedomOperator?: 'exact' | 'greater_than' | 'infinity'
    repeatability?: number | null
    metadata?: Record<string, unknown>
  }>
}

const statusConfig: Record<
  StandardStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
  }
> = {
  ACTIVE: { label: 'Ativo', variant: 'default' },
  INACTIVE: { label: 'Inativo', variant: 'secondary' },
  OUT_OF_TOLERANCE: { label: 'Fora de Tolerância', variant: 'destructive' },
  SENT_FOR_CALIBRATION: { label: 'Em Calibração', variant: 'outline' },
}

function formatDate(dateString: string | Date): string {
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatDegreesOfFreedom(
  point: NonNullable<MetrologyChannel['points']>[number],
) {
  if (point.degreesOfFreedomOperator === 'infinity') return 'Infinity'
  if (point.degreesOfFreedom == null) return '-'
  if (point.degreesOfFreedomOperator === 'greater_than') {
    return `>${point.degreesOfFreedom}`
  }
  return point.degreesOfFreedom
}

function calibrationLabel(daysUntilExpiry: number, isExpired: boolean): string {
  if (isExpired) return 'Vencido'
  if (daysUntilExpiry <= 30) return `${daysUntilExpiry} dias restantes`
  return 'Válido'
}

function calibrationTone(
  daysUntilExpiry: number,
  isExpired: boolean,
): SignalTone {
  if (isExpired) return 'critical'
  if (daysUntilExpiry <= 30) return 'warning'
  return 'ok'
}

export function StandardDetailPage({ id }: { id: string }) {
  const { data: standard, isLoading, error } = useStandardDetailData(id)
  const { data: auditLogData } = useStandardAuditLogData(id)

  if (isLoading) {
    return <StandardDetailSkeleton />
  }

  if (error || !standard) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          {error
            ? `Erro ao carregar padrão: ${error.message}`
            : 'Padrão de referência não encontrado.'}
        </p>
      </Panel>
    )
  }

  const statusInfo = statusConfig[standard.status]
  const kindLabel = metrologyKindDefinition(standard.kind).label
  const calTone = calibrationTone(standard.daysUntilExpiry, standard.isExpired)
  const calLabel = calibrationLabel(
    standard.daysUntilExpiry,
    standard.isExpired,
  )
  const metrologyData = standard.metrologyData
  const channels = metrologyData?.channels ?? []
  const legacyCertifiedValues = standard.certifiedValues ?? []
  const certificateValues =
    metrologyData?.massValues.length === 0
      ? legacyCertifiedValues.filter(
          (value) => value.compositionProfile !== true,
        )
      : (metrologyData?.massValues ??
        legacyCertifiedValues.filter(
          (value) => value.compositionProfile !== true,
        ))
  const hasCertifiedValues = certificateValues.length > 0
  const hasChannels = channels.length > 0
  const hasAdvancedCertifiedValues = certificateValues.some(
    (cv) =>
      cv.maxError != null ||
      cv.drift != null ||
      cv.buoyancy != null ||
      cv.coverageFactor != null,
  )
  const uncertaintyUnit = standard.uncertaintyUnit
    ? ` ${standard.uncertaintyUnit}`
    : ''
  const referenceValue = hasChannels
    ? String(channels.length)
    : hasCertifiedValues
      ? String(certificateValues.length)
      : `${standard.referenceValue ?? '—'}${uncertaintyUnit}`
  const referenceHint = hasChannels
    ? 'canais'
    : hasCertifiedValues
      ? 'valores certificados'
      : 'referência'
  const auditEvents = auditLogData?.data?.length
    ? buildAuditTimelineEvents(auditLogData.data)
    : []

  return (
    <div className="space-y-6">
      {/* Identity + calibration-health hero */}
      <Panel className="relative overflow-hidden">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-balance text-2xl font-semibold tracking-tight">
                  {standard.name}
                </h1>
                <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                <Badge variant="outline">{kindLabel}</Badge>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                {standard.type ? (
                  <>
                    <span>{standard.type}</span>
                    <span aria-hidden className="text-foreground/20">
                      ·
                    </span>
                  </>
                ) : null}
                <span className="font-mono tabular-nums">
                  SN {standard.serialNumber}
                </span>
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                variant="outline"
                render={
                  <Link
                    to="/dashboard/standards/$id/edit"
                    params={{ id }}
                    search={{ renew: true }}
                  />
                }
                className={ACTION_BUTTON_CLASS}
              >
                <HugeiconsIcon icon={RefreshIcon} className="mr-2 size-4" />
                Renovar
              </Button>
              <Button
                render={
                  <Link to="/dashboard/standards/$id/edit" params={{ id }} />
                }
                className={ACTION_BUTTON_CLASS}
              >
                <HugeiconsIcon icon={Edit02Icon} className="mr-2 size-4" />
                Editar
              </Button>
            </div>
          </div>

          <StaggerGroup className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
            <StaggerItem>
              <SignalTile
                icon={Calendar03Icon}
                label="Próxima calibração"
                value={formatDate(standard.nextCalibrationDate)}
                hint={calLabel}
                tone={calTone}
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={Clock01Icon}
                label="Validade restante"
                value={String(Math.abs(standard.daysUntilExpiry))}
                hint={standard.isExpired ? 'dias vencido' : 'dias'}
                tone={calTone}
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={Target02Icon}
                label="Incerteza"
                value={
                  standard.uncertainty != null
                    ? `±${standard.uncertainty}${uncertaintyUnit}`
                    : `k=${standard.coverageFactor}`
                }
                hint={
                  standard.distribution === 'normal' ? 'normal' : 'retangular'
                }
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={RulerIcon}
                label="Metrologia"
                value={referenceValue}
                hint={referenceHint}
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
              title="Dados do padrão"
              description="Informações usadas para reconhecer o padrão no laboratório e nos certificados."
            />
            <BlueprintGrid className="mt-4 sm:grid-cols-2 lg:grid-cols-3">
              <BlueprintField label="Nome">{standard.name}</BlueprintField>
              <BlueprintField label="Grandeza">{kindLabel}</BlueprintField>
              <BlueprintField label="Tipo">
                {standard.type || '—'}
              </BlueprintField>
              <BlueprintField label="Número de série" mono>
                {standard.serialNumber}
              </BlueprintField>
              <BlueprintField label="Fabricante">
                {standard.manufacturer || '—'}
              </BlueprintField>
              <BlueprintField label="Modelo">
                {standard.model || '—'}
              </BlueprintField>
            </BlueprintGrid>
          </Panel>

          <Panel className="p-4 sm:p-5">
            <PanelHeader
              title="Dados metrológicos"
              description="Valores certificados, incerteza e parâmetros usados nos cálculos."
            />
            <div className="mt-4 space-y-6">
              {hasChannels ? <ChannelsTable channels={channels} /> : null}

              {hasCertifiedValues ? (
                <CertifiedValuesTable
                  title="Valores do certificado"
                  values={certificateValues}
                  showAdvanced={hasAdvancedCertifiedValues}
                />
              ) : (
                <BlueprintGrid className="sm:grid-cols-3">
                  <BlueprintField label="Valor de referência" mono>
                    {`${standard.referenceValue ?? '—'}${uncertaintyUnit}`}
                  </BlueprintField>
                  <BlueprintField label="Incerteza (U)" mono>
                    {standard.uncertainty != null
                      ? `±${standard.uncertainty}${uncertaintyUnit}`
                      : '—'}
                  </BlueprintField>
                  <BlueprintField label="Fator de cobertura (k)" mono>
                    {standard.coverageFactor}
                  </BlueprintField>
                </BlueprintGrid>
              )}

              <BlueprintGrid className="sm:grid-cols-3">
                <BlueprintField label="Fator de cobertura (k)" mono>
                  {standard.coverageFactor}
                </BlueprintField>
                <BlueprintField label="Distribuição">
                  {standard.distribution === 'normal' ? 'Normal' : 'Retangular'}
                </BlueprintField>
                <BlueprintField label="Drift" mono>
                  {standard.drift != null ? standard.drift : '—'}
                </BlueprintField>
              </BlueprintGrid>
            </div>
          </Panel>

          <StandardSpcPanel standardId={id} />

          <StandardRecallPanel id={id} standardStatus={standard.status} />
        </main>

        <aside className="min-w-0 space-y-6">
          <Panel className="p-4 sm:p-5">
            <PanelHeader title="Certificado" />
            <div className="mt-4 space-y-4">
              <StandardCertificateDocumentPanel standard={standard} />
              <BlueprintGrid>
                <BlueprintField label="Número do certificado" mono>
                  {standard.certificateNumber}
                </BlueprintField>
                <BlueprintField label="Calibrado por">
                  {standard.calibratedBy || '—'}
                </BlueprintField>
                <BlueprintField label="Data de calibração" mono>
                  {formatDate(standard.calibrationDate)}
                </BlueprintField>
                <BlueprintField label="Próxima calibração" mono>
                  <span className="inline-flex items-center gap-2">
                    {formatDate(standard.nextCalibrationDate)}
                    {standard.isExpired ? (
                      <HugeiconsIcon
                        icon={AlertCircleIcon}
                        className="size-4 text-destructive"
                      />
                    ) : null}
                  </span>
                </BlueprintField>
              </BlueprintGrid>
            </div>
          </Panel>

          {auditEvents.length > 0 ? (
            <Panel className="p-4 sm:p-5">
              <PanelHeader title="Histórico" />
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

function CertifiedValuesTable({
  title,
  values,
  showAdvanced,
  profileTable = false,
}: {
  title: string
  values: CertifiedValue[]
  showAdvanced: boolean
  profileTable?: boolean
}) {
  if (values.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
        Nenhum {profileTable ? 'perfil' : 'valor certificado'} cadastrado.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="overflow-x-auto rounded-xl bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-border/70 bg-muted/40">
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                {profileTable ? 'Perfil' : 'Nominal'}
              </th>
              {profileTable && (
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Classe
                </th>
              )}
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                Valor
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                Incerteza (U)
              </th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                Unidade
              </th>
              {showAdvanced && (
                <>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    Erro máximo
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    Deriva
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    Empuxo
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    k
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {values.map((cv, index) => (
              <tr
                key={`${cv.nominal}-${index}`}
                className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/35"
              >
                <td className="px-3 py-2.5 font-mono tabular-nums">
                  {profileTable ? (cv.profileKey ?? cv.nominal) : cv.nominal}
                </td>
                {profileTable && (
                  <td className="px-3 py-2.5">
                    {cv.profileClass ? (
                      <Badge variant="secondary">{cv.profileClass}</Badge>
                    ) : (
                      '-'
                    )}
                  </td>
                )}
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {cv.value}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  ±{cv.uncertainty}
                </td>
                <td className="px-3 py-2.5">{cv.unit}</td>
                {showAdvanced && (
                  <>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {cv.maxError ?? '-'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {cv.drift ?? '-'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {cv.buoyancy ?? '-'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {cv.coverageFactor ?? '-'}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ChannelsTable({ channels }: { channels: MetrologyChannel[] }) {
  if (channels.length === 0) {
    return null
  }

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-medium">Canais metrológicos</h3>
      <div className="overflow-x-auto rounded-xl bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
        <table className="w-full min-w-[42rem] text-sm">
          <thead>
            <tr className="border-b border-border/70 bg-muted/40">
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                Canal
              </th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                Chave
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                Valor
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                Correção
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                Incerteza
              </th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                Unidade
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                k
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                Pontos
              </th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr
                key={channel.key}
                className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/35"
              >
                <td className="px-3 py-2.5">{channel.label}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{channel.key}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {channel.value ?? '-'}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {channel.correction ?? '-'}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {channel.uncertainty ?? '-'}
                </td>
                <td className="px-3 py-2.5">{channel.unit}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {channel.coverageFactor ?? '-'}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {channel.points?.length ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {channels
        .filter((channel) => (channel.points?.length ?? 0) > 0)
        .map((channel) => (
          <ChannelPointsTable key={channel.key} channel={channel} />
        ))}
    </div>
  )
}

function ChannelPointsTable({ channel }: { channel: MetrologyChannel }) {
  const points = channel.points ?? []
  if (points.length === 0) return null

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">
        {channel.label}: pontos calibrados
      </h4>
      <div className="overflow-x-auto rounded-xl bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-border/70 bg-muted/40">
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                Referência
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                Indicação
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                Média
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                Tendência
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                U
              </th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                Unidade
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                k
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                Graus de liberdade
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => (
              <tr
                key={`${channel.key}-${index}`}
                className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/35"
              >
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {point.reference ?? '-'}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {point.indication ?? '-'}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {point.meanReading ?? '-'}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {point.correction ?? '-'}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {point.uncertainty ?? '-'}
                </td>
                <td className="px-3 py-2.5">{point.unit}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {point.coverageFactor ?? '-'}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {formatDegreesOfFreedom(point)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StandardDetailSkeleton(): ReactNode {
  return (
    <div className="space-y-6">
      <Panel className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-7 w-72 max-w-full" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-9 w-40 rounded-md" />
        </div>
        <div className="mt-5 grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
          {Array.from({ length: 4 }).map((_item, index) => (
            <Skeleton key={index} className="h-[88px] rounded-xl" />
          ))}
        </div>
      </Panel>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  )
}
