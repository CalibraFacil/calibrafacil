import { Link, useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Edit02Icon,
  RefreshIcon,
  AlertCircleIcon,
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
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { metrologyKindDefinition } from '@/features/standards/metrology-kinds'
import { StandardCertificateDocumentPanel } from '@/features/standards/components/standard-certificate-document-panel'

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

function formatDateTime(dateString: string | Date): string {
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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

function getCalibrationBadge(daysUntilExpiry: number, isExpired: boolean) {
  if (isExpired) {
    return {
      variant: 'destructive' as const,
      label: 'Vencido',
      className: '',
    }
  } else if (daysUntilExpiry <= 30) {
    return {
      variant: 'outline' as const,
      label: `${daysUntilExpiry} dias restantes`,
      className: 'border-orange-500 text-orange-600',
    }
  } else {
    return {
      variant: 'outline' as const,
      label: 'Válido',
      className: 'border-green-500 text-green-600',
    }
  }
}

export function StandardDetailPage({ id }: { id: string }) {
  const navigate = useNavigate()

  const { data: standard, isLoading, error } = useStandardDetailData(id)

  const { data: auditLogData } = useStandardAuditLogData(id)

  if (error) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate({ to: '/dashboard/standards' })}
          className="active:scale-[0.96]"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="size-5" />
        </Button>
        <div className="rounded-lg bg-destructive/5 px-6 py-8 text-center text-sm text-destructive shadow-[inset_0_0_0_1px_rgba(220,38,38,0.18)]">
          Erro ao carregar padrão: {error.message}
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <Skeleton className="size-9 rounded-md" />
            <div className="space-y-3">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid overflow-hidden rounded-lg bg-muted/35 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] sm:grid-cols-2 xl:grid-cols-4 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-3 px-5 py-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-6 w-36" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-8">
            {Array.from({ length: 2 }).map((_, sectionIndex) => (
              <div key={sectionIndex} className="space-y-4">
                <Skeleton className="h-5 w-40" />
                <div className="grid gap-x-8 border-t sm:grid-cols-2">
                  {Array.from({ length: 6 }).map((_, rowIndex) => (
                    <div key={rowIndex} className="space-y-2 border-b py-4">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-5 w-40" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-8 lg:border-l lg:pl-8">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2 border-b py-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-32" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!standard) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate({ to: '/dashboard/standards' })}
          className="active:scale-[0.96]"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="size-5" />
        </Button>
        <div className="rounded-lg bg-muted/35 px-6 py-8 text-center text-sm text-muted-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          Padrão de referência não encontrado.
        </div>
      </div>
    )
  }

  const statusInfo = statusConfig[standard.status]
  const kindLabel = metrologyKindDefinition(standard.kind).label
  const calibrationBadge = getCalibrationBadge(
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
  const compositionProfiles =
    metrologyData?.compositionProfiles.length === 0
      ? legacyCertifiedValues.filter(
          (value) => value.compositionProfile === true,
        )
      : (metrologyData?.compositionProfiles.map((profile) => ({
          nominal: profile.nominal,
          value: profile.value,
          uncertainty: profile.uncertainty,
          unit: profile.unit,
          maxError: profile.maxError,
          drift: profile.drift,
          buoyancy: profile.buoyancy,
          coverageFactor: profile.coverageFactor,
          compositionProfile: true,
          profileKey: profile.profileKey,
          profileClass: profile.profileClass,
          profileQuantityAvailable: profile.quantityAvailable,
        })) ??
        legacyCertifiedValues.filter(
          (value) => value.compositionProfile === true,
        ))
  const hasCertifiedValues = certificateValues.length > 0
  const hasChannels = channels.length > 0
  const hasAdvancedCertifiedValues = [
    ...certificateValues,
    ...compositionProfiles,
  ].some(
    (cv) =>
      cv.maxError != null ||
      cv.drift != null ||
      cv.buoyancy != null ||
      cv.coverageFactor != null,
  )
  const uncertaintyUnit = standard.uncertaintyUnit
    ? ` ${standard.uncertaintyUnit}`
    : ''

  return (
    <div className="space-y-10">
      <div className="space-y-4 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:space-y-0">
        <div className="flex items-start gap-3 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: '/dashboard/standards' })}
            className="mt-0.5 active:scale-[0.96]"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-5" />
            <span className="sr-only">Voltar</span>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="space-y-3">
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
                <h1 className="text-balance text-2xl font-semibold tracking-tight">
                  {standard.name}
                </h1>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                  <Badge
                    variant={calibrationBadge.variant}
                    className={calibrationBadge.className}
                  >
                    {calibrationBadge.label}
                  </Badge>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                {standard.type && (
                  <>
                    <span>{standard.type}</span>
                    <span>-</span>
                  </>
                )}
                <span className="font-mono tabular-nums">
                  {standard.serialNumber}
                </span>
              </div>
            </div>
          </div>
        </div>

        <StandardActions id={id} className="hidden sm:flex sm:shrink-0" />
      </div>

      <StandardActions id={id} mobile className="sm:hidden" />

      <dl className="grid overflow-hidden rounded-lg bg-muted/35 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] sm:grid-cols-2 xl:grid-cols-4 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <SummaryItem
          label="Certificado"
          value={standard.certificateNumber}
          detail={standard.calibratedBy || 'Laboratório não informado'}
          mono
          className="border-b border-border/70 sm:border-r xl:border-b-0"
        />
        <SummaryItem
          label="Próxima calibração"
          value={
            <span className="inline-flex items-center gap-2">
              {formatDate(standard.nextCalibrationDate)}
              {standard.isExpired && (
                <HugeiconsIcon
                  icon={AlertCircleIcon}
                  className="size-4 text-destructive"
                />
              )}
            </span>
          }
          detail="Prazo de rastreabilidade"
          mono
          className="border-b border-border/70 xl:border-r xl:border-b-0"
        />
        <SummaryItem
          label={
            hasChannels
              ? 'Canais'
              : hasCertifiedValues
                ? 'Valores certificados'
                : 'Valor nominal'
          }
          value={
            hasChannels
              ? channels.length
              : hasCertifiedValues
                ? certificateValues.length
                : `${standard.referenceValue ?? '-'}${uncertaintyUnit}`
          }
          detail={
            hasChannels
              ? 'Grandezas instrumentais'
              : hasCertifiedValues
                ? `${compositionProfiles.length} perfis de composição`
                : 'Referência base'
          }
          mono
          className="border-b border-border/70 sm:border-r sm:border-b-0"
        />
        <SummaryItem
          label="Incerteza"
          value={
            standard.uncertainty != null
              ? `+/-${standard.uncertainty}${uncertaintyUnit}`
              : `k=${standard.coverageFactor}`
          }
          detail={`Distribuição ${standard.distribution === 'normal' ? 'normal' : 'retangular'}`}
          mono
        />
      </dl>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-10">
          <DetailSection
            title="Identificação"
            description="Dados usados para reconhecer o padrão no laboratório e nos certificados."
          >
            <dl className="grid gap-x-8 border-t border-border/70 sm:grid-cols-2">
              <DetailItem label="Nome" value={standard.name} />
              <DetailItem label="Grandeza" value={kindLabel} />
              <DetailItem label="Tipo" value={standard.type || '-'} />
              <DetailItem
                label="Número de série"
                value={standard.serialNumber}
                mono
              />
              <DetailItem
                label="Fabricante"
                value={standard.manufacturer || '-'}
              />
              <DetailItem label="Modelo" value={standard.model || '-'} />
              <DetailItem label="Status">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                  <Badge
                    variant={calibrationBadge.variant}
                    className={calibrationBadge.className}
                  >
                    {calibrationBadge.label}
                  </Badge>
                </div>
              </DetailItem>
            </dl>
          </DetailSection>

          <DetailSection
            title="Dados metrológicos"
            description="Valores certificados, incerteza e parâmetros usados nos cálculos."
          >
            {hasChannels && (
              <div className="mb-6">
                <ChannelsTable channels={channels} />
              </div>
            )}

            {hasCertifiedValues ? (
              <div className="space-y-6">
                <CertifiedValuesTable
                  title="Valores do certificado"
                  values={certificateValues}
                  showAdvanced={hasAdvancedCertifiedValues}
                />
                {compositionProfiles.length > 0 && (
                  <CertifiedValuesTable
                    title="Perfis de composição"
                    values={compositionProfiles}
                    showAdvanced={hasAdvancedCertifiedValues}
                    profileTable
                  />
                )}
              </div>
            ) : (
              <dl className="grid gap-x-8 border-t border-border/70 sm:grid-cols-3">
                <DetailItem
                  label="Valor de referência"
                  value={`${standard.referenceValue ?? '-'}${uncertaintyUnit}`}
                  mono
                />
                <DetailItem
                  label="Incerteza (U)"
                  value={
                    standard.uncertainty != null
                      ? `+/-${standard.uncertainty}${uncertaintyUnit}`
                      : '-'
                  }
                  mono
                />
                <DetailItem
                  label="Fator de cobertura (k)"
                  value={standard.coverageFactor}
                  mono
                />
              </dl>
            )}

            <dl className="mt-6 grid gap-x-8 border-t border-border/70 sm:grid-cols-3">
              <DetailItem
                label="Fator de cobertura (k)"
                value={standard.coverageFactor}
                mono
              />
              <DetailItem
                label="Distribuição"
                value={
                  standard.distribution === 'normal' ? 'Normal' : 'Retangular'
                }
              />
              <DetailItem
                label="Drift"
                value={standard.drift != null ? standard.drift : '-'}
                mono
              />
            </dl>
          </DetailSection>
        </div>

        <aside className="space-y-10 lg:border-l lg:border-border/70 lg:pl-8">
          <DetailSection
            title="Certificado"
            description="Rastreabilidade e ciclo de calibração."
          >
            <div className="mb-4">
              <StandardCertificateDocumentPanel standard={standard} />
            </div>
            <dl className="border-t border-border/70">
              <DetailItem
                label="Número do certificado"
                value={standard.certificateNumber}
                mono
              />
              <DetailItem
                label="Calibrado por"
                value={standard.calibratedBy || '-'}
              />
              <DetailItem
                label="Data de calibração"
                value={formatDate(standard.calibrationDate)}
                mono
              />
              <DetailItem label="Próxima calibração" mono>
                <span className="inline-flex items-center gap-2">
                  {formatDate(standard.nextCalibrationDate)}
                  {standard.isExpired && (
                    <HugeiconsIcon
                      icon={AlertCircleIcon}
                      className="size-4 text-destructive"
                    />
                  )}
                </span>
              </DetailItem>
            </dl>
          </DetailSection>

          <DetailSection title="Metadados">
            <dl className="border-t border-border/70">
              <DetailItem
                label="Criado em"
                value={formatDateTime(standard.createdAt)}
                mono
              />
              <DetailItem
                label="Atualizado em"
                value={formatDateTime(standard.updatedAt)}
                mono
              />
            </dl>
          </DetailSection>
        </aside>
      </div>

      {auditLogData?.data && auditLogData.data.length > 0 && (
        <DetailSection
          title="Histórico de alterações"
          description="Registros de controle para rastreabilidade ISO 17025."
        >
          <div className="border-t border-border/70 pt-4">
            <AuditTimeline
              events={buildAuditTimelineEvents(auditLogData.data)}
              title="Histórico de Alterações (ISO 17025)"
              showCard={false}
            />
          </div>
        </DetailSection>
      )}
    </div>
  )
}

function StandardActions({
  id,
  mobile = false,
  className,
}: {
  id: string
  mobile?: boolean
  className?: string
}) {
  return (
    <div className={cn(mobile ? 'grid gap-2' : 'gap-2', className)}>
      <Button
        variant="outline"
        render={
          <Link
            to="/dashboard/standards/$id/edit"
            params={{ id }}
            search={{ renew: true }}
          />
        }
        className={cn(
          'active:scale-[0.96]',
          mobile && 'h-10 w-full justify-center rounded-md',
        )}
      >
        <HugeiconsIcon icon={RefreshIcon} className="mr-2 size-4" />
        Renovar
      </Button>
      <Button
        render={<Link to="/dashboard/standards/$id/edit" params={{ id }} />}
        className={cn(
          'active:scale-[0.96]',
          mobile && 'h-10 w-full justify-center rounded-md',
        )}
      >
        <HugeiconsIcon icon={Edit02Icon} className="mr-2 size-4" />
        Editar
      </Button>
    </div>
  )
}

function SummaryItem({
  label,
  value,
  detail,
  mono = false,
  className,
}: {
  label: string
  value: ReactNode
  detail?: string
  mono?: boolean
  className?: string
}) {
  return (
    <div className={cn('min-w-0 px-5 py-4', className)}>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-2 truncate text-base font-medium tabular-nums',
          mono && 'font-mono',
        )}
      >
        {value}
      </dd>
      {detail ? (
        <dd className="mt-1 text-pretty text-xs text-muted-foreground">
          {detail}
        </dd>
      ) : null}
    </div>
  )
}

function DetailSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-4', className)}>
      <div className="max-w-2xl">
        <h2 className="text-balance text-base font-medium">{title}</h2>
        {description ? (
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function DetailItem({
  label,
  value,
  mono = false,
  children,
}: {
  label: string
  value?: ReactNode
  mono?: boolean
  children?: ReactNode
}) {
  return (
    <div className="min-w-0 border-b border-border/70 py-4">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-1 min-w-0 text-sm text-foreground',
          mono && 'font-mono tabular-nums',
        )}
      >
        {children ?? value ?? '-'}
      </dd>
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
      <div className="rounded-lg border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
        Nenhum {profileTable ? 'perfil' : 'valor certificado'} cadastrado.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="overflow-x-auto rounded-lg bg-background shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-border/70 bg-muted/35">
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
                  +/-{cv.uncertainty}
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
      <div className="overflow-x-auto rounded-lg bg-background shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
        <table className="w-full min-w-[42rem] text-sm">
          <thead>
            <tr className="border-b border-border/70 bg-muted/35">
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
      <div className="overflow-x-auto rounded-lg bg-background shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-border/70 bg-muted/35">
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
