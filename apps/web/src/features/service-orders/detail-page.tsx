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
  Tick02Icon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import {
  getServiceOrderDeliveryDocumentUrl,
  getServiceOrderIntakeDocumentUrl,
  getServiceOrderTagDocumentUrl,
  useServiceOrderCommunicationsData,
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
  buildServiceOrderStageAffordances,
  buildServiceOrderWorkflowStages,
  isServiceOrderLifecycleError,
  COMMUNICATION_STATUS_LABELS,
  communicationEventLabel,
  communicationStatusBadgeVariant,
  createEmptyQuoteItem,
  DELIVERY_METHOD_LABELS,
  EXECUTION_RESULT_LABELS,
  formatDateTime,
  getPublicUrl,
  ITEM_TYPE_LABELS,
  materialToQuoteItemPatch,
  money,
  QUOTE_STATUS_LABELS,
  quoteDraftItemFromApiItem,
  quoteItemLineTotal,
  quoteItemsTotal,
  quoteItemTypeChangePatch,
  RECOMMENDED_ACTION_LABELS,
  STAGE_LOCKED_REASONS,
  serviceOrderActionErrorMessage,
  serviceOrderFinancialStatusSummary,
  toApiItems,
  WORKFLOW_TABS,
  type MaterialOption,
  type QuoteDraftItem,
} from '@/features/service-orders/detail-model'
import {
  isServiceStartDirty,
  serviceStartDraftFromIso,
  serviceStartDraftToIso,
  serviceOrderCloudCommandTarget,
  type ServiceStartDraft,
} from '@/features/service-orders/forms'
import { QuoteItemMaterialPicker } from '@/features/service-orders/components/quote-item-material-picker'
import { EvaluationRevisionDialog } from '@/features/service-orders/components/evaluation-revision-dialog'
import {
  StageLocked,
  StageRecordAction,
  StageRecordField,
  StageRecordGrid,
  StageRecordStrip,
} from '@/features/service-orders/components/stage-state'
import { DatePicker } from '@/components/ui/date-picker'
import { EventTimeline } from '@/components/event-timeline'
import { cn } from '@/lib/utils'
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
import {
  ActionAvailabilityGate,
  OperationUnavailableNotice,
} from '@/components/availability/action-availability-gate'
import { useOperationAvailability } from '@/runtime/use-operation-availability'
import {
  describeReconcileLag,
  reconcileAfterCloudCommand,
} from '@/runtime/reconcile-cloud-command'
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
  /** Opaque id from the URL. Never the serial. */
  publicId: string
  conflictReturn: SyncConflictReturnSearch
}

type WorkflowTabValue = (typeof WORKFLOW_TABS)[number]['value']
type DeliveryMethod = keyof typeof DELIVERY_METHOD_LABELS
// Shared column template for the quote editor: the header row and every item
// row use it so the labels above line up with the fields below. Collapses to a
// stacked single column below `lg`, where seven columns stop fitting.
const QUOTE_ROW_GRID =
  'lg:grid-cols-[136px_minmax(0,1fr)_84px_72px_140px_112px_40px]'

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

  const detail = mainBlocker?.label ?? status.description
  // The badge already says it; repeating the same words underneath was how
  // "Pronto para faturar / Pronto para faturar" happened.
  const showDetail = Boolean(detail) && detail !== status.label
  const evidence = summary.evidenceReconnectPath ? (
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
  )

  // With nothing to put in the metrics grid — an order merely ready to be
  // billed has no document yet — a full card is a lot of chrome around one
  // badge, and the header's bottom border framed an empty strip. Collapse to a
  // single compact row and keep the card for when there are actually figures.
  if (!shouldShowMetrics) {
    return (
      <Card size="sm" aria-live="polite">
        <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="text-sm font-semibold leading-none tracking-tight">
            Status financeiro
          </h3>
          <Badge variant={summary.badgeVariant}>{status.label}</Badge>
          {showDetail ? (
            <p className="min-w-0 text-pretty text-sm text-muted-foreground">
              {detail}
            </p>
          ) : null}
          <div className="ms-auto text-xs text-muted-foreground">
            {evidence}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold leading-none tracking-tight">
              Status financeiro
              <Badge variant={summary.badgeVariant}>{status.label}</Badge>
            </h3>
            {showDetail ? (
              <CardDescription className="text-pretty">
                {detail}
              </CardDescription>
            ) : null}
          </div>
          <div className="text-left text-xs text-muted-foreground sm:text-right">
            {evidence}
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

// #343 — per-OS customer notification log. Answers "we told customer X on
// date Y via channel Z" from the email ledger/outbox; printable via the
// browser as the dispute-proof trail.
export function ServiceOrderCommunicationsBlock({ id }: { id: string }) {
  // The ledger lives in the cloud, so this is unavailable when the cloud is —
  // not when the app happens to be Electron. A connected desktop reads it.
  const availability = useOperationAvailability(
    'serviceOrders',
    'listCommunications',
  )
  const communicationsQuery = useServiceOrderCommunicationsData({
    enabled: availability.available,
    id,
  })
  const entries = communicationsQuery.data?.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comunicações</CardTitle>
        <CardDescription>
          Notificações enviadas ao cliente para esta OS
        </CardDescription>
      </CardHeader>
      <CardContent aria-live="polite">
        {!availability.available ? (
          <OperationUnavailableNotice availability={availability} />
        ) : communicationsQuery.isPending ? (
          <div className="space-y-3">
            <span className="sr-only">Carregando comunicações...</span>
            <div className="h-4 w-48 rounded bg-muted" />
            <div className="h-4 w-36 rounded bg-muted/70" />
          </div>
        ) : communicationsQuery.isError ? (
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            <span>Comunicações indisponíveis no momento.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => communicationsQuery.refetch()}
            >
              Tentar novamente
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma comunicação registrada para esta OS
          </p>
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li
                key={entry.eventKey}
                className="border-b border-border/70 pb-3 last:border-0 last:pb-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">
                    {communicationEventLabel(entry.eventKey)}
                  </span>
                  <Badge
                    variant={communicationStatusBadgeVariant(entry.status)}
                  >
                    {COMMUNICATION_STATUS_LABELS[entry.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(entry.sentAt ?? entry.queuedAt)} · E-mail
                  {entry.recipientEmail ? <> · {entry.recipientEmail}</> : null}
                </p>
                {entry.recipientSuppressed ? (
                  <p className="mt-1 text-xs text-destructive">
                    Endereço com falha de entrega registrada (devolução ou
                    reclamação de spam)
                  </p>
                ) : null}
                {entry.status === 'retrying' || entry.status === 'failed' ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Tentativas de envio: {entry.attempts}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function ServiceOrderDetailPage({
  publicId,
  conflictReturn,
}: ServiceOrderDetailPageProps) {
  const orderQuery = useServiceOrderDetailData(publicId)
  const accessQuery = usePlanAccess()
  const hasFinancial =
    accessQuery.data?.entitlements.includes('financial') ?? false
  // Everything below the detail read still addresses the OS by its numeric id,
  // which only exists once the detail has loaded.
  const numericId = orderQuery.data ? String(orderQuery.data.id) : null
  const financialStatusQuery = useServiceOrderFinancialStatusData({
    enabled: hasFinancial && numericId !== null,
    id: numericId ?? '',
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
      id={String(orderQuery.data.id)}
      publicId={publicId}
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
  publicId,
  conflictReturn,
}: {
  /** Numeric id — every mutation endpoint takes this. */
  id: string
  /** Opaque id — used for the detail query key the mutations invalidate. */
  publicId: string
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
  /**
   * PAR-06. Every one of these was disabled by a bare `isDesktopRuntime()`,
   * which took an entire end-to-end workflow away from a connected desktop:
   * intake documents, tags, service start, evaluation, quote sending, the
   * Marca de Reparo, delivery and the delivery receipt.
   *
   * The real blockers are connectivity and this order's own sync state — an
   * order created offline has no cloud identity, and one with queued local
   * edits would have the command decided against a stale server snapshot.
   */
  const orderTarget = serviceOrderCloudCommandTarget(order)
  /**
   * For fetching a document that already exists. Still requires the order to
   * have a cloud identity — there is nothing to fetch for one the server has
   * never seen — but not a drained outbox, since a GET decides nothing.
   */
  const documentReadTarget = { synced: orderTarget.synced }
  const evaluationAvailability = useOperationAvailability(
    'serviceOrders',
    'saveEvaluation',
    orderTarget,
  )
  const serviceStartAvailability = useOperationAvailability(
    'serviceOrders',
    'update',
    orderTarget,
  )
  const sendQuoteAvailability = useOperationAvailability(
    'serviceOrders',
    'sendQuote',
    orderTarget,
  )
  const generateIntakeAvailability = useOperationAvailability(
    'serviceOrders',
    'generateIntakeDocument',
    orderTarget,
  )
  // Reads of an already-generated document, not state transitions: they need
  // a cloud identity and a connection, but not a clean outbox. Passing
  // `orderTarget` would withhold an existing receipt because of an unrelated
  // queued edit.
  const openIntakeAvailability = useOperationAvailability(
    'serviceOrders',
    'getIntakeDocumentPdf',
    documentReadTarget,
  )
  const generateTagAvailability = useOperationAvailability(
    'serviceOrders',
    'generateTag',
    orderTarget,
  )
  const openTagAvailability = useOperationAvailability(
    'serviceOrders',
    'getTagPdf',
    documentReadTarget,
  )
  const repairMarkAvailability = useOperationAvailability(
    'serviceOrders',
    'updateRepairMark',
    orderTarget,
  )
  const deliverAvailability = useOperationAvailability(
    'serviceOrders',
    'deliver',
    orderTarget,
  )
  const openDeliveryDocumentAvailability = useOperationAvailability(
    'serviceOrders',
    'getDeliveryDocumentPdf',
    documentReadTarget,
  )
  // The parts catalog is a cloud read and does not depend on this order at
  // all; offline the quote keeps its free-form part fallback.
  const materialCatalogAvailability = useOperationAvailability(
    'materials',
    'list',
  )

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
  const [repairMarkNumber, setRepairMarkNumber] = useState(
    order.inmetroRepairMarkNumber ?? '',
  )
  const [repairMarkNotes, setRepairMarkNotes] = useState(
    order.inmetroRepairMarkNotes ?? '',
  )
  const [repairMarkApplied, setRepairMarkApplied] = useState(
    Boolean(order.inmetroRepairMarkAppliedAt),
  )
  const [serviceStart, setServiceStart] = useState<ServiceStartDraft>(() =>
    serviceStartDraftFromIso(order.serviceStartedAt),
  )
  const serviceStartDirty = isServiceStartDirty(
    serviceStart,
    order.serviceStartedAt,
  )
  // The repair seal (Marca de Reparo) + marca de selagem only apply to instruments
  // subject to legal metrology. Show the editor only for those; for others,
  // surface any already-recorded value read-only so history never disappears.
  const isSubjectToLegalMetrology = order.assetMetrologyRegime === 'LEGAL'
  const hasRepairMarkRecord = Boolean(
    order.inmetroRepairMarkNumber ||
    order.inmetroRepairMarkNotes ||
    order.inmetroRepairMarkAppliedAt,
  )
  const [activeTab, setActiveTab] =
    useState<(typeof WORKFLOW_TABS)[number]['value']>('evaluation')
  const quoteTotal = useMemo(() => quoteItemsTotal(quoteItems), [quoteItems])
  const workflowStages = useMemo(
    () => buildServiceOrderWorkflowStages(order),
    [order],
  )
  const stageAffordances = useMemo(
    () => buildServiceOrderStageAffordances(order),
    [order],
  )
  // A closed evaluation shows its record; "Revisar avaliação" opens the form
  // again. The mandatory motivo and the matching server-side lock land with the
  // revision flow — until then this is presentation only.
  const [revisingEvaluation, setRevisingEvaluation] = useState(false)
  const [evaluationRevisionOpen, setEvaluationRevisionOpen] = useState(false)
  const evaluationIsRecord =
    stageAffordances.evaluation !== 'editable' && !revisingEvaluation
  // Once locked, saving goes through the dialog so the motivo is captured
  // before the request — the API refuses a locked revision without one.
  const evaluationNeedsRevisionReason =
    stageAffordances.evaluation === 'record-revisable'
  // Same shape for the quote: a decided quote is a record until the operator
  // asks for a new version. Creating one is already a first-class concept here
  // (each save is a new version), so this only changes what is offered first.
  const [revisingQuote, setRevisingQuote] = useState(false)
  const quoteIsRecord =
    stageAffordances.quote !== 'editable' &&
    stageAffordances.quote !== 'locked' &&
    !revisingQuote

  /**
   * A new version starts as a copy of the one it replaces, never blank.
   * `totalApprovedCents` on the order is REPLACED by whichever quote is
   * approved last, so a version listing only the newly-found part would quietly
   * reduce the approved total to that part. Prefilling keeps a revision a full
   * re-quote by default.
   */
  function startQuoteRevision() {
    if (latestQuote?.items.length) {
      setQuoteItems(latestQuote.items.map(quoteDraftItemFromApiItem))
      setDeliveryEstimate(latestQuote.deliveryEstimate ?? '')
      setPaymentTerms(latestQuote.paymentTerms ?? '')
    }
    setRevisingQuote(true)
  }
  const returnToSyncConflicts = () => {
    if (shouldReturnToSyncConflicts(conflictReturn)) {
      navigate({ to: '/dashboard/sync/conflicts' })
    }
  }

  /**
   * Single error path for every action on this page. The API refuses actions the
   * order's status doesn't allow; when that happens the page is usually showing
   * a stale status, so the detail query is refetched as well as toasted — the
   * view corrects itself instead of leaving the operator to guess.
   */
  const reportActionError = (error: unknown, fallback: string) => {
    toast.error(serviceOrderActionErrorMessage(error, fallback))
    if (isServiceOrderLifecycleError(error)) {
      queryClient.invalidateQueries({ queryKey: ['service-order', publicId] })
    }
  }

  /**
   * Single success path for the *cloud* commands on this page. The order is
   * read local-first on desktop, so plain invalidation would re-read the
   * pre-command row from SQLite and the status would appear not to have moved.
   * Reconcile first; if the cache is still catching up, say so instead of
   * implying the command failed.
   */
  const settleCloudCommand = async (message: string) => {
    const result = await reconcileAfterCloudCommand(queryClient, [
      ['service-order', publicId],
      ['service-orders'],
    ])
    const lag = describeReconcileLag(result)

    toast.success(message, lag ? { description: lag } : undefined)
  }

  const saveEvaluation = useMutation({
    mutationFn: async (revisionReason?: string) => {
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
          ...(revisionReason ? { revisionReason } : {}),
        },
      )
    },
    onSuccess: async () => {
      setRevisingEvaluation(false)
      setEvaluationRevisionOpen(false)
      await settleCloudCommand(
        latestEvaluation ? 'Avaliação atualizada' : 'Avaliação registrada',
      )
      returnToSyncConflicts()
    },
    onError: (error) => {
      reportActionError(error, 'Erro ao salvar avaliação')
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
      queryClient.invalidateQueries({ queryKey: ['service-order', publicId] })
      returnToSyncConflicts()
    },
    onError: (error) => {
      reportActionError(error, 'Erro ao salvar orçamento')
    },
  })

  const sendQuote = useMutation({
    mutationFn: async (quoteId: number) => {
      return calibraApi.serviceOrders.sendQuote(id, quoteId, {
        clientMessage: quoteClientMessage || null,
      })
    },
    onSuccess: async (result) => {
      const publicUrl = getPublicUrl(result)
      if (publicUrl) {
        navigator.clipboard?.writeText(publicUrl)
      }
      await settleCloudCommand('Orçamento emitido para aprovação')
    },
    onError: (error) => {
      reportActionError(error, 'Erro ao emitir orçamento')
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
      queryClient.invalidateQueries({ queryKey: ['service-order', publicId] })
      returnToSyncConflicts()
    },
    // Starting before the quote is approved is refused by the API; without this
    // the button simply did nothing.
    onError: (error) => {
      reportActionError(error, 'Não foi possível iniciar a execução')
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
          // Carry the catalog reference from the approved quote through to the
          // execution items so it round-trips on save.
          materialId: item.materialId ?? null,
        })),
      })
    },
    onSuccess: () => {
      toast.success('Execução finalizada')
      queryClient.invalidateQueries({ queryKey: ['service-order', publicId] })
      returnToSyncConflicts()
    },
    onError: (error) => {
      reportActionError(error, 'Erro ao finalizar execução')
    },
  })

  const generateIntakeDocument = useMutation({
    mutationFn: () => calibraApi.serviceOrders.generateIntakeDocument(id),
    onSuccess: async () => {
      await settleCloudCommand('Comprovante enviado para geração')
    },
    onError: (error) => {
      reportActionError(error, 'Não foi possível gerar o comprovante')
    },
  })

  const openIntakeDocument = useMutation({
    mutationFn: async () => {
      const url = await getServiceOrderIntakeDocumentUrl(id)
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    onError: (error) => {
      reportActionError(error, 'Não foi possível abrir o comprovante')
    },
  })

  const generateTag = useMutation({
    mutationFn: () => calibraApi.serviceOrders.generateTag(id),
    onSuccess: async () => {
      await settleCloudCommand('Etiqueta enviada para geração')
    },
    onError: (error) => {
      reportActionError(error, 'Não foi possível gerar a etiqueta')
    },
  })

  const openTag = useMutation({
    mutationFn: async () => {
      const url = await getServiceOrderTagDocumentUrl(id)
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    onError: (error) => {
      reportActionError(error, 'Não foi possível abrir a etiqueta')
    },
  })

  const updateRepairMark = useMutation({
    mutationFn: async () => {
      await calibraApi.serviceOrders.updateRepairMark(id, {
        inmetroRepairMarkNumber: repairMarkNumber || null,
        inmetroRepairMarkIssuedAt: repairMarkNumber
          ? new Date().toISOString()
          : null,
        inmetroRepairMarkAppliedAt: repairMarkApplied
          ? new Date().toISOString()
          : null,
        inmetroRepairMarkNotes: repairMarkNotes || null,
      })
    },
    onSuccess: async () => {
      await settleCloudCommand('Marca de Reparo atualizada')
      returnToSyncConflicts()
    },
    onError: (error) => {
      reportActionError(error, 'Erro ao salvar a Marca de Reparo')
    },
  })

  const updateServiceStart = useMutation({
    mutationFn: async () => {
      await calibraApi.serviceOrders.update(id, {
        serviceStartedAt: serviceStartDraftToIso(serviceStart),
      })
    },
    onSuccess: async () => {
      await settleCloudCommand('Início da avaliação atualizado')
      returnToSyncConflicts()
    },
    onError: (error) => {
      reportActionError(error, 'Erro ao salvar o início da avaliação')
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
        inmetroRepairMarkNumber: repairMarkNumber || null,
      })
    },
    onSuccess: async () => {
      await settleCloudCommand('Entrega registrada')
      returnToSyncConflicts()
    },
    onError: (error) => {
      reportActionError(error, 'Erro ao registrar entrega')
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
      queryClient.invalidateQueries({ queryKey: ['service-order', publicId] })
    },
    onError: (error) => {
      reportActionError(error, 'Erro ao gerar comprovante de entrega')
    },
  })

  const openDeliveryDocument = useMutation({
    mutationFn: async () => {
      const url = await getServiceOrderDeliveryDocumentUrl(id)
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    onError: (error) => {
      reportActionError(
        error,
        'Não foi possível abrir o comprovante de entrega',
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

  function changeQuoteItemType(itemId: string, type: QuoteDraftItem['type']) {
    updateQuoteItem(itemId, quoteItemTypeChangePatch(type))
  }

  function selectQuoteItemMaterial(itemId: string, material: MaterialOption) {
    updateQuoteItem(itemId, materialToQuoteItemPatch(material))
  }

  function clearQuoteItemMaterial(itemId: string) {
    // Keep the typed description; only the catalog binding is reset.
    updateQuoteItem(itemId, { materialId: null })
  }

  const execution = order.execution

  return (
    <div className="space-y-6">
      <SyncConflictReturnNotice search={conflictReturn} />
      <EvaluationRevisionDialog
        open={evaluationRevisionOpen}
        onOpenChange={setEvaluationRevisionOpen}
        pending={saveEvaluation.isPending}
        onConfirm={(reason) => saveEvaluation.mutate(reason)}
      />
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
                {order.isExternalService ? (
                  <Badge variant="secondary">
                    Atendimento externo (in loco)
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 text-pretty text-sm text-muted-foreground">
                {order.customerName} · {order.assetName}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {execution?.calibrationRequiredAfterRepair && (
                // DOM-02 (#655) — REQ-DOM-REP-001/002: this repair OS needs a
                // calibration afterward. Open it pre-filled with the OS's
                // customer + asset (and record the back-link on the job).
                <Button
                  size="sm"
                  className={ACTION_BUTTON_CLASS}
                  onClick={() =>
                    navigate({
                      to: '/dashboard/jobs/new',
                      search: {
                        customerId: order.customerId,
                        assetId: order.assetId,
                        serviceOrderId: order.id,
                      },
                    })
                  }
                >
                  <HugeiconsIcon icon={Wrench01Icon} className="mr-2 size-4" />
                  Abrir calibração
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className={ACTION_BUTTON_CLASS}
                onClick={() => openServiceOrderIntakePreview(order)}
              >
                <HugeiconsIcon icon={File02Icon} className="mr-2 size-4" />
                Pré-visualizar
              </Button>
              <ActionAvailabilityGate availability={generateIntakeAvailability}>
                {({ disabled }) => (
                  <Button
                    variant="outline"
                    size="sm"
                    className={ACTION_BUTTON_CLASS}
                    onClick={() => generateIntakeDocument.mutate()}
                    disabled={disabled || generateIntakeDocument.isPending}
                  >
                    Gerar comprovante
                  </Button>
                )}
              </ActionAvailabilityGate>
              <ActionAvailabilityGate availability={openIntakeAvailability}>
                {({ disabled }) => (
                  <Button
                    variant="outline"
                    size="sm"
                    className={ACTION_BUTTON_CLASS}
                    onClick={() => openIntakeDocument.mutate()}
                    disabled={disabled || openIntakeDocument.isPending}
                  >
                    Abrir comprovante
                  </Button>
                )}
              </ActionAvailabilityGate>
              <ActionAvailabilityGate availability={generateTagAvailability}>
                {({ disabled }) => (
                  <Button
                    variant="outline"
                    size="sm"
                    className={ACTION_BUTTON_CLASS}
                    onClick={() => generateTag.mutate()}
                    disabled={disabled || generateTag.isPending}
                  >
                    Gerar etiqueta
                  </Button>
                )}
              </ActionAvailabilityGate>
              <ActionAvailabilityGate availability={openTagAvailability}>
                {({ disabled }) => (
                  <Button
                    variant="outline"
                    size="sm"
                    className={ACTION_BUTTON_CLASS}
                    onClick={() => openTag.mutate()}
                    disabled={disabled || openTag.isPending}
                  >
                    Abrir etiqueta
                  </Button>
                )}
              </ActionAvailabilityGate>
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
          {/* The four tabs are workflow stages, so each trigger carries its own
              state (done / current / pending) and a one-line status. Wrapping to
              2×2 keeps every stage visible on narrow viewports instead of
              hiding half of them behind a horizontal scroll. */}
          <TabsList className="grid w-full grid-cols-2 gap-1 rounded-xl bg-muted/40 p-1 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] group-data-[orientation=horizontal]/tabs:h-auto sm:grid-cols-4 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
            {workflowStages.map((stage, index) => (
              <TabsTrigger
                key={stage.value}
                value={stage.value}
                className="flex h-auto min-h-14 flex-col items-start justify-center gap-1 whitespace-normal rounded-lg px-2.5 py-2 text-start transition-transform active:scale-[0.96]"
              >
                <span className="flex w-full items-center gap-2">
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                      stage.state === 'done' &&
                        'bg-primary/12 text-primary ring-1 ring-inset ring-primary/25',
                      stage.state === 'current' &&
                        'bg-primary text-primary-foreground',
                      stage.state === 'pending' &&
                        'bg-foreground/8 text-muted-foreground',
                    )}
                  >
                    {stage.state === 'done' ? (
                      <HugeiconsIcon icon={Tick02Icon} className="size-3" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="truncate text-sm font-medium">
                    {stage.label}
                  </span>
                </span>
                <span className="w-full truncate ps-7 text-xs text-muted-foreground">
                  {stage.hint}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

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
                {evaluationIsRecord ? (
                  <>
                    <StageRecordStrip
                      summary={`Avaliação registrada em ${formatDateTime(
                        latestEvaluation?.evaluatedAt,
                      )}. O orçamento enviado ao cliente se baseia nela.`}
                      action={
                        stageAffordances.evaluation === 'record-revisable' ? (
                          <StageRecordAction
                            onClick={() => setRevisingEvaluation(true)}
                          >
                            Revisar avaliação
                          </StageRecordAction>
                        ) : null
                      }
                    />
                    <StageRecordGrid>
                      <StageRecordField label="Diagnóstico">
                        {latestEvaluation?.diagnosis || '—'}
                      </StageRecordField>
                      <StageRecordField label="Ação recomendada">
                        {latestEvaluation
                          ? (RECOMMENDED_ACTION_LABELS[
                              latestEvaluation.recommendedAction
                            ] ?? latestEvaluation.recommendedAction)
                          : '—'}
                      </StageRecordField>
                      <StageRecordField label="Problemas detectados">
                        {latestEvaluation?.detectedIssues || '—'}
                      </StageRecordField>
                      <StageRecordField label="Observação para o cliente">
                        {latestEvaluation?.clientVisibleNotes || '—'}
                      </StageRecordField>
                    </StageRecordGrid>
                  </>
                ) : null}
                {evaluationIsRecord ? null : (
                  <>
                    {/* The stored timestamp (serviceOrder.serviceStartedAt) lives
                    here rather than in the header: inside "Avaliação técnica",
                    "Início da avaliação" needs no prose to tell it apart from
                    the Execução tab's own start. */}
                    {/* items-start, not items-end: the fields must line up on
                    their labels, and neither may move when its neighbour
                    changes height. The save button opts into the bottom edge
                    with self-end so it sits on the control row. */}
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="w-[220px] space-y-2">
                        <Label htmlFor="service-start-date">
                          Início da avaliação
                        </Label>
                        <DatePicker
                          id="service-start-date"
                          value={serviceStart.date}
                          onChange={(date) =>
                            setServiceStart((draft) => ({ ...draft, date }))
                          }
                          placeholder="Selecione a data"
                          className="w-full"
                        />
                      </div>
                      <div className="w-28 space-y-2">
                        <Label htmlFor="service-start-time">Hora</Label>
                        <Input
                          type="time"
                          id="service-start-time"
                          value={serviceStart.time}
                          onChange={(event) =>
                            setServiceStart((draft) => ({
                              ...draft,
                              time: event.target.value,
                            }))
                          }
                          className="bg-background tabular-nums appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                        />
                      </div>
                      {/* Its own endpoint, so its own save — shown only once the
                      value actually differs from what is stored. */}
                      {serviceStartDirty ? (
                        <ActionAvailabilityGate
                          availability={serviceStartAvailability}
                          className="self-end"
                        >
                          {({ disabled }) => (
                            <Button
                              variant="outline"
                              className="self-end transition-transform active:scale-[0.96]"
                              onClick={() => updateServiceStart.mutate()}
                              disabled={
                                disabled || updateServiceStart.isPending
                              }
                            >
                              Salvar início
                            </Button>
                          )}
                        </ActionAvailabilityGate>
                      ) : null}
                    </div>
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
                    <div className="flex flex-wrap justify-end gap-2">
                      {revisingEvaluation ? (
                        <Button
                          variant="outline"
                          className="transition-transform active:scale-[0.96]"
                          onClick={() => setRevisingEvaluation(false)}
                          disabled={saveEvaluation.isPending}
                        >
                          Cancelar revisão
                        </Button>
                      ) : null}
                      <ActionAvailabilityGate
                        availability={evaluationAvailability}
                      >
                        {({ disabled }) => (
                          <Button
                            className="active:scale-[0.96] transition-transform"
                            onClick={() => {
                              if (evaluationNeedsRevisionReason) {
                                setEvaluationRevisionOpen(true)
                                return
                              }
                              saveEvaluation.mutate(undefined)
                            }}
                            disabled={disabled || saveEvaluation.isPending}
                          >
                            <HugeiconsIcon
                              icon={CheckmarkCircle02Icon}
                              className="mr-2 size-4"
                            />
                            {evaluationNeedsRevisionReason
                              ? 'Salvar revisão'
                              : latestEvaluation
                                ? 'Salvar avaliação'
                                : 'Registrar avaliação'}
                          </Button>
                        )}
                      </ActionAvailabilityGate>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="quote" className="mt-0 space-y-6">
            {stageAffordances.quote === 'locked' ? (
              <Card>
                <CardContent className="pt-6">
                  <StageLocked {...STAGE_LOCKED_REASONS.quote} />
                </CardContent>
              </Card>
            ) : quoteIsRecord ? (
              <Card>
                <CardHeader>
                  <CardTitle>Orçamento</CardTitle>
                  <CardDescription>
                    O orçamento desta OS já foi decidido pelo cliente.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <StageRecordStrip
                    summary={
                      latestQuote
                        ? `Orçamento v${latestQuote.version} ${
                            QUOTE_STATUS_LABELS[latestQuote.status] ??
                            latestQuote.status
                          } · ${money(latestQuote.totalCents)}`
                        : 'Orçamento decidido.'
                    }
                    action={
                      stageAffordances.quote === 'record-revisable' ? (
                        <StageRecordAction onClick={startQuoteRevision}>
                          Nova versão do orçamento
                        </StageRecordAction>
                      ) : null
                    }
                  />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Novo orçamento</CardTitle>
                  <CardDescription>
                    Monte serviços, peças e prazo no mesmo formato usado pelo
                    PDF.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Column headers are rendered once on wide viewports; each row
                      keeps its own labels for screen readers and for the stacked
                      layout below the breakpoint. */}
                  <div className="space-y-2">
                    <div
                      className={cn(
                        'hidden gap-3 px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground',
                        QUOTE_ROW_GRID,
                        'lg:grid',
                      )}
                    >
                      <span>Tipo</span>
                      <span>Descrição</span>
                      <span className="text-end">Qtd.</span>
                      <span>Un.</span>
                      <span className="text-end">Valor unit.</span>
                      <span className="text-end">Total</span>
                      <span className="sr-only">Ações</span>
                    </div>
                    {quoteItems.map((item, index) => {
                      const lineTotal = quoteItemLineTotal(item)
                      return (
                        <div
                          key={item.id}
                          className={cn(
                            'grid gap-3 rounded-lg bg-muted/40 p-3 lg:items-start',
                            QUOTE_ROW_GRID,
                          )}
                        >
                          <div className="space-y-2">
                            <Label className="lg:sr-only">Tipo</Label>
                            <NativeSelect
                              className="w-full"
                              value={item.type}
                              onChange={(event) =>
                                changeQuoteItemType(
                                  item.id,
                                  toServiceOrderItemType(event.target.value),
                                )
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
                            <Label className="lg:sr-only">Descrição</Label>
                            {item.type === 'part' ? (
                              <div className="space-y-1">
                                <QuoteItemMaterialPicker
                                  materialId={item.materialId ?? null}
                                  disabled={
                                    !materialCatalogAvailability.available
                                  }
                                  onSelectMaterial={(material) =>
                                    selectQuoteItemMaterial(item.id, material)
                                  }
                                  onClearMaterial={() =>
                                    clearQuoteItemMaterial(item.id)
                                  }
                                />
                                <p className="text-xs text-muted-foreground">
                                  Buscar no catálogo preenche descrição, unidade
                                  e valor — ou escreva livremente abaixo.
                                </p>
                              </div>
                            ) : null}
                            <Input
                              value={item.description}
                              onChange={(event) =>
                                updateQuoteItem(item.id, {
                                  description: event.target.value,
                                })
                              }
                              placeholder={
                                item.type === 'part'
                                  ? 'Peça utilizada'
                                  : index === 0
                                    ? 'Serviço executado'
                                    : 'Descrição do item'
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="lg:sr-only">Qtd.</Label>
                            <Input
                              className="text-end tabular-nums"
                              inputMode="decimal"
                              value={item.quantity}
                              onChange={(event) =>
                                updateQuoteItem(item.id, {
                                  quantity: event.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="lg:sr-only">Un.</Label>
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
                            <Label className="lg:sr-only">Valor unit.</Label>
                            <div className="relative">
                              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm font-medium text-muted-foreground">
                                R$
                              </span>
                              <Input
                                className="ps-9 text-end tabular-nums"
                                inputMode="decimal"
                                value={item.unitPrice}
                                onChange={(event) =>
                                  updateQuoteItem(item.id, {
                                    unitPrice: event.target.value,
                                  })
                                }
                                placeholder="0,00"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label className="lg:sr-only">Total</Label>
                            <p className="flex min-h-9 items-center text-sm font-medium tabular-nums lg:justify-end">
                              {lineTotal === null ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                money(lineTotal)
                              )}
                            </p>
                          </div>
                          <div className="flex justify-end lg:pt-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground transition-[color,transform] hover:text-destructive active:scale-[0.96]"
                              onClick={() => removeQuoteItem(item.id)}
                              disabled={quoteItems.length === 1}
                              aria-label={`Remover item ${index + 1}`}
                            >
                              <HugeiconsIcon
                                icon={Delete02Icon}
                                className="size-4"
                              />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
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
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm text-muted-foreground">
                        Total previsto
                      </span>
                      <span className="text-lg font-semibold tabular-nums">
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
                        onChange={(event) =>
                          setPaymentTerms(event.target.value)
                        }
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
                      <ActionAvailabilityGate
                        key={quote.id}
                        availability={sendQuoteAvailability}
                      >
                        {({ disabled }) => (
                          <Button
                            className="active:scale-[0.96] transition-transform"
                            onClick={() => sendQuote.mutate(quote.id)}
                            disabled={disabled || sendQuote.isPending}
                          >
                            <HugeiconsIcon
                              icon={SentIcon}
                              className="mr-2 size-4"
                            />
                            Emitir v{quote.version}
                          </Button>
                        )}
                      </ActionAvailabilityGate>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Orçamentos salvos</CardTitle>
                  {order.quotes.length ? (
                    <Badge variant="outline" className="tabular-nums">
                      {order.quotes.length}
                    </Badge>
                  ) : null}
                </div>
                <CardDescription>
                  Cada emissão gera uma nova versão; a mais recente aparece
                  primeiro.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {order.quotes.length ? (
                  order.quotes.map((quote) => (
                    <div key={quote.id} className="rounded-lg bg-muted/40 p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium tabular-nums">
                            v{quote.version}
                          </p>
                          <Badge
                            variant={
                              quote.status === 'approved'
                                ? 'default'
                                : quote.status === 'rejected'
                                  ? 'destructive'
                                  : 'secondary'
                            }
                          >
                            {QUOTE_STATUS_LABELS[quote.status] ?? quote.status}
                          </Badge>
                        </div>
                        <p className="text-base font-semibold tabular-nums">
                          {money(quote.totalCents)}
                        </p>
                      </div>
                      <div className="mt-3 space-y-1.5">
                        {quote.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-start justify-between gap-3 text-xs"
                          >
                            <span className="text-pretty text-muted-foreground">
                              <span className="text-foreground">
                                {item.description}
                              </span>{' '}
                              · {ITEM_TYPE_LABELS[item.type]} ·{' '}
                              <span className="tabular-nums">
                                {item.quantity} {item.unit}
                              </span>
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {money(item.totalPriceCents)}
                            </span>
                          </div>
                        ))}
                      </div>
                      {quote.deliveryEstimate || quote.paymentTerms ? (
                        <p className="mt-3 text-pretty text-xs text-muted-foreground">
                          {[
                            quote.deliveryEstimate
                              ? `Prazo: ${quote.deliveryEstimate}`
                              : null,
                            quote.paymentTerms
                              ? `Pagamento: ${quote.paymentTerms}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
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
                {stageAffordances.execution === 'locked' ? (
                  <StageLocked {...STAGE_LOCKED_REASONS.execution} />
                ) : (
                  <>
                    {execution ? (
                      <div className="rounded-lg bg-muted/40 p-4 text-sm">
                        <div className="grid gap-3 md:grid-cols-3">
                          <div>
                            <p className="text-muted-foreground">
                              Início da execução
                            </p>
                            <p className="tabular-nums">
                              {formatDateTime(execution.startedAt)}
                            </p>
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
                            <p className="text-muted-foreground">
                              Fim da execução
                            </p>
                            <p className="tabular-nums">
                              {formatDateTime(execution.finishedAt)}
                            </p>
                          </div>
                        </div>
                        {order.serviceStartedAt ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            Avaliação iniciada em{' '}
                            {formatDateTime(order.serviceStartedAt)}.
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-4">
                        <p className="text-pretty text-sm text-muted-foreground">
                          Inicie a execução após a aprovação do orçamento. A OS
                          passa para “Em execução” e a data é registrada
                          automaticamente.
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
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="delivery" className="mt-0">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle>Entrega e Marca de Reparo</CardTitle>
                    <CardDescription>
                      Gere as duas vias do comprovante com valores, assinaturas
                      e a Marca de Reparo do Inmetro.
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
                {stageAffordances.delivery === 'locked' ? (
                  <StageLocked {...STAGE_LOCKED_REASONS.delivery} />
                ) : (
                  <>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Forma de entrega</Label>
                        <NativeSelect
                          className="w-full"
                          value={deliveryMethod}
                          onChange={(event) =>
                            setDeliveryMethod(
                              toDeliveryMethod(event.target.value),
                            )
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
                          onChange={(event) =>
                            setDeliveryNotes(event.target.value)
                          }
                          placeholder="Conferência, acessórios devolvidos ou observações do cliente."
                        />
                      </div>
                      <div className="rounded-lg bg-muted/40 p-4 text-sm">
                        <p className="text-muted-foreground">
                          Status da entrega
                        </p>
                        <p className="mt-1 font-medium">
                          {order.deliveredAt
                            ? `Entregue em ${formatDateTime(order.deliveredAt)}`
                            : 'Ainda não entregue'}
                        </p>
                      </div>
                    </div>

                    {isSubjectToLegalMetrology ? (
                      <div className="grid gap-4 rounded-lg bg-muted/40 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <div className="space-y-2 md:col-span-2">
                          <p className="text-sm font-medium">
                            Marca de Reparo (Inmetro)
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label>Nº da Marca de Reparo</Label>
                          <Input
                            className="tabular-nums"
                            value={repairMarkNumber}
                            onChange={(event) =>
                              setRepairMarkNumber(event.target.value)
                            }
                            placeholder="Número digitado que irá na via do cliente"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Status da marca física</Label>
                          <div className="flex min-h-10 items-center rounded-md bg-background px-3 text-sm shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]">
                            {repairMarkApplied
                              ? 'Aposta na via do laboratório'
                              : 'Pendente de aposição física'}
                          </div>
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>Observações da Marca de Reparo</Label>
                          <Input
                            value={repairMarkNotes}
                            onChange={(event) =>
                              setRepairMarkNotes(event.target.value)
                            }
                            placeholder="Ex.: Marca de Reparo será colada na via do laboratório após conferência."
                          />
                        </div>
                        <label className="flex min-h-10 items-center gap-3 text-sm">
                          <Checkbox
                            checked={repairMarkApplied}
                            onCheckedChange={(checked) =>
                              setRepairMarkApplied(Boolean(checked))
                            }
                          />
                          Marca física aposta
                        </label>
                        <div className="flex flex-wrap justify-end gap-2">
                          <ActionAvailabilityGate
                            availability={repairMarkAvailability}
                          >
                            {({ disabled }) => (
                              <Button
                                variant="outline"
                                className="active:scale-[0.96] transition-transform"
                                onClick={() => updateRepairMark.mutate()}
                                disabled={
                                  disabled || updateRepairMark.isPending
                                }
                              >
                                Salvar Marca de Reparo
                              </Button>
                            )}
                          </ActionAvailabilityGate>
                        </div>
                      </div>
                    ) : hasRepairMarkRecord ? (
                      <div className="grid gap-3 rounded-lg bg-muted/40 p-4 text-sm md:grid-cols-2">
                        <div className="space-y-1 md:col-span-2">
                          <p className="font-medium">
                            Marca de Reparo (registro existente)
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Instrumento não está marcado como sujeito a
                            metrologia legal — exibindo apenas o registro já
                            gravado.
                          </p>
                        </div>
                        {order.inmetroRepairMarkNumber ? (
                          <div className="space-y-1">
                            <p className="text-muted-foreground">Nº da marca</p>
                            <p className="font-medium tabular-nums">
                              {order.inmetroRepairMarkNumber}
                            </p>
                          </div>
                        ) : null}
                        {order.inmetroRepairMarkAppliedAt ? (
                          <div className="space-y-1">
                            <p className="text-muted-foreground">
                              Marca física
                            </p>
                            <p className="font-medium">Aposta</p>
                          </div>
                        ) : null}
                        {order.inmetroRepairMarkNotes ? (
                          <div className="space-y-1 md:col-span-2">
                            <p className="text-muted-foreground">Observações</p>
                            <p className="font-medium">
                              {order.inmetroRepairMarkNotes}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap justify-end gap-2">
                      <ActionAvailabilityGate
                        availability={deliverAvailability}
                      >
                        {({ disabled }) => (
                          <Button
                            variant="outline"
                            className="active:scale-[0.96] transition-transform"
                            onClick={() => deliverOrder.mutate()}
                            disabled={disabled || deliverOrder.isPending}
                          >
                            Registrar entrega
                          </Button>
                        )}
                      </ActionAvailabilityGate>
                      <Button
                        className="active:scale-[0.96] transition-transform"
                        onClick={() => issueDeliveryDocument.mutate()}
                        disabled={issueDeliveryDocument.isPending}
                      >
                        <HugeiconsIcon
                          icon={File02Icon}
                          className="mr-2 size-4"
                        />
                        Gerar comprovante de entrega
                      </Button>
                      <ActionAvailabilityGate
                        availability={openDeliveryDocumentAvailability}
                      >
                        {({ disabled }) => (
                          <Button
                            variant="outline"
                            className="active:scale-[0.96] transition-transform"
                            onClick={() => openDeliveryDocument.mutate()}
                            disabled={
                              disabled || openDeliveryDocument.isPending
                            }
                          >
                            Abrir comprovante
                          </Button>
                        )}
                      </ActionAvailabilityGate>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Histórico</CardTitle>
                {order.events.length ? (
                  <Badge variant="outline" className="tabular-nums">
                    {order.events.length}
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {/* Newest first, folded to the last few events: a long-running OS
                  otherwise grows this column far past the workflow it annotates. */}
              <EventTimeline
                items={buildServiceOrderTimelineItems(order.events)}
                emptyMessage="Nenhum evento registrado para esta OS"
                compact
                initialVisibleCount={5}
              />
            </CardContent>
          </Card>

          <ServiceOrderCommunicationsBlock id={id} />
        </div>
      </div>
    </div>
  )
}
