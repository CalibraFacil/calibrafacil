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

interface CertifiedValue {
  nominal: string
  value: number
  uncertainty: number
  unit: string
  maxError?: number | null
  drift?: number | null
  buoyancy?: number | null
  coverageFactor?: number | null
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
  const calibrationBadge = getCalibrationBadge(
    standard.daysUntilExpiry,
    standard.isExpired,
  )
  const hasCertifiedValues =
    standard.certifiedValues && standard.certifiedValues.length > 0
  const hasAdvancedCertifiedValues = !!standard.certifiedValues?.some(
    (cv) =>
      cv.maxError != null ||
      cv.drift != null ||
      cv.buoyancy != null ||
      cv.coverageFactor != null,
  )
  const certifiedValues = standard.certifiedValues ?? []
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
          label={hasCertifiedValues ? 'Valores certificados' : 'Valor nominal'}
          value={
            hasCertifiedValues
              ? certifiedValues.length
              : `${standard.referenceValue ?? '-'}${uncertaintyUnit}`
          }
          detail={hasCertifiedValues ? 'Pontos cadastrados' : 'Referência base'}
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
            {hasCertifiedValues ? (
              <CertifiedValuesTable
                values={certifiedValues}
                showAdvanced={hasAdvancedCertifiedValues}
              />
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
  values,
  showAdvanced,
}: {
  values: CertifiedValue[]
  showAdvanced: boolean
}) {
  return (
    <div className="overflow-x-auto rounded-lg bg-background shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-border/70 bg-muted/35">
            <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
              Nominal
            </th>
            <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
              Valor certificado
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
                {cv.nominal}
              </td>
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
  )
}
