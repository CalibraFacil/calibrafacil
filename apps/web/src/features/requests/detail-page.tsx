import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import {
  BlueprintField,
  BlueprintGrid,
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import {
  ToolsIcon,
  CheckmarkCircle02Icon,
  Calendar03Icon,
} from '@hugeicons/core-free-icons'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import {
  useCalibrationRequestDetailData,
  useRequestConversionServicesData,
  useRequestTechniciansData,
} from '@/features/requests/queries'
import type {
  CalibrationRequestDetail,
  CalibrationRequestItem,
  CalibrationRequestStatus,
  RequestConversionService,
  RequestTechnician,
} from '@/features/requests/types'

type ConversionDraft = {
  serviceId: string
  technicianId: string
  dueDate: string
}

const statusLabels: Record<CalibrationRequestStatus, string> = {
  PENDING: 'Pendente',
  UNDER_REVIEW: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CONVERTED: 'Convertida',
}

const statusVariants: Record<
  CalibrationRequestStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  PENDING: 'secondary',
  UNDER_REVIEW: 'outline',
  APPROVED: 'default',
  REJECTED: 'destructive',
  CONVERTED: 'outline',
}

function formatDate(date: string | null | undefined) {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('pt-BR')
}

function getCompatibleServices(
  services: Array<RequestConversionService>,
  item: CalibrationRequestItem,
) {
  return services.filter(
    (service) =>
      service.methodId !== null &&
      service.methodStatus === 'PUBLISHED' &&
      (!service.assetTypeId || service.assetTypeId === item.assetTypeId),
  )
}

function buildInitialConversionDrafts(
  request: CalibrationRequestDetail,
  services: Array<RequestConversionService>,
) {
  const drafts: Record<number, ConversionDraft> = Object.fromEntries(
    request.items.map((item) => {
      const compatibleServices = getCompatibleServices(services, item)

      return [
        item.id,
        {
          serviceId:
            !item.convertedJobId && compatibleServices.length === 1
              ? String(compatibleServices[0].id)
              : '',
          technicianId: '',
          // On-site requests carry a preferred visit date — seed the per-item
          // due date from it so the technician/trip date defaults sensibly.
          dueDate:
            (request.preferredVisitDate ?? request.requestedDueDate)
              ? new Date(
                  (request.preferredVisitDate ?? request.requestedDueDate)!,
                )
                  .toISOString()
                  .slice(0, 10)
              : '',
        },
      ]
    }),
  )
  return drafts
}

function CalibrationRequestTriagePanel({
  request,
  requestId,
  services,
  technicians,
  servicesLoading,
  onInvalidate,
}: {
  request: CalibrationRequestDetail
  requestId: string
  services: Array<RequestConversionService>
  technicians: Array<RequestTechnician>
  servicesLoading: boolean
  onInvalidate: () => Promise<void>
}) {
  const [internalNotes, setInternalNotes] = useState(
    request.internalNotes || '',
  )
  const [rejectionReason, setRejectionReason] = useState(
    request.rejectionReason || '',
  )
  const [conversionDrafts, setConversionDrafts] = useState<
    Record<number, ConversionDraft>
  >(() => buildInitialConversionDrafts(request, services))
  // On-site: schedule one visit (date + technician) for the whole trip.
  const isOnsiteRequest = request.deliveryMethod === 'onsite'
  const [visitScheduledAt, setVisitScheduledAt] = useState(
    request.preferredVisitDate
      ? new Date(request.preferredVisitDate).toISOString().slice(0, 10)
      : '',
  )
  const [visitTechnicianId, setVisitTechnicianId] = useState('')

  const pendingConversionItems = useMemo(
    () => request.items.filter((item) => item.convertedJobId === null),
    [request.items],
  )

  const reviewMutation = useMutation({
    mutationFn: async () => {
      await calibraApi.calibrationRequests.review(requestId, {
        internalNotes: internalNotes || undefined,
      })
    },
    onSuccess: async () => {
      await onInvalidate()
      toast.success('Solicitação movida para análise')
    },
    onError: (error) => toast.error(error.message),
  })

  const approveMutation = useMutation({
    mutationFn: async () => {
      await calibraApi.calibrationRequests.approve(requestId, {
        internalNotes: internalNotes || undefined,
      })
    },
    onSuccess: async () => {
      await onInvalidate()
      toast.success('Solicitação aprovada')
    },
    onError: (error) => toast.error(error.message),
  })

  const rejectMutation = useMutation({
    mutationFn: async () => {
      await calibraApi.calibrationRequests.reject(requestId, {
        reason: rejectionReason,
        internalNotes: internalNotes || undefined,
      })
    },
    onSuccess: async () => {
      await onInvalidate()
      toast.success('Solicitação rejeitada')
    },
    onError: (error) => toast.error(error.message),
  })

  const convertMutation = useMutation({
    mutationFn: async () => {
      const payload = pendingConversionItems.map((item) => {
        const draft = conversionDrafts[item.id]

        return {
          itemId: item.id,
          serviceId: Number(draft?.serviceId),
          technicianId: draft?.technicianId || undefined,
          dueDate: draft?.dueDate
            ? new Date(`${draft.dueDate}T12:00:00`).toISOString()
            : undefined,
        }
      })

      await calibraApi.calibrationRequests.convert(requestId, {
        items: payload,
        visit: isOnsiteRequest
          ? {
              scheduledAt: visitScheduledAt
                ? new Date(`${visitScheduledAt}T12:00:00`).toISOString()
                : null,
              technicianId: visitTechnicianId || null,
            }
          : undefined,
      })
    },
    onSuccess: async () => {
      await onInvalidate()
      toast.success('Solicitação convertida em ordens de serviço')
    },
    onError: (error) => toast.error(error.message),
  })

  const conversionBlockedReason = useMemo(() => {
    if (request.status !== 'APPROVED') return null
    if (pendingConversionItems.length === 0) {
      return 'Todos os itens desta solicitação já foram convertidos.'
    }
    if (servicesLoading) {
      return 'Carregando serviços compatíveis para conversão.'
    }

    const itemsWithoutService = pendingConversionItems.filter((item) => {
      const draft = conversionDrafts[item.id]
      return !draft?.serviceId
    })

    if (itemsWithoutService.length === 0) return null

    const itemsWithoutCompatibleService = itemsWithoutService.filter((item) => {
      const compatibleServices = getCompatibleServices(services, item)
      return compatibleServices.length === 0
    })

    if (itemsWithoutCompatibleService.length > 0) {
      return 'Há ativos sem serviço compatível publicado. Ajuste os serviços cadastrados antes de converter.'
    }

    return 'Selecione um serviço para cada ativo acima para habilitar a conversão.'
  }, [
    conversionDrafts,
    pendingConversionItems,
    request.status,
    services,
    servicesLoading,
  ])

  const canConvert = useMemo(() => {
    if (request.status !== 'APPROVED') return false
    return pendingConversionItems.length > 0 && !conversionBlockedReason
  }, [conversionBlockedReason, pendingConversionItems.length, request.status])

  const isSubmitting =
    reviewMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending ||
    convertMutation.isPending

  return (
    <>
      <Panel className="p-4 sm:p-5">
        <PanelHeader
          title="Ativos solicitados"
          description="Selecione o serviço, técnico e prazo para converter cada ativo em ordem de serviço."
        />
        {isOnsiteRequest ? (
          <div className="mt-4 rounded-xl bg-background p-4 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
            <p className="text-sm font-medium">
              Agendamento da visita (em loco)
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Confirme a data e o técnico da visita. Os ativos abaixo viram jobs
              da mesma visita.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Data da visita</label>
                <Input
                  type="date"
                  value={visitScheduledAt}
                  onChange={(event) => setVisitScheduledAt(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Técnico da visita</label>
                <Select
                  value={visitTechnicianId || 'unassigned'}
                  onValueChange={(value) =>
                    setVisitTechnicianId(
                      !value || value === 'unassigned' ? '' : value,
                    )
                  }
                >
                  <SelectTrigger>
                    <span>
                      {visitTechnicianId
                        ? technicians.find(
                            (technician) => technician.id === visitTechnicianId,
                          )?.name || 'Selecione'
                        : 'A definir'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">A definir</SelectItem>
                    {technicians.map((technician) => (
                      <SelectItem key={technician.id} value={technician.id}>
                        {technician.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ) : null}
        <div className="mt-4 space-y-3">
          {request.items.map((item) => {
            const draft = conversionDrafts[item.id] ?? {
              serviceId: '',
              technicianId: '',
              dueDate: '',
            }
            const compatibleServices = getCompatibleServices(services, item)

            return (
              <div
                key={item.id}
                className="rounded-xl bg-background p-4 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
              >
                <div className="space-y-1">
                  <div className="font-medium">
                    {item.assetName} ({item.assetTag})
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Série {item.assetSerialNumber}
                    {item.assetManufacturer
                      ? ` · ${item.assetManufacturer}`
                      : ''}
                    {item.assetTypeName ? ` · ${item.assetTypeName}` : ''}
                  </p>
                  {item.convertedJobCode && (
                    <p className="text-sm text-muted-foreground">
                      Convertido na calibração {item.convertedJobCode}
                      {item.convertedServiceName
                        ? ` · ${item.convertedServiceName}`
                        : ''}
                    </p>
                  )}
                </div>

                {request.status === 'APPROVED' && !item.convertedJobId && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Serviço</label>
                      <Select
                        value={draft.serviceId || 'placeholder'}
                        onValueChange={(value) =>
                          setConversionDrafts((current) => ({
                            ...current,
                            [item.id]: {
                              ...draft,
                              serviceId:
                                !value || value === 'placeholder' ? '' : value,
                            },
                          }))
                        }
                      >
                        <SelectTrigger>
                          <span>
                            {draft.serviceId
                              ? compatibleServices.find(
                                  (service) =>
                                    String(service.id) === draft.serviceId,
                                )?.name || 'Selecione'
                              : servicesLoading
                                ? 'Carregando...'
                                : 'Selecione'}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="placeholder">Selecione</SelectItem>
                          {compatibleServices.map((service) => (
                            <SelectItem
                              key={service.id}
                              value={String(service.id)}
                            >
                              {service.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Técnico</label>
                      <Select
                        value={draft.technicianId || 'unassigned'}
                        onValueChange={(value) =>
                          setConversionDrafts((current) => ({
                            ...current,
                            [item.id]: {
                              ...draft,
                              technicianId:
                                !value || value === 'unassigned' ? '' : value,
                            },
                          }))
                        }
                      >
                        <SelectTrigger>
                          <span>
                            {draft.technicianId
                              ? technicians.find(
                                  (technician) =>
                                    technician.id === draft.technicianId,
                                )?.name || 'Selecione'
                              : 'Não atribuído'}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">
                            Não atribuído
                          </SelectItem>
                          {technicians.map((technician) => (
                            <SelectItem
                              key={technician.id}
                              value={technician.id}
                            >
                              {technician.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Prazo da OS</label>
                      <Input
                        type="date"
                        value={draft.dueDate}
                        onChange={(event) =>
                          setConversionDrafts((current) => ({
                            ...current,
                            [item.id]: {
                              ...draft,
                              dueDate: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel className="p-4 sm:p-5">
        <PanelHeader
          title="Ação da solicitação"
          description="Registre notas internas e escolha a próxima ação."
        />
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Notas internas</label>
            <Textarea
              value={internalNotes}
              onChange={(event) => setInternalNotes(event.target.value)}
              placeholder="Notas visíveis apenas para a equipe interna."
            />
          </div>

          {(request.status === 'PENDING' ||
            request.status === 'UNDER_REVIEW' ||
            request.status === 'APPROVED') && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Motivo da rejeição</label>
              <Textarea
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Obrigatório ao rejeitar."
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {(request.status === 'PENDING' ||
              request.status === 'UNDER_REVIEW') && (
              <>
                <Button
                  variant="outline"
                  onClick={() => reviewMutation.mutate()}
                  disabled={isSubmitting}
                >
                  Marcar em análise
                </Button>
                <Button
                  onClick={() => approveMutation.mutate()}
                  disabled={isSubmitting}
                >
                  Aprovar
                </Button>
              </>
            )}

            {(request.status === 'PENDING' ||
              request.status === 'UNDER_REVIEW' ||
              request.status === 'APPROVED') && (
              <Button
                variant="destructive"
                onClick={() => rejectMutation.mutate()}
                disabled={isSubmitting || rejectionReason.trim().length < 3}
              >
                Rejeitar
              </Button>
            )}

            {request.status === 'APPROVED' && (
              <Button
                onClick={() => convertMutation.mutate()}
                disabled={!canConvert || isSubmitting}
              >
                Converter em calibração
              </Button>
            )}
          </div>

          {request.status === 'APPROVED' && conversionBlockedReason && (
            <p className="text-sm text-muted-foreground">
              {conversionBlockedReason}
            </p>
          )}
        </div>
      </Panel>
    </>
  )
}

export function CalibrationRequestDetailPage({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const organizationQueryKey = activeOrganizationId ?? 'no-org'

  const queryEnabled =
    Boolean(activeOrganizationId) &&
    !isContextSwitching &&
    !cloudOnlyUnavailable

  const detailQuery = useCalibrationRequestDetailData({
    activeOrganizationId,
    enabled: queryEnabled,
    id,
  })

  const servicesQuery = useRequestConversionServicesData({
    activeOrganizationId,
    enabled: queryEnabled,
  })

  const techniciansQuery = useRequestTechniciansData({
    activeOrganizationId,
    enabled: queryEnabled,
  })

  const request = detailQuery.data

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['calibration-request', organizationQueryKey, id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['calibration-requests', organizationQueryKey],
      }),
      queryClient.invalidateQueries({
        queryKey: ['jobs', organizationQueryKey],
      }),
    ])
  }

  if (cloudOnlyUnavailable) {
    return <CloudOnlyOfflineState title="Solicitação indisponível offline" />
  }

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner className="size-8" />
      </div>
    )
  }

  if (detailQuery.error || !request) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          Erro ao carregar solicitação.
        </p>
      </Panel>
    )
  }

  const deliveryLabel =
    request.deliveryMethod === 'carrier'
      ? 'Transportadora'
      : request.deliveryMethod === 'onsite'
        ? 'No local (em loco)'
        : 'Levar ao laboratório'
  const onsiteAddress = request.onsiteAddress
  const onsiteAddressText = onsiteAddress
    ? [
        [onsiteAddress.street, onsiteAddress.number].filter(Boolean).join(', '),
        onsiteAddress.complement,
        [onsiteAddress.neighbourhood, onsiteAddress.city, onsiteAddress.state]
          .filter(Boolean)
          .join(' - '),
        onsiteAddress.cep,
      ]
        .map((part) => (part ?? '').trim())
        .filter(Boolean)
        .join(' · ')
    : ''

  const triagePanelKey = [
    organizationQueryKey,
    id,
    detailQuery.dataUpdatedAt,
    servicesQuery.dataUpdatedAt,
  ].join(':')

  const itemsTotal = request.items.length
  const convertedItems = request.items.filter(
    (item) => item.convertedJobId !== null,
  ).length

  return (
    <div className="space-y-6">
      <Panel className="relative overflow-hidden">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-balance font-mono text-2xl font-semibold tracking-tight tabular-nums">
                #{request.id}
              </h1>
              <p className="mt-0.5 text-pretty text-sm text-muted-foreground">
                {request.customerName} · enviada em{' '}
                {formatDate(request.submittedAt)}
              </p>
            </div>
            <Badge
              variant={statusVariants[request.status]}
              className="shrink-0"
            >
              {statusLabels[request.status]}
            </Badge>
          </div>

          <StaggerGroup className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
            <StaggerItem>
              <SignalTile
                icon={ToolsIcon}
                label="Itens solicitados"
                value={String(itemsTotal)}
                hint="ativos"
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={CheckmarkCircle02Icon}
                label="Convertidos"
                value={`${convertedItems}/${itemsTotal}`}
                hint="em OS"
                tone={
                  convertedItems === itemsTotal && itemsTotal > 0
                    ? 'ok'
                    : 'neutral'
                }
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={Calendar03Icon}
                label="Prazo solicitado"
                value={formatDate(request.requestedDueDate)}
                hint="cliente"
                tone="neutral"
              />
            </StaggerItem>
          </StaggerGroup>
        </div>
      </Panel>

      <Panel className="p-4 sm:p-5">
        <PanelHeader
          title="Resumo"
          description="Contexto enviado pelo cliente e histórico da triagem."
        />
        <BlueprintGrid className="mt-4 sm:grid-cols-2">
          <BlueprintField label="Prazo solicitado" mono>
            {formatDate(request.requestedDueDate)}
          </BlueprintField>
          <BlueprintField label="Forma de envio">
            {deliveryLabel}
          </BlueprintField>
          {request.deliveryMethod === 'onsite' ? (
            <>
              <BlueprintField label="Data preferida da visita" mono>
                {formatDate(request.preferredVisitDate)}
              </BlueprintField>
              <BlueprintField
                label="Endereço da visita"
                className="sm:col-span-2"
              >
                {onsiteAddressText || 'Endereço cadastrado do cliente'}
              </BlueprintField>
            </>
          ) : null}
          <BlueprintField label="Solicitado por">
            {request.submittedByName || '—'}
          </BlueprintField>
          <BlueprintField
            label="Observações do cliente"
            className="sm:col-span-2"
          >
            {request.observations?.trim() || 'Sem observações informadas.'}
          </BlueprintField>
          {request.rejectionReason ? (
            <BlueprintField
              label="Motivo da rejeição"
              className="sm:col-span-2"
            >
              {request.rejectionReason}
            </BlueprintField>
          ) : null}
        </BlueprintGrid>
      </Panel>

      <CalibrationRequestTriagePanel
        key={triagePanelKey}
        request={request}
        requestId={id}
        services={servicesQuery.data?.data ?? []}
        technicians={techniciansQuery.data?.data ?? []}
        servicesLoading={servicesQuery.isLoading}
        onInvalidate={invalidate}
      />
    </div>
  )
}
