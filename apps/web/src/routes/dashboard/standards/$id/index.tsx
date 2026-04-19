import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Edit02Icon,
  RefreshIcon,
  Calendar01Icon,
  CertificateIcon,
  TestTube02Icon,
  AlertCircleIcon,
} from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import {
  AuditTimeline,
  buildAuditTimelineEvents,
  type AuditLogRecord,
} from '@/components/audit-timeline'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export const Route = createFileRoute('/dashboard/standards/$id/')({
  component: StandardDetailPage,
})

type StandardStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'OUT_OF_TOLERANCE'
  | 'SENT_FOR_CALIBRATION'

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

interface Standard {
  id: number
  name: string
  type: string | null
  serialNumber: string
  manufacturer: string | null
  model: string | null
  certificateNumber: string
  calibratedBy: string | null
  calibrationDate: string
  nextCalibrationDate: string
  referenceValue: number | null
  uncertainty: number | null
  uncertaintyUnit: string | null
  coverageFactor: number
  distribution: 'normal' | 'rectangular'
  drift: number | null
  certifiedValues: CertifiedValue[] | null
  status: StandardStatus
  isExpired: boolean
  daysUntilExpiry: number
  createdAt: string
  updatedAt: string
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

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatDateTime(dateString: string): string {
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

function StandardDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()

  const {
    data: standard,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['standards', id],
    queryFn: async () => {
      const res = await api.api.standards[':id'].$get({
        param: { id },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar padrão de referência')
      }

      return res.json() as Promise<Standard>
    },
  })

  const { data: auditLogData } = useQuery({
    queryKey: ['standards', id, 'audit-log'],
    queryFn: async () => {
      const res = await api.api.standards[':id']['audit-log'].$get({
        param: { id },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar histórico')
      }

      return res.json() as Promise<{ data: AuditLogRecord[] }>
    },
  })

  if (error) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/standards' })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">
              Erro ao carregar padrão: {error.message}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-10 w-32" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-6 w-32" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!standard) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/standards' })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">
              Padrão de referência não encontrado.
            </p>
          </CardContent>
        </Card>
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/standards' })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            render={
              <Link
                to="/dashboard/standards/$id/edit"
                params={{ id }}
                search={{ renew: true }}
              />
            }
          >
            <HugeiconsIcon icon={RefreshIcon} className="mr-2 h-4 w-4" />
            Renovar
          </Button>
          <Button
            render={<Link to="/dashboard/standards/$id/edit" params={{ id }} />}
          >
            <HugeiconsIcon icon={Edit02Icon} className="mr-2 h-4 w-4" />
            Editar
          </Button>
        </div>
      </div>

      {/* Main Info Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <CardTitle className="text-2xl">{standard.name}</CardTitle>
              <CardDescription className="flex items-center gap-2">
                {standard.type && (
                  <>
                    <span>{standard.type}</span>
                    <span className="text-muted-foreground/50">|</span>
                  </>
                )}
                <span className="font-mono">{standard.serialNumber}</span>
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
              <Badge
                variant={calibrationBadge.variant}
                className={calibrationBadge.className}
              >
                {calibrationBadge.label}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Identification Section */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <HugeiconsIcon icon={TestTube02Icon} className="h-4 w-4" />
              Identificação
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Fabricante</p>
                <p className="font-medium">{standard.manufacturer || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Modelo</p>
                <p className="font-medium">{standard.model || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">N° Série</p>
                <p className="font-medium font-mono">{standard.serialNumber}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tipo</p>
                <p className="font-medium">{standard.type || '-'}</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Certificate Section */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <HugeiconsIcon icon={CertificateIcon} className="h-4 w-4" />
              Certificado de Calibração
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">N° Certificado</p>
                <p className="font-medium font-mono">
                  {standard.certificateNumber}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Calibrado por</p>
                <p className="font-medium">{standard.calibratedBy || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Data de Calibração
                </p>
                <p className="font-medium">
                  {formatDate(standard.calibrationDate)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Próxima Calibração
                </p>
                <div className="flex items-center gap-2">
                  <p className="font-medium">
                    {formatDate(standard.nextCalibrationDate)}
                  </p>
                  {standard.isExpired && (
                    <HugeiconsIcon
                      icon={AlertCircleIcon}
                      className="h-4 w-4 text-destructive"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Metrological Data Section */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <HugeiconsIcon icon={Calendar01Icon} className="h-4 w-4" />
              Dados Metrológicos
            </h3>

            {hasCertifiedValues ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Conjunto de valores certificados
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                          Nominal
                        </th>
                        <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                          Valor Certificado
                        </th>
                        <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                          Incerteza (U)
                        </th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                          Unidade
                        </th>
                        {hasAdvancedCertifiedValues && (
                          <>
                            <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                              Erro máximo
                            </th>
                            <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                              Deriva
                            </th>
                            <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                              Empuxo
                            </th>
                            <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                              k
                            </th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {standard.certifiedValues!.map((cv, idx) => (
                        <tr
                          key={idx}
                          className="border-b last:border-0 hover:bg-muted/50"
                        >
                          <td className="py-2 px-3 font-mono">{cv.nominal}</td>
                          <td className="py-2 px-3 text-right font-mono">
                            {cv.value}
                          </td>
                          <td className="py-2 px-3 text-right font-mono">
                            ±{cv.uncertainty}
                          </td>
                          <td className="py-2 px-3">{cv.unit}</td>
                          {hasAdvancedCertifiedValues && (
                            <>
                              <td className="py-2 px-3 text-right font-mono">
                                {cv.maxError ?? '-'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono">
                                {cv.drift ?? '-'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono">
                                {cv.buoyancy ?? '-'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono">
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
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Valor de Referência
                  </p>
                  <p className="font-medium font-mono">
                    {standard.referenceValue ?? '-'}
                    {standard.uncertaintyUnit && ` ${standard.uncertaintyUnit}`}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Incerteza (U)</p>
                  <p className="font-medium font-mono">
                    {standard.uncertainty != null
                      ? `±${standard.uncertainty} ${standard.uncertaintyUnit || ''}`
                      : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Fator de Cobertura (k)
                  </p>
                  <p className="font-medium font-mono">
                    {standard.coverageFactor}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4 pt-4 border-t">
              <div>
                <p className="text-xs text-muted-foreground">
                  Fator de Cobertura (k)
                </p>
                <p className="font-medium font-mono">
                  {standard.coverageFactor}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Distribuição</p>
                <p className="font-medium">
                  {standard.distribution === 'normal' ? 'Normal' : 'Retangular'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Drift</p>
                <p className="font-medium font-mono">
                  {standard.drift != null ? standard.drift : '-'}
                </p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Metadata Section */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Criado em {formatDateTime(standard.createdAt)}</span>
            <span>Atualizado em {formatDateTime(standard.updatedAt)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Audit Log */}
      {auditLogData?.data && auditLogData.data.length > 0 && (
        <AuditTimeline
          events={buildAuditTimelineEvents(auditLogData.data)}
          title="Histórico de Alterações (ISO 17025)"
        />
      )}
    </div>
  )
}
