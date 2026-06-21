import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Location01Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Panel } from '@/components/instrument-panel'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import { useRequestTechniciansData } from '@/features/requests/queries'
import {
  useNewJobCustomerAssetsData,
  useNewJobServicesData,
} from '@/features/jobs/queries'
import { useVisitDetailData } from '@/features/visits/queries'
import {
  formatVisitAddress,
  VISIT_STATUS_LABELS,
  VISIT_STATUS_VARIANTS,
  type VisitDetail,
  type VisitDetailJob,
} from '@/features/visits/types'

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'A confirmar'
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** ISO string → YYYY-MM-DD for a native date input. */
function toDateInputValue(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

export function VisitDetailPage({ visitId }: { visitId: number }) {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()

  const enabled =
    Boolean(activeOrganizationId) &&
    !isContextSwitching &&
    !cloudOnlyUnavailable

  const { data, isLoading, error } = useVisitDetailData({
    visitId,
    enabled,
  })

  if (cloudOnlyUnavailable) {
    return <CloudOnlyOfflineState title="Visitas indisponíveis offline" />
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="size-7" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <BackLink />
        <div className="rounded-xl bg-destructive/10 p-4 text-center text-sm text-destructive">
          Visita não encontrada.
        </div>
      </div>
    )
  }

  return <VisitDetailContent key={data.id} visit={data} />
}

function BackLink() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 text-muted-foreground"
      render={<Link to="/dashboard/visits" />}
    >
      <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
      Visitas
    </Button>
  )
}

function VisitDetailContent({ visit }: { visit: VisitDetail }) {
  const queryClient = useQueryClient()
  const { activeOrganizationId } = useDashboardContextState()
  const { data: techniciansData } = useRequestTechniciansData({
    activeOrganizationId,
    enabled: Boolean(activeOrganizationId),
  })
  const technicians = techniciansData?.data ?? []

  const [scheduledAt, setScheduledAt] = useState(
    toDateInputValue(visit.scheduledAt),
  )
  const [technicianId, setTechnicianId] = useState(visit.technicianId ?? '')
  const [cancelReason, setCancelReason] = useState('')

  // Add-instrument state — only used when visit is PROPOSED
  const [addAssetId, setAddAssetId] = useState<string>('')
  const [addServiceId, setAddServiceId] = useState<string>('')

  const isProposed = visit.status === 'PROPOSED'
  const isTerminal =
    visit.status === 'COMPLETED' || visit.status === 'CANCELLED'

  // Fetch customer assets when the visit is PROPOSED
  const { data: customerAssetsData } = useNewJobCustomerAssetsData({
    customerId: isProposed ? visit.customerId : null,
    enabled: isProposed,
  })
  const customerAssets = customerAssetsData?.data ?? []

  // Find the selected asset's typeId for filtering services
  const selectedAsset = customerAssets.find(
    (a) => String(a.id) === addAssetId,
  )
  const selectedAssetTypeId = selectedAsset?.assetTypeId ?? null

  // Fetch compatible services filtered by asset type
  const { data: servicesData } = useNewJobServicesData({
    assetTypeId: selectedAssetTypeId,
    enabled: isProposed && Boolean(addAssetId),
  })
  const compatibleServices = servicesData?.data ?? []

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['visit', visit.id] }),
      queryClient.invalidateQueries({ queryKey: ['visits'] }),
    ])
  }

  const assignMutation = useMutation({
    mutationFn: async () =>
      calibraApi.visits.assign(visit.id, { technicianId }),
    onSuccess: async () => {
      await invalidate()
      toast.success('Técnico atribuído')
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  const rescheduleMutation = useMutation({
    mutationFn: async () =>
      calibraApi.visits.reschedule(visit.id, {
        scheduledAt: scheduledAt || null,
      }),
    onSuccess: async () => {
      await invalidate()
      toast.success('Visita reagendada')
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  const confirmMutation = useMutation({
    mutationFn: async () =>
      calibraApi.visits.confirm(visit.id, {
        scheduledAt: scheduledAt || null,
        technicianId: technicianId || null,
      }),
    onSuccess: async () => {
      await invalidate()
      toast.success('Visita confirmada')
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  const cancelMutation = useMutation({
    mutationFn: async () =>
      calibraApi.visits.cancel(visit.id, {
        reason: cancelReason.trim() || null,
      }),
    onSuccess: async () => {
      await invalidate()
      toast.success('Visita cancelada')
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  const completeMutation = useMutation({
    mutationFn: async () => calibraApi.visits.complete(visit.id),
    onSuccess: async () => {
      await invalidate()
      toast.success('Visita concluída')
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  const addJobMutation = useMutation({
    mutationFn: async () => {
      const assetId = parseInt(addAssetId, 10)
      const serviceId = parseInt(addServiceId, 10)
      return calibraApi.visits.addJob(visit.id, { assetId, serviceId })
    },
    onSuccess: async () => {
      setAddAssetId('')
      setAddServiceId('')
      await invalidate()
      toast.success('Instrumento adicionado à visita')
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  const removeJobMutation = useMutation({
    mutationFn: async (jobId: number) =>
      calibraApi.visits.removeJob(visit.id, jobId),
    onSuccess: async () => {
      await invalidate()
      toast.success('Instrumento removido da visita')
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  const busy =
    assignMutation.isPending ||
    rescheduleMutation.isPending ||
    confirmMutation.isPending ||
    cancelMutation.isPending ||
    completeMutation.isPending ||
    addJobMutation.isPending ||
    removeJobMutation.isPending

  const canComplete =
    visit.status === 'CONFIRMED' || visit.status === 'IN_PROGRESS'

  const addressText = formatVisitAddress(visit.address)
  const technicianChanged = (visit.technicianId ?? '') !== technicianId
  const dateChanged = toDateInputValue(visit.scheduledAt) !== scheduledAt

  const canAddJob =
    isProposed &&
    Boolean(addAssetId) &&
    Boolean(addServiceId) &&
    !Number.isNaN(parseInt(addAssetId, 10)) &&
    !Number.isNaN(parseInt(addServiceId, 10))

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="space-y-3">
        <BackLink />
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Visita in loco
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {visit.customerName}
            </h1>
            <Badge variant={VISIT_STATUS_VARIANTS[visit.status]}>
              {VISIT_STATUS_LABELS[visit.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Agendada para{' '}
            <span className="font-mono">
              {formatDateTime(visit.scheduledAt)}
            </span>
            {visit.technicianName
              ? ` · ${visit.technicianName}`
              : ' · sem técnico'}
          </p>
          {addressText ? (
            <p className="text-sm text-muted-foreground text-pretty">
              {addressText}
            </p>
          ) : null}
        </div>
      </div>

      {!isTerminal ? (
        <Panel className="space-y-4 p-4 sm:p-5">
          <p className="text-sm font-medium">Agendamento</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Data da visita</label>
              <Input
                type="date"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Técnico</label>
              <Select
                value={technicianId || 'unassigned'}
                onValueChange={(value) =>
                  setTechnicianId(!value || value === 'unassigned' ? '' : value)
                }
              >
                <SelectTrigger>
                  <span>
                    {technicianId
                      ? technicians.find(
                          (technician) => technician.id === technicianId,
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

          <div className="flex flex-wrap items-center gap-2">
            {visit.status === 'PROPOSED' ? (
              <Button
                size="sm"
                disabled={busy || !scheduledAt || !technicianId}
                onClick={() => confirmMutation.mutate()}
              >
                Confirmar visita
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !technicianId || !technicianChanged}
              onClick={() => assignMutation.mutate()}
            >
              {visit.technicianId ? 'Reatribuir técnico' : 'Atribuir técnico'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !scheduledAt || !dateChanged}
              onClick={() => rescheduleMutation.mutate()}
            >
              Reagendar
            </Button>
            {canComplete ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => completeMutation.mutate()}
              >
                Concluir visita
              </Button>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    disabled={busy}
                  >
                    Cancelar visita
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancelar visita?</AlertDialogTitle>
                  <AlertDialogDescription>
                    A visita será cancelada e o cliente e o técnico serão
                    notificados. Os jobs já criados não são removidos.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Textarea
                  placeholder="Motivo do cancelamento (opcional)"
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                />
                <AlertDialogFooter>
                  <AlertDialogCancel>Voltar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => cancelMutation.mutate()}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    Cancelar visita
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Panel>
      ) : visit.status === 'CANCELLED' && visit.cancelReason ? (
        <Panel className="p-4 sm:p-5">
          <p className="text-sm font-medium">Motivo do cancelamento</p>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            {visit.cancelReason}
          </p>
        </Panel>
      ) : null}

      <Panel className="p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">
            Instrumentos ({visit.jobs.length})
          </p>
          {visit.sourceRequestId ? (
            <Button
              variant="ghost"
              size="sm"
              render={
                <Link
                  to="/dashboard/requests/$id"
                  params={{ id: String(visit.sourceRequestId) }}
                />
              }
            >
              Ver solicitação
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
            </Button>
          ) : null}
        </div>
        <div className="mt-3 space-y-2">
          {visit.jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum instrumento vinculado a esta visita.
            </p>
          ) : (
            visit.jobs.map((job) => (
              <VisitJobRow
                key={job.jobId}
                job={job}
                isProposed={isProposed}
                busy={busy}
                onRemove={() => removeJobMutation.mutate(job.jobId)}
              />
            ))
          )}
        </div>

        {isProposed ? (
          <div className="mt-4 space-y-3 border-t pt-4">
            <p className="text-sm font-medium">Adicionar instrumento</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">
                  Instrumento
                </label>
                <Select
                  value={addAssetId || 'none'}
                  onValueChange={(value) => {
                    setAddAssetId(!value || value === 'none' ? '' : value)
                    setAddServiceId('')
                  }}
                >
                  <SelectTrigger>
                    <span>
                      {addAssetId
                        ? customerAssets.find(
                            (a) => String(a.id) === addAssetId,
                          )?.name || 'Selecione'
                        : 'Selecione'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Selecione</SelectItem>
                    {customerAssets.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name} ({a.tag})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">Serviço</label>
                <Select
                  value={addServiceId || 'none'}
                  onValueChange={(value) =>
                    setAddServiceId(!value || value === 'none' ? '' : value)
                  }
                  disabled={!addAssetId}
                >
                  <SelectTrigger>
                    <span>
                      {addServiceId
                        ? compatibleServices.find(
                            (s) => String(s.id) === addServiceId,
                          )?.name || 'Selecione'
                        : 'Selecione'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Selecione</SelectItem>
                    {compatibleServices.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              size="sm"
              disabled={busy || !canAddJob}
              onClick={() => addJobMutation.mutate()}
            >
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
              Adicionar instrumento
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  )
}

function VisitJobRow({
  job,
  isProposed,
  busy,
  onRemove,
}: {
  job: VisitDetailJob
  isProposed: boolean
  busy: boolean
  onRemove: () => void
}) {
  const isDraft = job.status === 'DRAFT'

  return (
    <div className="flex items-center gap-2">
      <Link
        to="/dashboard/jobs/$id"
        params={{ id: String(job.jobId) }}
        className="flex flex-1 items-center justify-between rounded-xl bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] transition-colors hover:bg-muted/50 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
      >
        <div className="min-w-0">
          <span className="truncate text-sm font-medium">
            {job.assetName} ({job.assetTag})
          </span>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {job.jobCode}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{job.status}</Badge>
          <HugeiconsIcon
            icon={Location01Icon}
            strokeWidth={2}
            className="size-4 text-muted-foreground"
          />
        </div>
      </Link>
      {isProposed && isDraft ? (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-destructive"
          disabled={busy}
          onClick={onRemove}
          aria-label="Remover instrumento da visita"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        </Button>
      ) : null}
    </div>
  )
}
