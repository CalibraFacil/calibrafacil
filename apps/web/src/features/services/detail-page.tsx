import { Link, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Edit02Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons'

import {
  useServiceAuditLogData,
  useServiceDetailData,
} from '@/features/services/queries'
import type { ServiceDetail } from '@/features/services/types'
import {
  AuditTimeline,
  buildAuditTimelineEvents,
} from '@/components/audit-timeline'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { methodRouteId } from '@/lib/route-identifiers'
import { cn } from '@/lib/utils'

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

function formatDateTime(dateString: string | Date | null): string {
  if (!dateString) return '-'

  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getMethodRouteParam(service: ServiceDetail): string {
  if (service.methodId && service.methodName && service.methodVersion) {
    return methodRouteId({
      name: service.methodName,
      version: service.methodVersion,
    })
  }

  return String(service.methodId)
}

function formatMethodStatus(status: string | null): string {
  if (status === 'PUBLISHED') return 'Publicado'
  if (status === 'DRAFT') return 'Rascunho'
  if (status === 'PENDING_APPROVAL') return 'Em aprovação'
  if (status === 'TECHNICAL_REVIEWED') return 'Revisão técnica'
  if (status === 'ARCHIVED') return 'Arquivado'
  return status || 'Sem status'
}

function getMethodStatusVariant(
  status: string | null,
): 'default' | 'secondary' | 'outline' {
  if (status === 'PUBLISHED') return 'default'
  if (status === 'DRAFT') return 'secondary'
  return 'outline'
}

export function ServiceDetailPage({ id }: { id: string }) {
  const navigate = useNavigate()

  const { data: service, isLoading, error } = useServiceDetailData(id)

  const { data: auditLogData } = useServiceAuditLogData(id)

  if (error) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/services' })}
          className="-ml-2 active:scale-[0.96] transition-transform"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
          Voltar
        </Button>
        <div className="rounded-lg bg-destructive/5 px-6 py-8 text-center text-sm text-destructive shadow-[inset_0_0_0_1px_rgba(220,38,38,0.18)]">
          Erro ao carregar serviço: {error.message}
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-4 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:space-y-0">
          <div className="flex items-start gap-4">
            <Skeleton className="size-9 rounded-md" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-64" />
              <Skeleton className="h-4 w-80" />
            </div>
          </div>
          <Skeleton className="h-9 w-24" />
        </div>
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
                  {Array.from({ length: 4 }).map((_, rowIndex) => (
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

  if (!service) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/services' })}
          className="-ml-2 active:scale-[0.96] transition-transform"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
          Voltar
        </Button>
        <div className="rounded-lg bg-muted/35 px-6 py-8 text-center text-sm text-muted-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          Serviço não encontrado.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:space-y-0">
        <div className="flex items-start gap-3 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: '/dashboard/services' })}
            className="mt-0.5 active:scale-[0.96]"
            aria-label="Voltar para serviços"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="space-y-3">
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
                <h1 className="text-balance text-2xl font-semibold tracking-tight">
                  {service.name}
                </h1>
                <Badge variant={service.isActive ? 'default' : 'secondary'}>
                  {service.isActive ? 'Ativo' : 'Inativo'}
                </Badge>
              </div>
              {service.description ? (
                <p className="max-w-3xl text-pretty text-sm leading-6 text-muted-foreground">
                  {service.description}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          render={<Link to="/dashboard/services/$id/edit" params={{ id }} />}
          className="hidden active:scale-[0.96] sm:inline-flex"
        >
          <HugeiconsIcon icon={Edit02Icon} className="mr-2 size-4" />
          Editar
        </Button>
      </div>

      <Button
        variant="outline"
        render={<Link to="/dashboard/services/$id/edit" params={{ id }} />}
        className="w-full active:scale-[0.96] sm:hidden"
      >
        <HugeiconsIcon icon={Edit02Icon} className="mr-2 size-4" />
        Editar serviço
      </Button>

      <dl className="grid overflow-hidden rounded-lg bg-muted/35 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] sm:grid-cols-2 xl:grid-cols-4 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <SummaryItem
          label="Preço"
          value={formatPrice(service.price, service.currency)}
          detail="Valor de referência"
          className="border-b border-border/70 sm:border-r xl:border-b-0"
          numeric={service.price !== null}
        />
        <SummaryItem
          label="Prazo"
          value={formatTat(service.tat)}
          detail="Tempo operacional"
          className="border-b border-border/70 xl:border-r xl:border-b-0"
        />
        <SummaryItem
          label="Método"
          value={
            service.methodId && service.methodName ? (
              <Link
                to="/dashboard/methods/$id"
                params={{ id: getMethodRouteParam(service) }}
                className="truncate hover:underline"
              >
                {service.methodName}
              </Link>
            ) : (
              'Sem vínculo'
            )
          }
          detail={
            service.methodVersion
              ? `Versão ${service.methodVersion}`
              : undefined
          }
          className="border-b border-border/70 sm:border-r sm:border-b-0"
        />
        <SummaryItem
          label="Tipo de instrumento"
          value={service.assetTypeName || 'Qualquer instrumento'}
          detail="Filtro em ordens"
        />
      </dl>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-10">
          <DetailSection
            title="Configuração técnica"
            description="Vínculos que definem cálculo, rastreabilidade e aplicação do serviço."
          >
            <dl className="grid gap-x-8 border-t border-border/70 sm:grid-cols-2">
              <DetailItem label="Método de calibração">
                {service.methodId && service.methodName ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Link
                      to="/dashboard/methods/$id"
                      params={{ id: getMethodRouteParam(service) }}
                      className="min-w-0 truncate font-medium text-primary hover:underline"
                    >
                      {service.methodName}
                    </Link>
                    {service.methodStatus ? (
                      <Badge
                        variant={getMethodStatusVariant(service.methodStatus)}
                        className="text-xs"
                      >
                        {formatMethodStatus(service.methodStatus)}
                      </Badge>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-muted-foreground">
                    Nenhum método vinculado
                  </span>
                )}
              </DetailItem>
              <DetailItem
                label="Versão do método"
                value={
                  service.methodVersion
                    ? `v${service.methodVersion}`
                    : 'Não definida'
                }
                mono
              />
              <DetailItem label="Tipo de instrumento">
                <span className="font-medium">
                  {service.assetTypeName || (
                    <span className="text-muted-foreground">
                      Qualquer instrumento
                    </span>
                  )}
                </span>
              </DetailItem>
              <DetailItem label="Status do método">
                <Badge variant={getMethodStatusVariant(service.methodStatus)}>
                  {formatMethodStatus(service.methodStatus)}
                </Badge>
              </DetailItem>
            </dl>
          </DetailSection>

          <DetailSection
            title="Condições comerciais"
            description="Valores exibidos para orçamento e planejamento de ordens de serviço."
          >
            <dl className="grid gap-x-8 border-t border-border/70 sm:grid-cols-2">
              <DetailItem
                label="Preço"
                value={formatPrice(service.price, service.currency)}
                numeric={service.price !== null}
              />
              <DetailItem label="Prazo" value={formatTat(service.tat)} />
              <DetailItem
                label="Moeda"
                value={service.currency || 'BRL'}
                mono
              />
              <DetailItem label="Disponibilidade">
                <Badge variant={service.isActive ? 'default' : 'secondary'}>
                  {service.isActive ? 'Ativo no catálogo' : 'Fora do catálogo'}
                </Badge>
              </DetailItem>
            </dl>
          </DetailSection>

          {!service.methodId && (
            <div className="flex items-start gap-3 rounded-lg bg-amber-50 p-4 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.25)] dark:bg-amber-950/30">
              <HugeiconsIcon
                icon={InformationCircleIcon}
                className="mt-0.5 size-5 text-amber-600 dark:text-amber-400"
              />
              <div className="space-y-1">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  Serviço sem método vinculado
                </p>
                <p className="text-pretty text-sm leading-6 text-amber-700 dark:text-amber-300">
                  Vincular um método permite usar cálculo automatizado de
                  incerteza e gerar certificados padronizados.
                </p>
              </div>
            </div>
          )}
        </div>

        <aside className="space-y-10 lg:border-l lg:border-border/70 lg:pl-8">
          <DetailSection title="Metadados">
            <dl className="border-t border-border/70">
              <DetailItem
                label="Criado em"
                value={formatDateTime(service.createdAt)}
                mono
              />
              <DetailItem
                label="Atualizado em"
                value={formatDateTime(service.updatedAt)}
                mono
              />
              <DetailItem label="Identificador" value={service.id} mono />
            </dl>
          </DetailSection>

          <DetailSection
            title="Governança"
            description="Rastreabilidade mínima para uso operacional."
          >
            <dl className="border-t border-border/70">
              <DetailItem label="Catálogo">
                <Badge variant={service.isActive ? 'default' : 'secondary'}>
                  {service.isActive ? 'Publicado' : 'Inativo'}
                </Badge>
              </DetailItem>
              <DetailItem label="Método">
                {service.methodId ? (
                  <Badge variant={getMethodStatusVariant(service.methodStatus)}>
                    {formatMethodStatus(service.methodStatus)}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">Pendente</span>
                )}
              </DetailItem>
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
  numeric = false,
}: {
  label: string
  value: ReactNode
  detail?: string
  className?: string
  numeric?: boolean
}) {
  return (
    <div className={cn('min-w-0 px-5 py-4', className)}>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-2 min-w-0 truncate text-base font-medium',
          numeric && 'tabular-nums',
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
  numeric = false,
  children,
}: {
  label: string
  value?: ReactNode
  mono?: boolean
  numeric?: boolean
  children?: ReactNode
}) {
  return (
    <div className="min-w-0 border-b border-border/70 py-4">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-1 min-w-0 text-sm text-foreground',
          mono && 'font-mono tabular-nums',
          numeric && 'tabular-nums',
        )}
      >
        {children ?? value ?? '-'}
      </dd>
    </div>
  )
}
