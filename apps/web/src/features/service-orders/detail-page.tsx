import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle02Icon,
  Delete02Icon,
  File02Icon,
  PlusSignIcon,
  SentIcon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import {
  getServiceOrderDeliveryDocumentUrl,
  getServiceOrderIntakeDocumentUrl,
  getServiceOrderTagDocumentUrl,
  useServiceOrderDetailData,
  useServiceOrderFinancialStatusData,
} from '@/features/service-orders/queries'
import type {
  ServiceOrderDetail,
  ServiceOrderExecutionResult,
  ServiceOrderItemType,
  ServiceOrderRecommendedAction,
} from '@/features/service-orders/types'
import {
  buildServiceOrderDetailFormKey,
  buildServiceOrderIntakeHtml,
  buildServiceOrderTimelineItems,
  createEmptyQuoteItem,
  DELIVERY_METHOD_LABELS,
  EXECUTION_RESULT_LABELS,
  formatDateTime,
  getPublicUrl,
  ITEM_TYPE_LABELS,
  money,
  QUOTE_STATUS_LABELS,
  quoteItemsTotal,
  RECOMMENDED_ACTION_LABELS,
  serviceOrderFinancialStatusSummary,
  toApiItems,
  WORKFLOW_TABS,
  type QuoteDraftItem,
} from '@/features/service-orders/detail-model'
import { EventTimeline } from '@/components/event-timeline'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ACTION_BUTTON_CLASS,
  BlueprintOverlay,
  Panel,
} from '@/components/instrument-panel'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { isDesktopRuntime } from '@calibra-facil/client-runtime'
import type { ServiceOrderFinancialStatus } from '@calibra-facil/shared'
import { InstallmentsBlock } from '@/features/finance/installments-block'
import {
  shouldReturnToSyncConflicts,
  SyncConflictReturnNotice,
  type SyncConflictReturnSearch,
} from '@/runtime/sync-conflict-return'
import { usePlanAccess } from '@/hooks/use-plan-access'

function openServiceOrderIntakePreview(order: ServiceOrderDetail) {
  const previewWindow = window.open('', '_blank')
  if (!previewWindow) {
    toast.error('O navegador bloqueou a nova aba do comprovante')
    return
  }

  previewWindow.opener = null
  previewWindow.document.open()
  previewWindow.document.write(buildServiceOrderIntakeHtml(order))
  previewWindow.document.close()

  const printPreview = () => {
    previewWindow.focus()
    previewWindow.print()
  }

  if (previewWindow.document.readyState === 'complete') {
    window.setTimeout(printPreview, 100)
  } else {
    previewWindow.addEventListener('load', printPreview, { once: true })
  }
}

type ServiceOrderDetailPageProps = {
  id: string
  conflictReturn: SyncConflictReturnSearch
}

type WorkflowTabValue = (typeof WORKFLOW_TABS)[number]['value']
type DeliveryMethod = keyof typeof DELIVERY_METHOD_LABELS
const FINANCIAL_STATUS_SKELETON_TILES = [
  'open',
  'overdue',
  'paid',
  'updated',
] as const

function toWorkflowTabValue(value: string): WorkflowTabValue {
  switch (value) {
    case 'quote':
    case 'execution':
    case 'delivery':
    case 'evaluation':
      return value
    default:
      return 'evaluation'
  }
}

function toRecommendedAction(value: string): ServiceOrderRecommendedAction {
  switch (value) {
    case 'calibration_only':
    case 'return_without_repair':
    case 'condemned':
    case 'warranty_service':
    case 'external_service_required':
    case 'repair':
      return value
    default:
      return 'repair'
  }
}

function toServiceOrderItemType(value: string): ServiceOrderItemType {
  switch (value) {
    case 'part':
    case 'external_service':
    case 'freight':
    case 'discount':
    case 'evaluation_fee':
    case 'other':
    case 'service':
      return value
    default:
      return 'service'
  }
}

function toExecutionResult(value: string): ServiceOrderExecutionResult {
  switch (value) {
    case 'not_repaired':
    case 'condemned':
    case 'returned_without_service':
    case 'sent_to_third_party':
    case 'repaired':
      return value
    default:
      return 'repaired'
  }
}

function toDeliveryMethod(value: string): DeliveryMethod {
  switch (value) {
    case 'ship_to_client':
    case 'third_party_pickup':
    case 'pickup_at_lab':
      return value
    default:
      return 'pickup_at_lab'
  }
}

export function ServiceOrderFinancialStatusBlock({
  status,
  loading,
  error,
  onRetry,
}: {
  status: ServiceOrderFinancialStatus | null
  loading: boolean
  error: Error | null
  onRetry: () => void
}) {
  if (loading) {
    return (
      <Card aria-live="polite">
        <CardHeader className="border-b border-border/70">
          <span className="sr-only">Carregando status financeiro...</span>
          <div className="h-5 w-48 rounded bg-muted" />
          <div className="mt-3 h-4 w-72 rounded bg-muted/70" />
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
            {FINANCIAL_STATUS_SKELETON_TILES.map((tile) => (
              <div
                key={tile}
                className="border-b border-border/70 px-4 py-4 sm:border-r lg:border-b-0"
              >
                <div className="h-3 w-20 rounded bg-muted/70" />
                <div className="mt-3 h-5 w-24 rounded bg-muted" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card aria-live="polite">
        <CardContent className="flex flex-col gap-3 pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Status financeiro indisponível no momento.</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!status) return null

  const summary = serviceOrderFinancialStatusSummary(status)
  const mainBlocker = status.blockers[0]
  const shouldShowMetrics =
    status.billingDocument !== null &&
    ![
      'NOT_CONFIGURED',
      'NOT_SENT',
      'READY_FOR_BILLING',
      'BLOCKED',
      'STATUS_UNAVAILABLE',
    ].includes(status.status)

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold leading-none tracking-tight">
              Status financeiro
              <Badge variant={summary.badgeVariant}>{status.label}</Badge>
            </h3>
            <CardDescription className="text-pretty">
              {mainBlocker?.label ?? status.description}
            </CardDescription>
          </div>
          <div className="text-left text-xs text-muted-foreground sm:text-right">
            {summary.evidenceReconnectPath ? (
              <Button
                render={<Link to={summary.evidenceReconnectPath} />}
                variant="link"
                size="xs"
                className="h-auto p-0 text-xs"
              >
                {summary.evidenceLabel}
              </Button>
            ) : (
              summary.evidenceLabel
            )}
          </div>
        </div>
      </CardHeader>
      {shouldShowMetrics ? (
        <CardContent className="p-0">
          <dl className="grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
            <div className="border-b border-border/70 px-4 py-4 sm:border-r lg:border-b-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Em aberto
              </dt>
              <dd className="mt-2 text-lg font-semibold tabular-nums">
                {summary.openLabel}
              </dd>
            </div>
            <div className="border-b border-border/70 px-4 py-4 lg:border-r lg:border-b-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Vencido
              </dt>
              <dd
                className={`mt-2 text-lg font-semibold tabular-nums ${
                  summary.overdueCents > 0 ? 'text-destructive' : ''
                }`}
              >
                {summary.overdueLabel}
              </dd>
            </div>
            <div className="border-b border-border/70 px-4 py-4 sm:border-r sm:border-b-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recebido
              </dt>
              <dd className="mt-2 text-lg font-semibold tabular-nums">
                {summary.receivedLabel}
              </dd>
            </div>
            <div className="px-4 py-4">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Última atualização
              </dt>
              <dd className="mt-2 text-sm tabular-nums">
                {summary.lastUpdateLabel}
              </dd>
            </div>
          </dl>
        </CardContent>
      ) : null}
    </Card>
  )
}

export function ServiceOrderDetailPage({
  id,
  conflictReturn,
}: ServiceOrderDetailPageProps) {
  const orderQuery = useServiceOrderDetailData(id)
  const accessQuery = usePlanAccess()
  const hasFinancial =
    accessQuery.data?.entitlements.includes('financial') ?? false
  const financialStatusQuery = useServiceOrderFinancialStatusData({
    enabled: hasFinancial,
    id,
  })

  if (!orderQuery.data) {
    return (
      <Card>
        <CardContent className="pt-6">Carregando OS...</CardContent>
      </Card>
    )
  }

  return (
    <ServiceOrderDetailContent
      key={buildServiceOrderDetailFormKey(orderQuery.data)}
      id={id}
      order={orderQuery.data}
      showFinancialStatus={hasFinancial}
      financialStatus={financialStatusQuery.data?.data ?? null}
      financialStatusLoading={financialStatusQuery.isLoading}
      financialStatusError={financialStatusQuery.error}
      financialStatusRetry={() => {
        void financialStatusQuery.refetch()
      }}
      conflictReturn={conflictReturn}
    />
  )
}

function ServiceOrderDetailContent({
  id,
  order,
  showFinancialStatus,
  financialStatus,
  financialStatusLoading,
  financialStatusError,
  financialStatusRetry,
  conflictReturn,
}: {
  id: string
  order: ServiceOrderDetail
  showFinancialStatus: boolean
  financialStatus: ServiceOrderFinancialStatus | null
  financialStatusLoading: boolean
  financialStatusError: Error | null
  financialStatusRetry: () => void
  conflictReturn: SyncConflictReturnSearch
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const isDesktop = isDesktopRuntime()
  const latestEvaluation = order.evaluations[0]
  const latestQuote = order.quotes[0]
  const draftQuotes =
    order.quotes.filter((quote) => quote.status === 'draft') ?? []
  const approvedQuote = order.quotes.find(
    (quote) => quote.status === 'approved',
  )
  const latestDeliveryDocument = order.deliveryDocuments[0]
  const [diagnosis, setDiagnosis] = useState(latestEvaluation?.diagnosis ?? '')
  const [detectedIssues, setDetectedIssues] = useState(
    latestEvaluation?.detectedIssues ?? '',
  )
  const [recommendedAction, setRecommendedAction] =
    useState<ServiceOrderRecommendedAction>(
      latestEvaluation?.recommendedAction ?? 'repair',
    )
  const [requiresQuote, setRequiresQuote] = useState(
    latestEvaluation?.requiresQuote ?? true,
  )
  const [requiresClientApproval, setRequiresClientApproval] = useState(
    latestEvaluation?.requiresClientApproval ?? true,
  )
  const [calibrationRecommended, setCalibrationRecommended] = useState(
    latestEvaluation?.calibrationRecommended ?? false,
  )
  const [evaluationClientNotes, setEvaluationClientNotes] = useState(
    latestEvaluation?.clientVisibleNotes ?? '',
  )
  const [quoteItems, setQuoteItems] = useState<QuoteDraftItem[]>([
    createEmptyQuoteItem('service'),
    createEmptyQuoteItem('part'),
  ])
  const [paymentTerms, setPaymentTerms] = useState('')
  const [deliveryEstimate, setDeliveryEstimate] = useState('')
  const [quoteClientMessage, setQuoteClientMessage] = useState('')
  const [executionServicePerformed, setExecutionServicePerformed] = useState(
    order.execution?.servicePerformed ?? '',
  )
  const [executionPartsUsedSummary, setExecutionPartsUsedSummary] = useState(
    order.execution?.partsUsedSummary ?? '',
  )
  const [executionTechnicalNotes, setExecutionTechnicalNotes] = useState(
    order.execution?.technicalNotes ?? '',
  )
  const [executionResult, setExecutionResult] =
    useState<ServiceOrderExecutionResult>(order.execution?.result ?? 'repaired')
  const [executionRequiresCalibration, setExecutionRequiresCalibration] =
    useState(order.execution?.calibrationRequiredAfterRepair ?? false)
  const [deliveryMethod, setDeliveryMethod] = useState<
    keyof typeof DELIVERY_METHOD_LABELS
  >(order.deliveryMethod ?? 'pickup_at_lab')
  const [deliveredToDocument, setDeliveredToDocument] = useState(
    order.deliveredToDocument ?? '',
  )
  const [deliveryNotes, setDeliveryNotes] = useState(order.deliveryNotes ?? '')
  const [repairSealNumber, setRepairSealNumber] = useState(
    order.inmetroRepairSealNumber ?? '',
  )
  const [repairSealNotes, setRepairSealNotes] = useState(
    order.inmetroRepairSealNotes ?? '',
  )
  const [repairSealApplied, setRepairSealApplied] = useState(
    Boolean(order.inmetroRepairSealAppliedAt),
  )
  const [activeTab, setActiveTab] =
    useState<(typeof WORKFLOW_TABS)[number]['value']>('evaluation')
  const quoteTotal = useMemo(() => quoteItemsTotal(quoteItems), [quoteItems])
  const returnToSyncConflicts = () => {
    if (shouldReturnToSyncConflicts(conflictReturn)) {
      navigate({ to: '/dashboard/sync/conflicts' })
    }
  }

  const saveEvaluation = useMutation({
    mutationFn: async () => {
      if (!diagnosis.trim()) throw new Error('Informe o diagnóstico técnico.')
      await calibraApi.serviceOrders.saveEvaluation(
        id,
        latestEvaluation?.id ?? null,
        {
          diagnosis,
          detectedIssues: detectedIssues || null,
          recommendedAction,
          requiresQuote,
          requiresClientApproval,
          calibrationRecommended,
          clientVisibleNotes: evaluationClientNotes || null,
          photos: [],
        },
      )
    },
    onSuccess: () => {
      toast.success(
        latestEvaluation ? 'Avaliação atualizada' : 'Avaliação registrada',
      )
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
      returnToSyncConflicts()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao salvar avaliação',
      )
    },
  })

  const createQuote = useMutation({
    mutationFn: async () => {
      await calibraApi.serviceOrders.createQuote(id, {
        deliveryEstimate: deliveryEstimate || null,
        paymentTerms: paymentTerms || null,
        clientMessage: quoteClientMessage || null,
        items: toApiItems(quoteItems),
      })
    },
    onSuccess: () => {
      toast.success('Orçamento salvo como rascunho')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
      returnToSyncConflicts()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao salvar orçamento',
      )
    },
  })

  const sendQuote = useMutation({
    mutationFn: async (quoteId: number) => {
      return calibraApi.serviceOrders.sendQuote(id, quoteId, {
        clientMessage: quoteClientMessage || null,
      })
    },
    onSuccess: (result) => {
      toast.success('Orçamento emitido para aprovação')
      const publicUrl = getPublicUrl(result)
      if (publicUrl) {
        navigator.clipboard?.writeText(publicUrl)
      }
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao emitir orçamento',
      )
    },
  })

  const startExecution = useMutation({
    mutationFn: async () => {
      await calibraApi.serviceOrders.saveExecution(id, {
        technicalNotes: executionTechnicalNotes || null,
      })
    },
    onSuccess: () => {
      toast.success('Execução iniciada')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
      returnToSyncConflicts()
    },
  })

  const finishExecution = useMutation({
    mutationFn: async () => {
      await calibraApi.serviceOrders.saveExecution(id, {
        servicePerformed: executionServicePerformed,
        partsUsedSummary: executionPartsUsedSummary || null,
        technicalNotes: executionTechnicalNotes || null,
        calibrationRequiredAfterRepair: executionRequiresCalibration,
        result: executionResult,
        items: approvedQuote?.items.map((item) => ({
          type: item.type,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPriceCents: item.unitPriceCents,
        })),
      })
    },
    onSuccess: () => {
      toast.success('Execução finalizada')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
      returnToSyncConflicts()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao finalizar execução',
      )
    },
  })

  const generateIntakeDocument = useMutation({
    mutationFn: () => calibraApi.serviceOrders.generateIntakeDocument(id),
    onSuccess: () => {
      toast.success('Comprovante enviado para geração')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
    },
  })

  const openIntakeDocument = useMutation({
    mutationFn: async () => {
      const url = await getServiceOrderIntakeDocumentUrl(id)
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível abrir o comprovante',
      )
    },
  })

  const generateTag = useMutation({
    mutationFn: () => calibraApi.serviceOrders.generateTag(id),
    onSuccess: () => {
      toast.success('Etiqueta enviada para geração')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
    },
  })

  const openTag = useMutation({
    mutationFn: async () => {
      const url = await getServiceOrderTagDocumentUrl(id)
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível abrir a etiqueta',
      )
    },
  })

  const updateRepairSeal = useMutation({
    mutationFn: async () => {
      await calibraApi.serviceOrders.updateRepairSeal(id, {
        inmetroRepairSealNumber: repairSealNumber || null,
        inmetroRepairSealIssuedAt: repairSealNumber
          ? new Date().toISOString()
          : null,
        inmetroRepairSealAppliedAt: repairSealApplied
          ? new Date().toISOString()
          : null,
        inmetroRepairSealNotes: repairSealNotes || null,
      })
    },
    onSuccess: () => {
      toast.success('Selo de reparado atualizado')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
      returnToSyncConflicts()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao salvar selo',
      )
    },
  })

  const deliverOrder = useMutation({
    mutationFn: async () => {
      if (!order?.customerName) throw new Error('Cliente da OS não encontrado.')
      await calibraApi.serviceOrders.deliver(id, {
        deliveryMethod,
        deliveredToName: order.customerName,
        deliveredToDocument: deliveredToDocument || null,
        deliveryNotes: deliveryNotes || null,
        inmetroRepairSealNumber: repairSealNumber || null,
      })
    },
    onSuccess: () => {
      toast.success('Entrega registrada')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
      returnToSyncConflicts()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao registrar entrega',
      )
    },
  })

  const issueDeliveryDocument = useMutation({
    mutationFn: async () => {
      await calibraApi.serviceOrders.issueDeliveryDocument(id, {
        technicianSignatureData: null,
        clientSignatureData: null,
      })
    },
    onSuccess: () => {
      toast.success('Comprovante de entrega enviado para geração')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Erro ao gerar comprovante de entrega',
      )
    },
  })

  const openDeliveryDocument = useMutation({
    mutationFn: async () => {
      const url = await getServiceOrderDeliveryDocumentUrl(id)
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível abrir o comprovante de entrega',
      )
    },
  })

  function updateQuoteItem(itemId: string, patch: Partial<QuoteDraftItem>) {
    setQuoteItems((items) =>
      items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    )
  }

  function removeQuoteItem(itemId: string) {
    setQuoteItems((items) =>
      items.length === 1 ? items : items.filter((item) => item.id !== itemId),
    )
  }

  const execution = order.execution

  return (
    <div className="space-y-6">
      <SyncConflictReturnNotice search={conflictReturn} />
      <Panel className="relative overflow-hidden">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Ordem de serviço
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-balance font-mono text-2xl font-semibold tracking-tight">
                  {order.serviceOrderNumber}
                </h1>
                <Badge>{order.statusLabel}</Badge>
              </div>
              <p className="mt-0.5 text-pretty text-sm text-muted-foreground">
                {order.customerName} · {order.assetName}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className={ACTION_BUTTON_CLASS}
                onClick={() => openServiceOrderIntakePreview(order)}
              >
                <HugeiconsIcon icon={File02Icon} className="mr-2 size-4" />
                Pré-visualizar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={ACTION_BUTTON_CLASS}
                onClick={() => generateIntakeDocument.mutate()}
                disabled={isDesktop || generateIntakeDocument.isPending}
              >
                Gerar comprovante
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={ACTION_BUTTON_CLASS}
                onClick={() => openIntakeDocument.mutate()}
                disabled={isDesktop || openIntakeDocument.isPending}
              >
                Abrir comprovante
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={ACTION_BUTTON_CLASS}
                onClick={() => generateTag.mutate()}
                disabled={isDesktop || generateTag.isPending}
              >
                Gerar etiqueta
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={ACTION_BUTTON_CLASS}
                onClick={() => openTag.mutate()}
                disabled={isDesktop || openTag.isPending}
              >
                Abrir etiqueta
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-muted/40 p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Recebimento
              </p>
              <p className="mt-2 text-pretty text-sm text-muted-foreground">
                {order.claimedDefect}
              </p>
              <p className="mt-1 text-pretty text-sm">
                {order.intakeCondition}
              </p>
            </div>
            <div className="rounded-xl bg-muted/40 p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Última avaliação
              </p>
              <p className="mt-2 text-pretty text-sm text-muted-foreground">
                {latestEvaluation?.diagnosis ?? 'Nenhuma avaliação registrada.'}
              </p>
              {latestEvaluation ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {RECOMMENDED_ACTION_LABELS[
                    latestEvaluation.recommendedAction
                  ] ?? latestEvaluation.recommendedAction}
                </p>
              ) : null}
            </div>
            <div className="rounded-xl bg-muted/40 p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Orçamento atual
              </p>
              {latestQuote ? (
                <div className="mt-2 space-y-1 text-sm">
                  <p>
                    v{latestQuote.version} ·{' '}
                    {QUOTE_STATUS_LABELS[latestQuote.status] ??
                      latestQuote.status}{' '}
                    ·{' '}
                    <span className="font-mono tabular-nums">
                      {money(latestQuote.totalCents)}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Prazo: {latestQuote.deliveryEstimate || 'Não informado'}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nenhum orçamento salvo.
                </p>
              )}
            </div>
          </div>
        </div>
      </Panel>

      {showFinancialStatus ? (
        <ServiceOrderFinancialStatusBlock
          status={financialStatus}
          loading={financialStatusLoading}
          error={financialStatusError}
          onRetry={financialStatusRetry}
        />
      ) : null}

      {showFinancialStatus && financialStatus?.installmentsSummary?.total ? (
        <InstallmentsBlock
          installments={financialStatus.installments}
          summary={financialStatus.installmentsSummary}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(toWorkflowTabValue(value))}
          className="min-w-0 gap-4"
        >
          <div className="overflow-x-auto overflow-y-hidden rounded-lg bg-muted/40 p-1 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
            <TabsList className="grid min-w-[620px] grid-cols-4 bg-transparent p-0 group-data-horizontal/tabs:h-11 md:min-w-0 md:w-full">
              {WORKFLOW_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="h-10 min-h-10 px-3 text-sm active:scale-[0.96] transition-transform"
                >
                  <HugeiconsIcon icon={tab.icon} className="size-4" />
                  <span className="text-balance">{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="evaluation" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle>Avaliação técnica</CardTitle>
                <CardDescription>
                  {latestEvaluation
                    ? 'Edite a avaliação já registrada para esta OS.'
                    : 'Registre o diagnóstico e a decisão técnica antes do orçamento.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
                  <div className="space-y-2">
                    <Label>Diagnóstico</Label>
                    <Textarea
                      className="min-h-28 resize-y"
                      value={diagnosis}
                      onChange={(event) => setDiagnosis(event.target.value)}
                      placeholder="Descreva a causa provável, condição encontrada e limitações técnicas."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Ação recomendada</Label>
                    <NativeSelect
                      className="w-full"
                      value={recommendedAction}
                      onChange={(event) =>
                        setRecommendedAction(
                          toRecommendedAction(event.target.value),
                        )
                      }
                    >
                      {Object.entries(RECOMMENDED_ACTION_LABELS).map(
                        ([value, label]) => (
                          <NativeSelectOption key={value} value={value}>
                            {label}
                          </NativeSelectOption>
                        ),
                      )}
                    </NativeSelect>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Problemas detectados</Label>
                    <Textarea
                      className="min-h-24 resize-y"
                      value={detectedIssues}
                      onChange={(event) =>
                        setDetectedIssues(event.target.value)
                      }
                      placeholder="Falhas, componentes comprometidos ou evidências observadas."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Observação para o cliente</Label>
                    <Textarea
                      className="min-h-24 resize-y"
                      value={evaluationClientNotes}
                      onChange={(event) =>
                        setEvaluationClientNotes(event.target.value)
                      }
                      placeholder="Resumo objetivo que pode aparecer na comunicação com o cliente."
                    />
                  </div>
                </div>
                <div className="grid gap-3 rounded-lg bg-muted/40 p-4 md:grid-cols-3">
                  <label className="flex min-h-10 items-center gap-3 text-sm">
                    <Checkbox
                      checked={requiresQuote}
                      onCheckedChange={(checked) =>
                        setRequiresQuote(Boolean(checked))
                      }
                    />
                    Requer orçamento
                  </label>
                  <label className="flex min-h-10 items-center gap-3 text-sm">
                    <Checkbox
                      checked={requiresClientApproval}
                      onCheckedChange={(checked) =>
                        setRequiresClientApproval(Boolean(checked))
                      }
                    />
                    Requer aprovação
                  </label>
                  <label className="flex min-h-10 items-center gap-3 text-sm">
                    <Checkbox
                      checked={calibrationRecommended}
                      onCheckedChange={(checked) =>
                        setCalibrationRecommended(Boolean(checked))
                      }
                    />
                    Calibração após reparo
                  </label>
                </div>
                <div className="flex justify-end">
                  <Button
                    className="active:scale-[0.96] transition-transform"
                    onClick={() => saveEvaluation.mutate()}
                    disabled={isDesktop || saveEvaluation.isPending}
                  >
                    <HugeiconsIcon
                      icon={CheckmarkCircle02Icon}
                      className="mr-2 size-4"
                    />
                    {latestEvaluation
                      ? 'Salvar avaliação'
                      : 'Registrar avaliação'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="quote" className="mt-0 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Novo orçamento</CardTitle>
                <CardDescription>
                  Monte serviços, peças e prazo no mesmo formato usado pelo PDF.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {quoteItems.map((item, index) => (
                    <div
                      key={item.id}
                      className="grid gap-3 rounded-lg bg-muted/40 p-3 md:grid-cols-[150px_minmax(0,1fr)_90px_80px_130px_40px]"
                    >
                      <div className="space-y-2">
                        <Label>Tipo</Label>
                        <NativeSelect
                          className="w-full"
                          value={item.type}
                          onChange={(event) =>
                            updateQuoteItem(item.id, {
                              type: toServiceOrderItemType(event.target.value),
                            })
                          }
                        >
                          {Object.entries(ITEM_TYPE_LABELS).map(
                            ([value, label]) => (
                              <NativeSelectOption key={value} value={value}>
                                {label}
                              </NativeSelectOption>
                            ),
                          )}
                        </NativeSelect>
                      </div>
                      <div className="space-y-2">
                        <Label>Descrição</Label>
                        <Input
                          value={item.description}
                          onChange={(event) =>
                            updateQuoteItem(item.id, {
                              description: event.target.value,
                            })
                          }
                          placeholder={
                            index === 0 ? 'Serviço executado' : 'Peça utilizada'
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Qtd.</Label>
                        <Input
                          className="tabular-nums"
                          value={item.quantity}
                          onChange={(event) =>
                            updateQuoteItem(item.id, {
                              quantity: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Un.</Label>
                        <Input
                          value={item.unit}
                          onChange={(event) =>
                            updateQuoteItem(item.id, {
                              unit: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Valor</Label>
                        <Input
                          className="tabular-nums"
                          value={item.unitPrice}
                          onChange={(event) =>
                            updateQuoteItem(item.id, {
                              unitPrice: event.target.value,
                            })
                          }
                          placeholder="0,00"
                        />
                      </div>
                      <div className="flex items-end justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="active:scale-[0.96] transition-transform"
                          onClick={() => removeQuoteItem(item.id)}
                          disabled={quoteItems.length === 1}
                          aria-label="Remover item"
                        >
                          <HugeiconsIcon
                            icon={Delete02Icon}
                            className="size-4"
                          />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button
                    variant="outline"
                    className="active:scale-[0.96] transition-transform"
                    onClick={() =>
                      setQuoteItems((items) => [
                        ...items,
                        createEmptyQuoteItem(),
                      ])
                    }
                  >
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Adicionar item
                  </Button>
                  <div className="text-sm text-muted-foreground">
                    Total previsto:{' '}
                    <span className="font-medium text-foreground tabular-nums">
                      {money(quoteTotal)}
                    </span>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Prazo do serviço</Label>
                    <Input
                      value={deliveryEstimate}
                      onChange={(event) =>
                        setDeliveryEstimate(event.target.value)
                      }
                      placeholder="Ex.: 5 dias úteis após aprovação"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Condições de pagamento</Label>
                    <Input
                      value={paymentTerms}
                      onChange={(event) => setPaymentTerms(event.target.value)}
                      placeholder="Ex.: à vista"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Mensagem ao cliente</Label>
                    <Input
                      value={quoteClientMessage}
                      onChange={(event) =>
                        setQuoteClientMessage(event.target.value)
                      }
                      placeholder="Opcional"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    className="active:scale-[0.96] transition-transform"
                    onClick={() => createQuote.mutate()}
                    disabled={createQuote.isPending}
                  >
                    Salvar rascunho
                  </Button>
                  {draftQuotes.map((quote) => (
                    <Button
                      key={quote.id}
                      className="active:scale-[0.96] transition-transform"
                      onClick={() => sendQuote.mutate(quote.id)}
                      disabled={isDesktop || sendQuote.isPending}
                    >
                      <HugeiconsIcon icon={SentIcon} className="mr-2 size-4" />
                      Emitir v{quote.version}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Orçamentos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {order.quotes.length ? (
                  order.quotes.map((quote) => (
                    <div key={quote.id} className="rounded-lg bg-muted/40 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">
                            Versão {quote.version}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {QUOTE_STATUS_LABELS[quote.status] ?? quote.status}
                          </p>
                        </div>
                        <p className="text-sm font-medium tabular-nums">
                          {money(quote.totalCents)}
                        </p>
                      </div>
                      <div className="mt-3 space-y-2">
                        {quote.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-start justify-between gap-3 text-xs"
                          >
                            <span className="text-pretty">
                              {ITEM_TYPE_LABELS[item.type]} · {item.description}
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {money(item.totalPriceCents)}
                            </span>
                          </div>
                        ))}
                      </div>
                      {quote.deliveryEstimate ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Prazo: {quote.deliveryEstimate}
                        </p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhum orçamento registrado para esta OS.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="execution" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle>Execução</CardTitle>
                <CardDescription>
                  Feche a etapa com serviço executado e peças utilizadas.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {execution ? (
                  <div className="rounded-lg bg-muted/40 p-4 text-sm">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div>
                        <p className="text-muted-foreground">Início</p>
                        <p>{formatDateTime(execution.startedAt)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Resultado</p>
                        <p>
                          {execution.result
                            ? (EXECUTION_RESULT_LABELS[execution.result] ??
                              execution.result)
                            : 'Em andamento'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Fim</p>
                        <p>{formatDateTime(execution.finishedAt)}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-4">
                    <p className="text-sm text-muted-foreground">
                      Inicie a execução após a aprovação do orçamento.
                    </p>
                    <Button
                      variant="outline"
                      className="active:scale-[0.96] transition-transform"
                      onClick={() => startExecution.mutate()}
                      disabled={startExecution.isPending}
                    >
                      <HugeiconsIcon
                        icon={Wrench01Icon}
                        className="mr-2 size-4"
                      />
                      Iniciar execução
                    </Button>
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Serviço executado</Label>
                    <Textarea
                      className="min-h-28 resize-y"
                      value={
                        executionServicePerformed ||
                        execution?.servicePerformed ||
                        ''
                      }
                      onChange={(event) =>
                        setExecutionServicePerformed(event.target.value)
                      }
                      placeholder="Descreva o reparo, ajuste ou procedimento realizado."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Peças utilizadas</Label>
                    <Textarea
                      className="min-h-28 resize-y"
                      value={
                        executionPartsUsedSummary ||
                        execution?.partsUsedSummary ||
                        ''
                      }
                      onChange={(event) =>
                        setExecutionPartsUsedSummary(event.target.value)
                      }
                      placeholder="Liste peças substituídas, códigos e quantidades."
                    />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <Label>Resultado</Label>
                    <NativeSelect
                      className="w-full"
                      value={executionResult}
                      onChange={(event) =>
                        setExecutionResult(
                          toExecutionResult(event.target.value),
                        )
                      }
                    >
                      {Object.entries(EXECUTION_RESULT_LABELS).map(
                        ([value, label]) => (
                          <NativeSelectOption key={value} value={value}>
                            {label}
                          </NativeSelectOption>
                        ),
                      )}
                    </NativeSelect>
                  </div>
                  <div className="space-y-2">
                    <Label>Notas técnicas internas</Label>
                    <Input
                      value={
                        executionTechnicalNotes ||
                        execution?.technicalNotes ||
                        ''
                      }
                      onChange={(event) =>
                        setExecutionTechnicalNotes(event.target.value)
                      }
                      placeholder="Opcional"
                    />
                  </div>
                </div>
                <label className="flex min-h-10 items-center gap-3 text-sm">
                  <Checkbox
                    checked={executionRequiresCalibration}
                    onCheckedChange={(checked) =>
                      setExecutionRequiresCalibration(Boolean(checked))
                    }
                  />
                  Encaminhar para calibração após o reparo
                </label>
                <div className="flex justify-end">
                  <Button
                    className="active:scale-[0.96] transition-transform"
                    onClick={() => finishExecution.mutate()}
                    disabled={!execution || finishExecution.isPending}
                  >
                    <HugeiconsIcon
                      icon={CheckmarkCircle02Icon}
                      className="mr-2 size-4"
                    />
                    Finalizar execução
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="delivery" className="mt-0">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle>Entrega e selo Inmetro</CardTitle>
                    <CardDescription>
                      Gere as duas vias do comprovante com valores, assinaturas
                      e selo de reparado.
                    </CardDescription>
                  </div>
                  {latestDeliveryDocument ? (
                    <Badge variant="outline" className="w-fit tabular-nums">
                      {latestDeliveryDocument.documentNumber} v
                      {latestDeliveryDocument.version}
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Forma de entrega</Label>
                    <NativeSelect
                      className="w-full"
                      value={deliveryMethod}
                      onChange={(event) =>
                        setDeliveryMethod(toDeliveryMethod(event.target.value))
                      }
                    >
                      {Object.entries(DELIVERY_METHOD_LABELS).map(
                        ([value, label]) => (
                          <NativeSelectOption key={value} value={value}>
                            {label}
                          </NativeSelectOption>
                        ),
                      )}
                    </NativeSelect>
                  </div>
                  <div className="space-y-2">
                    <Label>Recebedor</Label>
                    <div className="flex min-h-10 items-center rounded-md bg-muted/40 px-3 text-sm font-medium">
                      {order.customerName}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Documento do recebedor</Label>
                    <Input
                      value={deliveredToDocument}
                      onChange={(event) =>
                        setDeliveredToDocument(event.target.value)
                      }
                      placeholder="CPF, RG ou documento interno"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="space-y-2">
                    <Label>Observações da entrega</Label>
                    <Textarea
                      className="min-h-24 resize-y"
                      value={deliveryNotes}
                      onChange={(event) => setDeliveryNotes(event.target.value)}
                      placeholder="Conferência, acessórios devolvidos ou observações do cliente."
                    />
                  </div>
                  <div className="rounded-lg bg-muted/40 p-4 text-sm">
                    <p className="text-muted-foreground">Status da entrega</p>
                    <p className="mt-1 font-medium">
                      {order.deliveredAt
                        ? `Entregue em ${formatDateTime(order.deliveredAt)}`
                        : 'Ainda não entregue'}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 rounded-lg bg-muted/40 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <Label>Nº do selo de reparado Inmetro</Label>
                    <Input
                      className="tabular-nums"
                      value={repairSealNumber}
                      onChange={(event) =>
                        setRepairSealNumber(event.target.value)
                      }
                      placeholder="Número digitado que irá na via do cliente"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Status do selo físico</Label>
                    <div className="flex min-h-10 items-center rounded-md bg-background px-3 text-sm shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]">
                      {repairSealApplied
                        ? 'Aplicado na via do laboratório'
                        : 'Pendente de aplicação física'}
                    </div>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Observações do selo</Label>
                    <Input
                      value={repairSealNotes}
                      onChange={(event) =>
                        setRepairSealNotes(event.target.value)
                      }
                      placeholder="Ex.: selo físico será colado na via do laboratório após conferência."
                    />
                  </div>
                  <label className="flex min-h-10 items-center gap-3 text-sm">
                    <Checkbox
                      checked={repairSealApplied}
                      onCheckedChange={(checked) =>
                        setRepairSealApplied(Boolean(checked))
                      }
                    />
                    Selo físico aplicado
                  </label>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="outline"
                      className="active:scale-[0.96] transition-transform"
                      onClick={() => updateRepairSeal.mutate()}
                      disabled={isDesktop || updateRepairSeal.isPending}
                    >
                      Salvar selo
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    className="active:scale-[0.96] transition-transform"
                    onClick={() => deliverOrder.mutate()}
                    disabled={isDesktop || deliverOrder.isPending}
                  >
                    Registrar entrega
                  </Button>
                  <Button
                    className="active:scale-[0.96] transition-transform"
                    onClick={() => issueDeliveryDocument.mutate()}
                    disabled={issueDeliveryDocument.isPending}
                  >
                    <HugeiconsIcon icon={File02Icon} className="mr-2 size-4" />
                    Gerar comprovante de entrega
                  </Button>
                  <Button
                    variant="outline"
                    className="active:scale-[0.96] transition-transform"
                    onClick={() => openDeliveryDocument.mutate()}
                    disabled={isDesktop || openDeliveryDocument.isPending}
                  >
                    Abrir comprovante
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
            </CardHeader>
            <CardContent>
              <EventTimeline
                items={buildServiceOrderTimelineItems(order.events)}
                emptyMessage="Nenhum evento registrado para esta OS"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
