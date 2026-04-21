import { createFileRoute, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { api } from '@/utils/api'
import {
  AuditTimeline,
  buildAuditTimelineEvents,
  type AuditLogRecord,
} from '@/components/audit-timeline'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { SpecificationsDisplay } from '@/components/specifications-display'
import type { SpecFieldDefinition } from '@/components/dynamic-specs-form'
import type { MassUnit } from '@calibra-facil/shared'
import {
  ECCENTRICITY_INDICATOR_SPEC_KEY,
  EccentricityIndicator,
  isEccentricityIndicatorPosition,
  isWeighingScaleAssetType,
} from '@/components/eccentricity-indicator'

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
      const res = await api.api.assets[':id'].$get({
        param: { id },
      })
      if (!res.ok) {
        throw new Error('Falha ao carregar ativo')
      }
      return res.json() as Promise<AssetDetail>
    },
  })

  // Fetch audit log for ISO 17025 compliance (Clause 8.4)
  const { data: auditLogData } = useQuery({
    queryKey: ['asset', id, 'audit-log'],
    queryFn: async () => {
      const res = await api.api.assets[':id']['audit-log'].$get({
        param: { id },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar histórico')
      }

      return res.json() as Promise<{ data: AuditLogRecord[] }>
    },
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-48" />
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  if (error || !asset) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-destructive">
          Erro ao carregar informações do ativo.
        </CardContent>
      </Card>
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
    <div className="grid gap-6 md:grid-cols-2">
      {/* Basic Information */}
      <Card>
        <CardHeader>
          <CardTitle>Informações Básicas</CardTitle>
          <CardDescription>Dados de identificação do ativo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Tipo de Instrumento
            </label>
            <p className="text-sm">
              <Badge variant="secondary">{asset.assetTypeName}</Badge>
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Nome
            </label>
            <p className="text-sm">{asset.name}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Tag / ID Interno
            </label>
            <p className="font-mono text-sm">{asset.tag}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Número de Série
            </label>
            <p className="font-mono text-sm">{asset.serialNumber}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Fabricante
            </label>
            <p className="text-sm">{asset.manufacturer || '-'}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Modelo
            </label>
            <p className="text-sm">{asset.model || '-'}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Status
            </label>
            <p className="text-sm">
              <Badge variant="outline">
                {statusLabels[asset.status as AssetStatus]}
              </Badge>
            </p>
          </div>
          {asset.baseMeasurementUnit && (
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Unidade Base
              </label>
              <p className="text-sm">
                <Badge variant="outline">{asset.baseMeasurementUnit}</Badge>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Calibration Information */}
      <Card>
        <CardHeader>
          <CardTitle>Calibração</CardTitle>
          <CardDescription>
            Informações sobre calibrações do ativo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Última Calibração
            </label>
            <p className="text-sm">{formatDate(asset.lastCalibrationDate)}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Próxima Calibração
            </label>
            <p className="text-sm">{formatDate(asset.nextCalibrationDate)}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Cliente
            </label>
            <p className="text-sm">{asset.customerName}</p>
          </div>
        </CardContent>
      </Card>

      {/* Technical Specifications */}
      {visibleDefinition && visibleDefinition.length > 0 && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Especificações Técnicas</CardTitle>
            <CardDescription>
              Características técnicas do instrumento.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SpecificationsDisplay
              definition={visibleDefinition}
              specifications={specifications}
              activeMassUnit={asset.baseMeasurementUnit ?? null}
            />
          </CardContent>
        </Card>
      )}

      {showEccentricityIndicator && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Indicador de Excentricidade</CardTitle>
            <CardDescription>
              Posição física do display/indicador em relação à plataforma de
              carga.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EccentricityIndicator
              value={selectedIndicatorPosition}
              readOnly
              className="border-t-0 pt-0"
            />
          </CardContent>
        </Card>
      )}

      {/* Comments */}
      {asset.comments && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Observações</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{asset.comments}</p>
          </CardContent>
        </Card>
      )}

      {/* Metadata */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Metadados</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-8 text-sm text-muted-foreground">
            <div>
              <span className="font-medium">Criado em:</span>{' '}
              {formatDate(asset.createdAt)}
            </div>
            <div>
              <span className="font-medium">Atualizado em:</span>{' '}
              {formatDate(asset.updatedAt)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Audit Log - ISO 17025 Clause 8.4 (Control of Records) */}
      {auditLogData?.data && auditLogData.data.length > 0 && (
        <div className="md:col-span-2">
          <AuditTimeline
            events={buildAuditTimelineEvents(auditLogData.data)}
            title="Histórico de Alterações (ISO 17025)"
          />
        </div>
      )}
    </div>
  )
}
