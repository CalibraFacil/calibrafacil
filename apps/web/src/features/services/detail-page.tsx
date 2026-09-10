import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  Clock01Icon,
  DollarCircleIcon,
  Edit02Icon,
  FunctionIcon,
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
} from '@/components/instrument-panel'
import { methodRouteId } from '@/lib/route-identifiers'
import { formatFinanceMoney } from '@/lib/finance-formatters'

function formatPrice(priceInCents: number | null, currency: string): string {
  if (priceInCents === null) return 'Sob consulta'
  return formatFinanceMoney(priceInCents, currency || 'BRL')
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
  const { data: service, isLoading, error } = useServiceDetailData(id)
  const { data: auditLogData } = useServiceAuditLogData(id)

  if (isLoading) {
    return <ServiceDetailSkeleton />
  }

  if (error || !service) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          {error
            ? `Erro ao carregar serviço: ${error.message}`
            : 'Serviço não encontrado.'}
        </p>
      </Panel>
    )
  }

  const auditEvents = auditLogData?.data?.length
    ? buildAuditTimelineEvents(auditLogData.data)
    : []

  const detailsCard = (
    <Panel className="p-4 sm:p-5">
      <PanelHeader
        title="Configuração e condições"
        description="Método, aplicação e condições comerciais do serviço."
      />
      <BlueprintGrid className="mt-4 sm:grid-cols-2">
        <BlueprintField label="Método de calibração">
          {service.methodId && service.methodName ? (
            <Link
              to="/dashboard/methods/$id"
              params={{ id: getMethodRouteParam(service) }}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {service.methodName}
            </Link>
          ) : (
            <span className="text-muted-foreground">Sem vínculo</span>
          )}
        </BlueprintField>
        <BlueprintField label="Status do método">
          {service.methodId ? (
            <Badge variant={getMethodStatusVariant(service.methodStatus)}>
              {formatMethodStatus(service.methodStatus)}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </BlueprintField>
        <BlueprintField label="Versão" mono>
          {service.methodVersion ? `v${service.methodVersion}` : '—'}
        </BlueprintField>
        <BlueprintField label="Tipo de instrumento">
          {service.assetTypeName || (
            <span className="text-muted-foreground">Qualquer instrumento</span>
          )}
        </BlueprintField>
        <BlueprintField label="Preço" mono>
          {formatPrice(service.price, service.currency)}
        </BlueprintField>
        <BlueprintField label="Prazo" mono>
          {service.tat === null
            ? '—'
            : `${service.tat} ${service.tat === 1 ? 'dia útil' : 'dias úteis'}`}
        </BlueprintField>
        <BlueprintField label="Moeda" mono>
          {service.currency || 'BRL'}
        </BlueprintField>
        <BlueprintField label="Disponibilidade">
          <Badge variant={service.isActive ? 'default' : 'secondary'}>
            {service.isActive ? 'No catálogo' : 'Fora do catálogo'}
          </Badge>
        </BlueprintField>
      </BlueprintGrid>
    </Panel>
  )

  return (
    <div className="space-y-6">
      {/* Hero */}
      <Panel className="relative overflow-hidden">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-balance text-2xl font-semibold tracking-tight">
                {service.name}
              </h1>
              {service.description ? (
                <p className="mt-1 max-w-3xl text-pretty text-sm leading-6 text-muted-foreground">
                  {service.description}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant={service.isActive ? 'default' : 'secondary'}>
                {service.isActive ? 'Ativo' : 'Inativo'}
              </Badge>
              <Button
                render={
                  <Link to="/dashboard/services/$id/edit" params={{ id }} />
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
                icon={DollarCircleIcon}
                label="Preço"
                value={
                  service.price === null
                    ? '—'
                    : formatPrice(service.price, service.currency)
                }
                hint={service.price === null ? 'sob consulta' : 'referência'}
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={Clock01Icon}
                label="Prazo"
                value={service.tat === null ? '—' : String(service.tat)}
                hint={
                  service.tat === null
                    ? 'não definido'
                    : service.tat === 1
                      ? 'dia útil'
                      : 'dias úteis'
                }
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={FunctionIcon}
                label="Método"
                value={
                  service.methodVersion ? `v${service.methodVersion}` : '—'
                }
                hint={service.methodId ? 'vinculado' : 'sem vínculo'}
                tone={service.methodId ? 'info' : 'warning'}
              />
            </StaggerItem>
          </StaggerGroup>
        </div>
      </Panel>

      {!service.methodId ? (
        <div className="flex items-start gap-3 rounded-2xl bg-amber-500/10 p-4 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.25)]">
          <HugeiconsIcon
            icon={Alert02Icon}
            className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
          />
          <div className="space-y-1">
            <p className="font-medium text-amber-800 dark:text-amber-200">
              Serviço sem método vinculado
            </p>
            <p className="text-pretty text-sm leading-6 text-amber-700 dark:text-amber-300">
              Vincular um método permite cálculo automatizado de incerteza e
              geração de certificados padronizados.
            </p>
          </div>
        </div>
      ) : null}

      {auditEvents.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="min-w-0">{detailsCard}</div>
          <aside>
            <Panel className="p-4 sm:p-5">
              <PanelHeader title="Histórico de alterações" />
              <div className="mt-4">
                <AuditTimeline events={auditEvents} showCard={false} />
              </div>
            </Panel>
          </aside>
        </div>
      ) : (
        detailsCard
      )}
    </div>
  )
}

function ServiceDetailSkeleton(): ReactNode {
  return (
    <div className="space-y-6">
      <Panel className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-7 w-72" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
        <div className="mt-5 grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
          {Array.from({ length: 3 }).map((_item, index) => (
            <Skeleton key={index} className="h-[88px] rounded-xl" />
          ))}
        </div>
      </Panel>
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-44 rounded-2xl" />
    </div>
  )
}
