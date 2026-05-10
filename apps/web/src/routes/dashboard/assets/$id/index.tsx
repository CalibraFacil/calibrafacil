import { createFileRoute, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import {
  AuditTimeline,
  buildAuditTimelineEvents,
  type AuditLogRecord,
} from '@/components/audit-timeline'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { SpecificationsDisplay } from '@/components/specifications-display'
import type { SpecFieldDefinition } from '@/components/dynamic-specs-form'
import type { MassUnit } from '@calibra-facil/shared'
import type { ReactNode } from 'react'
import {
  ECCENTRICITY_INDICATOR_SPEC_KEY,
  EccentricityIndicator,
  isEccentricityIndicatorPosition,
  isWeighingScaleAssetType,
} from '@/components/eccentricity-indicator'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/dashboard/assets/$id/')({
  head: () => ({
    meta: [{ title: 'Detalhes do Ativo | CalibraFácil' }],
  }),
  component: AssetDetailPage,
})

type AssetStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | 'SCRAPPED'

type AssetDetail = {
  assetTypeName?: string | null
  assetTypeSlug?: string | null
  name: string
  tag: string
  serialNumber: string
  manufacturer?: string | null
  model?: string | null
  status: AssetStatus
  customerName?: string | null
  lastCalibrationDate?: string | Date | null
  nextCalibrationDate?: string | Date | null
  comments?: string | null
  specifications?: Record<string, unknown> | null
  assetTypeDefinition?: SpecFieldDefinition[] | null
  baseMeasurementUnit?: MassUnit | null
  createdAt?: string | Date | null
  updatedAt?: string | Date | null
}

const statusLabels: Record<AssetStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  MAINTENANCE: 'Em Manutenção',
  SCRAPPED: 'Descartado',
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-'
  const d = new Date(date)
  return d.toLocaleDateString('pt-BR')
}

function AssetDetailPage() {
  const { id } = useParams({ from: '/dashboard/assets/$id/' })

  const {
    data: asset,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['asset', id],
    queryFn: async () => {
      return calibraApi.assets.get<AssetDetail>(id)
    },
  })

  // Fetch audit log for ISO 17025 compliance (Clause 8.4)
  const { data: auditLogData } = useQuery({
    queryKey: ['asset', id, 'audit-log'],
    queryFn: async () => {
      return calibraApi.assets.auditLog<AuditLogRecord>(id)
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-3 py-3">
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
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !asset) {
    return (
      <div className="rounded-lg bg-destructive/5 px-6 py-8 text-center text-sm text-destructive shadow-[inset_0_0_0_1px_rgba(220,38,38,0.18)]">
        Erro ao carregar informações do ativo.
      </div>
    )
  }

  // Get specifications and definition from asset
  const specifications = asset.specifications as Record<string, unknown> | null
  const definition = asset.assetTypeDefinition as SpecFieldDefinition[] | null
  const visibleDefinition =
    definition?.filter(
      (field) => field.key !== ECCENTRICITY_INDICATOR_SPEC_KEY,
    ) ?? null
  const selectedIndicatorPosition = isEccentricityIndicatorPosition(
    specifications?.[ECCENTRICITY_INDICATOR_SPEC_KEY],
  )
    ? specifications?.[ECCENTRICITY_INDICATOR_SPEC_KEY]
    : null
  const showEccentricityIndicator = isWeighingScaleAssetType({
    name: asset.assetTypeName,
    slug: asset.assetTypeSlug,
  })

  return (
    <div className="space-y-10">
      <dl className="grid overflow-hidden rounded-lg bg-muted/35 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] sm:grid-cols-2 xl:grid-cols-4 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <SummaryItem
          label="Tipo de instrumento"
          value={asset.assetTypeName || '-'}
          className="border-b border-border/70 sm:border-r xl:border-b-0"
        />
        <SummaryItem
          label="Próxima calibração"
          value={formatDate(asset.nextCalibrationDate)}
          detail="Prazo operacional"
          className="border-b border-border/70 xl:border-r xl:border-b-0"
        />
        <SummaryItem
          label="Última calibração"
          value={formatDate(asset.lastCalibrationDate)}
          detail="Data cadastrada"
          className="border-b border-border/70 sm:border-r sm:border-b-0"
        />
        <SummaryItem
          label="Cliente"
          value={asset.customerName || '-'}
          detail="Responsável pelo ativo"
        />
      </dl>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-10">
          <DetailSection
            title="Identificação"
            description="Dados principais usados para reconhecer o instrumento no laboratório."
          >
            <dl className="grid gap-x-8 border-t border-border/70 sm:grid-cols-2">
              <DetailItem label="Nome" value={asset.name} />
              <DetailItem label="Tag / ID interno" value={asset.tag} mono />
              <DetailItem
                label="Número de série"
                value={asset.serialNumber}
                mono
              />
              <DetailItem
                label="Fabricante"
                value={asset.manufacturer || '-'}
              />
              <DetailItem label="Modelo" value={asset.model || '-'} />
              <DetailItem label="Status">
                <Badge variant="outline">
                  {statusLabels[asset.status as AssetStatus]}
                </Badge>
              </DetailItem>
              {asset.baseMeasurementUnit && (
                <DetailItem label="Unidade base">
                  <Badge variant="secondary">{asset.baseMeasurementUnit}</Badge>
                </DetailItem>
              )}
            </dl>
          </DetailSection>

          {visibleDefinition && visibleDefinition.length > 0 && (
            <DetailSection
              title="Especificações técnicas"
              description="Características técnicas do instrumento aplicadas durante a calibração."
            >
              <div className="border-t border-border/70 pt-4">
                <SpecificationsDisplay
                  definition={visibleDefinition}
                  specifications={specifications}
                  activeMassUnit={asset.baseMeasurementUnit ?? null}
                />
              </div>
            </DetailSection>
          )}

          {showEccentricityIndicator && (
            <DetailSection
              title="Indicador de excentricidade"
              description="Posição física do display/indicador em relação à plataforma de carga."
            >
              <div className="border-t border-border/70 pt-4">
                <EccentricityIndicator
                  value={selectedIndicatorPosition}
                  readOnly
                  className="border-t-0 pt-0"
                />
              </div>
            </DetailSection>
          )}

          {asset.comments && (
            <DetailSection title="Observações">
              <p className="border-t border-border/70 pt-4 text-pretty text-sm leading-6 whitespace-pre-wrap text-muted-foreground">
                {asset.comments}
              </p>
            </DetailSection>
          )}
        </div>

        <aside className="space-y-10 lg:border-l lg:border-border/70 lg:pl-8">
          <DetailSection
            title="Calibração"
            description="Datas e vínculo do ativo."
          >
            <dl className="border-t border-border/70">
              <DetailItem
                label="Última calibração"
                value={formatDate(asset.lastCalibrationDate)}
                mono
              />
              <DetailItem
                label="Próxima calibração"
                value={formatDate(asset.nextCalibrationDate)}
                mono
              />
              <DetailItem label="Cliente" value={asset.customerName || '-'} />
            </dl>
          </DetailSection>

          <DetailSection title="Metadados">
            <dl className="border-t border-border/70">
              <DetailItem
                label="Criado em"
                value={formatDate(asset.createdAt)}
                mono
              />
              <DetailItem
                label="Atualizado em"
                value={formatDate(asset.updatedAt)}
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

function SummaryItem({
  label,
  value,
  detail,
  className,
}: {
  label: string
  value: ReactNode
  detail?: string
  className?: string
}) {
  return (
    <div className={cn('min-w-0 px-5 py-4', className)}>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-2 truncate text-base font-medium tabular-nums">
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
