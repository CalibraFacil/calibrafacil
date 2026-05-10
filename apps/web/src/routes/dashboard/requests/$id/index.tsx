import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { api, calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'

export const Route = createFileRoute('/dashboard/requests/$id/')({
  head: () => ({
    meta: [{ title: 'Solicitação de Calibração | CalibraFácil' }],
  }),
  component: CalibrationRequestDetailPage,
})

type RequestStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CONVERTED'

type RequestItem = {
  id: number
  assetId: number
  assetName: string
  assetTag: string
  assetSerialNumber: string
  assetManufacturer: string | null
  assetModel: string | null
  assetTypeId: number | null
  assetTypeName: string | null
  convertedJobId: number | null
  convertedJobCode: string | null
  convertedJobStatus: string | null
  convertedServiceName: string | null
}

type CalibrationRequestDetail = {
  id: number
  status: RequestStatus
  observations: string | null
  internalNotes: string | null
  requestedDueDate: string | null
  submittedAt: string
  reviewedAt: string | null
  approvedAt: string | null
  rejectedAt: string | null
  rejectionReason: string | null
  convertedAt: string | null
  customerId: number
  customerName: string
  submittedBy: string
  submittedByName: string | null
  reviewedBy: string | null
  reviewedByName: string | null
  approvedBy: string | null
  approvedByName: string | null
  rejectedBy: string | null
  rejectedByName: string | null
  convertedBy: string | null
  convertedByName: string | null
  items: Array<RequestItem>
}

type Service = {
  id: number
  name: string
  assetTypeId: number | null
  methodId: number | null
  methodStatus: string | null
}

type Technician = {
  id: string
  name: string
}

type ConversionDraft = {
  serviceId: string
  technicianId: string
  dueDate: string
}

const statusLabels: Record<RequestStatus, string> = {
  PENDING: 'Pendente',
  UNDER_REVIEW: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CONVERTED: 'Convertida',
}

const statusVariants: Record<
  RequestStatus,
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

function getCompatibleServices(services: Array<Service>, item: RequestItem) {
  return services.filter(
    (service) =>
      service.methodId !== null &&
      service.methodStatus === 'PUBLISHED' &&
      (!service.assetTypeId || service.assetTypeId === item.assetTypeId),
  )
}

function buildInitialConversionDrafts(
  request: CalibrationRequestDetail,
  services: Array<Service>,
) {
  return Object.fromEntries(
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
          dueDate: request.requestedDueDate
            ? new Date(request.requestedDueDate).toISOString().slice(0, 10)
            : '',
        },
      ]
    }),
  ) as Record<number, ConversionDraft>
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
  services: Array<Service>
  technicians: Array<Technician>
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

  const pendingConversionItems = useMemo(
    () => request.items.filter((item) => item.convertedJobId === null),
    [request.items],
  )

  const reviewMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api['calibration-requests'][':id'].review.$post({
        param: { id: requestId },
        json: { internalNotes: internalNotes || undefined },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao revisar',
        )
      }
    },
    onSuccess: async () => {
      await onInvalidate()
      toast.success('Solicitação movida para análise')
    },
    onError: (error) => toast.error(error.message),
  })

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api['calibration-requests'][':id'].approve.$post({
        param: { id: requestId },
        json: { internalNotes: internalNotes || undefined },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao aprovar',
        )
      }
    },
    onSuccess: async () => {
      await onInvalidate()
      toast.success('Solicitação aprovada')
    },
    onError: (error) => toast.error(error.message),
  })

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api['calibration-requests'][':id'].reject.$post({
        param: { id: requestId },
        json: {
          reason: rejectionReason,
          internalNotes: internalNotes || undefined,
        },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao rejeitar',
        )
      }
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

      const res = await api.api['calibration-requests'][':id'].convert.$post({
        param: { id: requestId },
        json: { items: payload },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao converter',
        )
      }
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
      <Card>
        <CardHeader>
          <CardTitle>Ativos solicitados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {request.items.map((item) => {
            const draft = conversionDrafts[item.id] ?? {
              serviceId: '',
              technicianId: '',
              dueDate: '',
            }
            const compatibleServices = getCompatibleServices(services, item)

            return (
              <div key={item.id} className="rounded-lg border p-4">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Triagem</CardTitle>
          <CardDescription>
            Registre notas internas e escolha a próxima ação para a solicitação.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>
    </>
  )
}

function CalibrationRequestDetailPage() {
  const { id } = Route.useParams()
  const queryClient = useQueryClient()
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const organizationQueryKey = activeOrganizationId ?? 'no-org'

  const detailQuery = useQuery({
    queryKey: ['calibration-request', organizationQueryKey, id],
    enabled:
      Boolean(activeOrganizationId) &&
      !isContextSwitching &&
      !cloudOnlyUnavailable,
    queryFn: async () => {
      const res = await api.api['calibration-requests'][':id'].$get({
        param: { id },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar solicitação')
      }

      return res.json() as Promise<CalibrationRequestDetail>
    },
  })

  const servicesQuery = useQuery({
    queryKey: ['services', organizationQueryKey, 'request-conversion'],
    enabled:
      Boolean(activeOrganizationId) &&
      !isContextSwitching &&
      !cloudOnlyUnavailable,
    queryFn: async () => {
      const firstPage = await calibraApi.services.list({
        page: 1,
        limit: 100,
        isActive: true,
      })

      if ((firstPage.pagination?.totalPages ?? 1) <= 1) {
        return { data: firstPage.data as Array<Service> }
      }

      const remainingData = await Promise.all(
        Array.from(
          { length: (firstPage.pagination?.totalPages ?? 1) - 1 },
          (_, index) =>
            calibraApi.services.list({
              page: index + 2,
              limit: 100,
              isActive: true,
            }),
        ),
      )

      return {
        data: [
          ...(firstPage.data as Array<Service>),
          ...remainingData.flatMap((page) => page.data as Array<Service>),
        ],
      }
    },
  })

  const techniciansQuery = useQuery({
    queryKey: ['jobs', organizationQueryKey, 'technicians'],
    enabled:
      Boolean(activeOrganizationId) &&
      !isContextSwitching &&
      !cloudOnlyUnavailable,
    queryFn: async () => {
      return calibraApi.jobs.listTechnicians() as Promise<{
        data: Array<Technician>
      }>
    },
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
      <Card>
        <CardContent className="pt-6 text-destructive">
          Erro ao carregar solicitação.
        </CardContent>
      </Card>
    )
  }

  const triagePanelKey = [
    organizationQueryKey,
    id,
    detailQuery.dataUpdatedAt,
    servicesQuery.dataUpdatedAt,
  ].join(':')

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Solicitação #{request.id}
          </h1>
          <p className="text-sm text-muted-foreground">
            Cliente {request.customerName} · enviada em{' '}
            {formatDate(request.submittedAt)}
          </p>
        </div>
        <Badge variant={statusVariants[request.status]}>
          {statusLabels[request.status]}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Resumo</CardTitle>
          <CardDescription>
            Contexto enviado pelo cliente e histórico da triagem.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-sm text-muted-foreground">
              Prazo solicitado
            </div>
            <div className="font-medium">
              {formatDate(request.requestedDueDate)}
            </div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Solicitado por</div>
            <div className="font-medium">{request.submittedByName || '-'}</div>
          </div>
          <div className="sm:col-span-2">
            <div className="text-sm text-muted-foreground">
              Observações do cliente
            </div>
            <div className="font-medium">
              {request.observations?.trim() || 'Sem observações informadas.'}
            </div>
          </div>
          {request.rejectionReason && (
            <div className="sm:col-span-2">
              <div className="text-sm text-muted-foreground">
                Motivo da rejeição
              </div>
              <div className="font-medium">{request.rejectionReason}</div>
            </div>
          )}
        </CardContent>
      </Card>

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
