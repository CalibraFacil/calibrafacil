import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Edit02Icon,
  ClockIcon,
  MoneyReceive01Icon,
  TestTube02Icon,
  InformationCircleIcon,
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

export const Route = createFileRoute('/dashboard/services/$id/')({
  component: ServiceDetailPage,
})

interface Service {
  id: number
  name: string
  description: string | null
  methodId: number | null
  methodName: string | null
  methodStatus: string | null
  assetTypeId: number | null
  assetTypeName: string | null
  price: number | null
  currency: string
  tat: number | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

function formatPrice(priceInCents: number | null, currency: string): string {
  if (priceInCents === null) {
    return 'Sob consulta'
  }

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency || 'BRL',
  }).format(priceInCents / 100)
}

function formatTat(tat: number | null): string {
  if (tat === null) {
    return 'Não definido'
  }
  return `${tat} ${tat === 1 ? 'dia útil' : 'dias úteis'}`
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

function ServiceDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()

  const {
    data: service,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['services', id],
    queryFn: async () => {
      const res = await api.api.services[':id'].$get({
        param: { id },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar serviço')
      }

      return res.json() as Promise<Service>
    },
  })

  const { data: auditLogData } = useQuery({
    queryKey: ['services', id, 'audit-log'],
    queryFn: async () => {
      const res = await api.api.services[':id']['audit-log'].$get({
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
          onClick={() => navigate({ to: '/dashboard/services' })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">
              Erro ao carregar serviço: {error.message}
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
          <Skeleton className="h-10 w-24" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
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

  if (!service) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/services' })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Serviço não encontrado.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/services' })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>

        <Button
          render={<Link to="/dashboard/services/$id/edit" params={{ id }} />}
        >
          <HugeiconsIcon icon={Edit02Icon} className="mr-2 h-4 w-4" />
          Editar
        </Button>
      </div>

      {/* Main Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1">
              <CardTitle className="text-2xl">{service.name}</CardTitle>
              {service.description && (
                <CardDescription className="text-base">
                  {service.description}
                </CardDescription>
              )}
            </div>
            <Badge variant={service.isActive ? 'default' : 'secondary'}>
              {service.isActive ? 'Ativo' : 'Inativo'}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <HugeiconsIcon
                  icon={MoneyReceive01Icon}
                  className="h-5 w-5 text-primary"
                />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Preço</p>
                <p className="text-lg font-semibold">
                  {formatPrice(service.price, service.currency)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <HugeiconsIcon
                  icon={ClockIcon}
                  className="h-5 w-5 text-primary"
                />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Prazo</p>
                <p className="text-lg font-semibold">
                  {formatTat(service.tat)}
                </p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Technical Configuration */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
              <HugeiconsIcon icon={TestTube02Icon} className="h-4 w-4" />
              Configuração Técnica
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Method */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Método de Calibração
                </p>
                {service.methodId && service.methodName ? (
                  <div className="flex items-center gap-2">
                    <Link
                      to="/dashboard/methods/$id"
                      params={{ id: String(service.methodId) }}
                      className="text-primary hover:underline font-medium"
                    >
                      {service.methodName}
                    </Link>
                    {service.methodStatus && (
                      <Badge
                        variant={
                          service.methodStatus === 'PUBLISHED'
                            ? 'default'
                            : service.methodStatus === 'DRAFT'
                              ? 'secondary'
                              : 'outline'
                        }
                        className="text-xs"
                      >
                        {service.methodStatus === 'PUBLISHED'
                          ? 'Publicado'
                          : service.methodStatus === 'DRAFT'
                            ? 'Rascunho'
                            : service.methodStatus === 'PENDING_APPROVAL'
                              ? 'Em aprovação'
                              : service.methodStatus === 'TECHNICAL_REVIEWED'
                                ? 'Revisão técnica'
                                : 'Arquivado'}
                      </Badge>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground">Nenhum método vinculado</p>
                )}
              </div>

              {/* Asset Type */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Tipo de Instrumento
                </p>
                <p className="font-medium">
                  {service.assetTypeName || (
                    <span className="text-muted-foreground">
                      Qualquer instrumento
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {!service.methodId && (
            <>
              <Separator />
              <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <HugeiconsIcon
                  icon={InformationCircleIcon}
                  className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5"
                />
                <div className="space-y-1">
                  <p className="font-medium text-amber-800 dark:text-amber-200">
                    Serviço sem método vinculado
                  </p>
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Este serviço não possui um método de calibração vinculado.
                    Vincular um método permite utilizar o cálculo automatizado de
                    incerteza e gerar certificados padronizados.
                  </p>
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Metadata */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Criado em {formatDateTime(service.createdAt)}</span>
            <span>Atualizado em {formatDateTime(service.updatedAt)}</span>
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
