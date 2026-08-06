import { renderToStaticMarkup } from 'react-dom/server'
import {
  CheckmarkCircle02Icon,
  File02Icon,
  Mail01Icon,
  PackageProcessIcon,
  UserCheck01Icon,
  ViewIcon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'

import { ServiceOrderIntakeDocumentHtml } from '@calibra-facil/documents'
import type {
  MaterialsListData,
  ServiceOrderCommunicationStatus,
} from '@calibra-facil/client-runtime'
import type { EventTimelineItem } from '@/components/event-timeline'
import {
  canTransitionServiceOrderStatus,
  isServiceOrderFinalStatus,
  SERVICE_ORDER_EVENT_TYPES,
} from '@calibra-facil/shared'
import type {
  FinancialContinuityStatus,
  ServiceOrderEventType,
  ServiceOrderFinancialStatus,
} from '@calibra-facil/shared'
import type {
  ServiceOrderDetail,
  ServiceOrderExecutionResult,
  ServiceOrderItemType,
  ServiceOrderQuoteItem,
  ServiceOrderRecommendedAction,
} from './types'

export type MaterialOption = MaterialsListData['data'][number]

export type QuoteDraftItem = {
  id: string
  type: ServiceOrderItemType
  description: string
  quantity: string
  unit: string
  unitPrice: string
  // Catalog reference for "part" rows; absent/`null` on free-text items.
  materialId?: number | null
}

export const ITEM_TYPE_LABELS: Record<ServiceOrderItemType, string> = {
  service: 'Serviço',
  part: 'Peça',
  external_service: 'Serviço externo',
  freight: 'Frete',
  discount: 'Desconto',
  evaluation_fee: 'Taxa de avaliação',
  other: 'Outro',
}

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  sent: 'Enviado',
  approved: 'Aprovado',
  rejected: 'Recusado',
  expired: 'Expirado',
  canceled: 'Cancelado',
  superseded: 'Substituído',
}

export const RECOMMENDED_ACTION_LABELS: Record<
  ServiceOrderRecommendedAction,
  string
> = {
  repair: 'Reparo',
  calibration_only: 'Somente calibração',
  return_without_repair: 'Devolver sem reparo',
  condemned: 'Condenado',
  warranty_service: 'Atendimento em garantia',
  external_service_required: 'Serviço externo',
}

export const EXECUTION_RESULT_LABELS: Record<
  ServiceOrderExecutionResult,
  string
> = {
  repaired: 'Reparado',
  not_repaired: 'Não reparado',
  condemned: 'Condenado',
  returned_without_service: 'Devolvido sem serviço',
  sent_to_third_party: 'Enviado a terceiro',
}

export const DELIVERY_METHOD_LABELS = {
  pickup_at_lab: 'Retirada no laboratório',
  ship_to_client: 'Envio ao cliente',
  third_party_pickup: 'Retirada por terceiro',
} as const

export const WORKFLOW_TABS = [
  {
    value: 'evaluation',
    label: 'Avaliação técnica',
    icon: CheckmarkCircle02Icon,
  },
  {
    value: 'quote',
    label: 'Orçamento',
    icon: File02Icon,
  },
  {
    value: 'execution',
    label: 'Execução',
    icon: Wrench01Icon,
  },
  {
    value: 'delivery',
    label: 'Entrega',
    icon: PackageProcessIcon,
  },
] as const

export type WorkflowTabValue = (typeof WORKFLOW_TABS)[number]['value']

export type WorkflowStageState = 'done' | 'current' | 'pending'

export type WorkflowStage = {
  value: WorkflowTabValue
  label: string
  icon: (typeof WORKFLOW_TABS)[number]['icon']
  state: WorkflowStageState
  /** One-line status shown under the stage label ("v2 · Aprovado"). */
  hint: string
}

// Stage completion is derived from the records the stage produces, not from
// `order.status` — status can jump (manual approval, cancelation) while the
// artefacts are what the tab actually edits.
export function buildServiceOrderWorkflowStages(
  order: Pick<
    ServiceOrderDetail,
    'evaluations' | 'quotes' | 'execution' | 'deliveredAt'
  >,
): WorkflowStage[] {
  const [latestEvaluation] = order.evaluations
  const [latestQuote] = order.quotes
  const execution = order.execution

  const done = {
    evaluation: Boolean(latestEvaluation),
    quote: latestQuote?.status === 'approved',
    execution: Boolean(execution?.finishedAt),
    delivery: Boolean(order.deliveredAt),
  }

  const hints: Record<WorkflowTabValue, string> = {
    evaluation: latestEvaluation
      ? (RECOMMENDED_ACTION_LABELS[latestEvaluation.recommendedAction] ??
        'Registrada')
      : 'Pendente',
    quote: latestQuote
      ? `v${latestQuote.version} · ${
          QUOTE_STATUS_LABELS[latestQuote.status] ?? latestQuote.status
        }`
      : 'Sem orçamento',
    execution: execution
      ? execution.finishedAt
        ? 'Concluída'
        : 'Em andamento'
      : 'Não iniciada',
    delivery: order.deliveredAt ? 'Entregue' : 'Pendente',
  }

  // "current" is the first stage still open, so exactly one stage is ever
  // highlighted and everything after it reads as pending.
  const currentIndex = WORKFLOW_TABS.findIndex((tab) => !done[tab.value])

  return WORKFLOW_TABS.map((tab, index) => ({
    value: tab.value,
    label: tab.label,
    icon: tab.icon,
    state: done[tab.value]
      ? 'done'
      : index === currentIndex
        ? 'current'
        : 'pending',
    hint: hints[tab.value],
  }))
}

/**
 * How a workflow stage may be interacted with right now.
 *
 * - `editable`          — the stage is the live one; render its form.
 * - `record`            — closed; render what was recorded, no way back.
 * - `record-revisable`  — closed, but a correction is legitimate (see below).
 * - `locked`            — not reachable yet; say what unlocks it.
 */
export type StageAffordance =
  | 'editable'
  | 'record'
  | 'record-revisable'
  | 'locked'

// A quote that has left the lab. Its existence is what freezes the evaluation:
// the diagnosis has been communicated to the customer as the basis for a price.
function hasQuoteLeftTheLab(order: Pick<ServiceOrderDetail, 'quotes'>) {
  return order.quotes.some((quote) => quote.status !== 'draft')
}

/**
 * Per-stage affordances, derived from the artefacts each stage produces plus
 * the order status — never from the active tab. Pure so the rules are testable
 * without rendering the page.
 */
export function buildServiceOrderStageAffordances(
  order: Pick<
    ServiceOrderDetail,
    'evaluations' | 'quotes' | 'execution' | 'deliveredAt' | 'status'
  >,
): Record<WorkflowTabValue, StageAffordance> {
  // A closed or canceled OS is history in every stage at once.
  if (isServiceOrderFinalStatus(order.status)) {
    return {
      evaluation: 'record',
      quote: 'record',
      execution: 'record',
      delivery: 'record',
    }
  }

  const [latestEvaluation] = order.evaluations
  const [latestQuote] = order.quotes
  const execution = order.execution

  // Freezes once a quote has been sent (the lab's chosen cut line), revisable
  // from there because a wrong diagnosis still has to be correctable.
  const evaluation: StageAffordance = !latestEvaluation
    ? 'editable'
    : hasQuoteLeftTheLab(order)
      ? 'record-revisable'
      : 'editable'

  const quote: StageAffordance = !latestEvaluation
    ? 'locked'
    : latestQuote?.status === 'approved' || latestQuote?.status === 'rejected'
      ? 'record-revisable'
      : 'editable'

  const canStartExecution =
    order.status === 'repair_in_progress' ||
    canTransitionServiceOrderStatus(order.status, 'repair_in_progress')
  const execStage: StageAffordance = execution
    ? execution.finishedAt
      ? 'record'
      : 'editable'
    : canStartExecution
      ? 'editable'
      : 'locked'

  const canDeliver =
    order.status === 'delivered' ||
    canTransitionServiceOrderStatus(order.status, 'delivered')
  const delivery: StageAffordance = order.deliveredAt
    ? 'record'
    : canDeliver
      ? 'editable'
      : 'locked'

  return { evaluation, quote, execution: execStage, delivery }
}

/** Why a locked stage is locked, in pt-BR, for its empty state. */
export const STAGE_LOCKED_REASONS: Record<
  WorkflowTabValue,
  { title: string; description: string }
> = {
  evaluation: {
    title: 'Avaliação ainda não disponível',
    description: 'Esta etapa é o início do fluxo desta OS.',
  },
  quote: {
    title: 'Orçamento ainda não disponível',
    description: 'Registre a avaliação técnica para montar o orçamento.',
  },
  execution: {
    title: 'Execução ainda não disponível',
    description: 'A execução é liberada após a aprovação do orçamento.',
  },
  delivery: {
    title: 'Entrega ainda não disponível',
    description:
      'A entrega é liberada quando a OS estiver pronta para retirada.',
  },
}

// Keyed by the canonical event list in @calibra-facil/shared, NOT by
// `string` — adding an event type there now fails the build here until it has
// a pt-BR label, instead of silently rendering the raw
// "service_order.public_link_viewed" key in the timeline.
export const SERVICE_ORDER_EVENT_LABELS: Record<ServiceOrderEventType, string> =
  {
    'service_order.created': 'OS criada',
    'service_order.intake_document_issued': 'Comprovante emitido',
    'service_order.tag_printed': 'Etiqueta gerada',
    'service_order.status_changed': 'Status alterado',
    'service_order.technician_assigned': 'Técnico atribuído',
    'service_order.evaluation_started': 'Avaliação iniciada',
    'service_order.evaluation_completed': 'Avaliação concluída',
    'service_order.evaluation_updated': 'Avaliação alterada',
    'service_order.quote_created': 'Orçamento criado',
    'service_order.quote_sent': 'Orçamento enviado',
    'service_order.quote_approved_by_client': 'Orçamento aprovado pelo cliente',
    'service_order.quote_approved_manually': 'Orçamento aprovado manualmente',
    'service_order.quote_rejected_by_client': 'Orçamento recusado pelo cliente',
    'service_order.quote_rejected_manually': 'Orçamento recusado manualmente',
    'service_order.repair_started': 'Execução iniciada',
    'service_order.repair_finished': 'Execução finalizada',
    'service_order.delivery_document_issued': 'Comprovante de entrega emitido',
    'service_order.repair_mark_updated': 'Marca de Reparo atualizada',
    'service_order.ready_for_pickup': 'Disponível para retirada',
    'service_order.delivered': 'Entregue ao cliente',
    'service_order.closed': 'OS encerrada',
    'service_order.reopened': 'OS reaberta',
    'service_order.canceled': 'OS cancelada',
    'service_order.certificate_linked': 'Calibração vinculada',
    'service_order.certificate_unlinked': 'Calibração desvinculada',
    'service_order.sent_to_finance': 'Enviada ao financeiro',
    'service_order.email_sent': 'E-mail enviado ao cliente',
    'service_order.portal_viewed': 'Visualizada no portal do cliente',
    'service_order.public_link_viewed': 'Link público acessado',
    'service_order.public_code_redeemed': 'Código de acesso validado',
  }

function isServiceOrderEventType(
  eventType: string,
): eventType is ServiceOrderEventType {
  return SERVICE_ORDER_EVENT_TYPES.some((known) => known === eventType)
}

// The event log is persisted data: a row written by an older/newer deploy can
// carry a type this build doesn't know, so the raw key stays as the fallback.
export function serviceOrderEventLabel(eventType: string): string {
  return isServiceOrderEventType(eventType)
    ? SERVICE_ORDER_EVENT_LABELS[eventType]
    : eventType
}

export const COMMUNICATION_STATUS_LABELS: Record<
  ServiceOrderCommunicationStatus,
  string
> = {
  sent: 'Enviado',
  queued: 'Na fila de envio',
  retrying: 'Reenvio pendente',
  failed: 'Falhou',
  skipped: 'Não enviado',
}

export function communicationStatusBadgeVariant(
  status: ServiceOrderCommunicationStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'sent':
      return 'default'
    case 'failed':
      return 'destructive'
    case 'queued':
    case 'retrying':
      return 'secondary'
    case 'skipped':
      return 'outline'
  }
}

// Labels for the status_email:* event keys — mirrors the subjects the customer
// receives (apps/api service-order-email-drain buildSubject).
const COMMUNICATION_STATUS_EMAIL_LABELS: Record<string, string> = {
  repair_in_progress: 'Serviço iniciado',
  awaiting_calibration: 'Atualização do serviço — aguardando calibração',
  calibration_in_progress: 'Atualização do serviço — calibração em andamento',
  awaiting_tech_evaluation: 'Aguardando avaliação técnica',
  under_evaluation: 'Em avaliação técnica',
  ready_for_pickup: 'Pronto para retirada',
  delivered: 'Equipamento entregue',
  closed: 'OS encerrada',
  awaiting_final_review: 'Em revisão final',
  canceled: 'OS cancelada',
  warranty_return: 'Retorno em garantia',
}

export function communicationEventLabel(eventKey: string): string {
  if (eventKey === 'nova_os') return 'OS registrada — confirmação'
  if (eventKey.startsWith('orcamento_sent:')) return 'Orçamento enviado'
  if (eventKey.startsWith('quote_approved:')) {
    return 'Orçamento aprovado — confirmação'
  }
  if (eventKey.startsWith('quote_rejected:')) {
    return 'Orçamento recusado — confirmação'
  }
  if (eventKey.startsWith('status_email:')) {
    const status = eventKey.slice('status_email:'.length)
    return COMMUNICATION_STATUS_EMAIL_LABELS[status] ?? 'Atualização de status'
  }
  return eventKey
}

const BRL_FORMAT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function money(cents: number) {
  return BRL_FORMAT.format(cents / 100)
}

type FinancialStatusBadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'

export function financialStatusBadgeVariant(
  status: FinancialContinuityStatus,
): FinancialStatusBadgeVariant {
  switch (status) {
    case 'OVERDUE':
    case 'BLOCKED':
      return 'destructive'
    case 'SYNCHRONIZED_WITH_WARNINGS':
    case 'STATUS_UNAVAILABLE':
      return 'outline'
    case 'PAID':
      return 'default'
    case 'READY_FOR_BILLING':
    case 'INVOICE_AVAILABLE':
    case 'SENT_TO_FINANCE':
    case 'AWAITING_PAYMENT':
    case 'PARTIALLY_PAID':
      return 'secondary'
    case 'NOT_CONFIGURED':
    case 'NOT_SENT':
    case 'VOID':
      return 'outline'
  }
}

const DATETIME_SHORT_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

const DATE_SHORT_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
})

export function formatDateTime(value?: string | null) {
  if (!value) return 'Não informado'
  return DATETIME_SHORT_FORMAT.format(new Date(value))
}

export function formatDate(value?: string | null) {
  if (!value) return 'Não informado'
  return DATE_SHORT_FORMAT.format(new Date(value))
}

export function serviceOrderFinancialStatusSummary(
  status: ServiceOrderFinancialStatus,
) {
  const openCents = status.installments
    .filter((installment) => installment.status === 'OPEN')
    .reduce((sum, installment) => sum + installment.amountCents, 0)
  const overdueCents = status.installments
    .filter((installment) => installment.status === 'OVERDUE')
    .reduce((sum, installment) => sum + installment.amountCents, 0)
  const receivedCents = status.receipts.reduce(
    (sum, receipt) => sum + receipt.amountCents,
    0,
  )
  const lastUpdateLabel = status.freshness.lastSyncedAt
    ? formatDateTime(status.freshness.lastSyncedAt)
    : status.freshness.label
  const evidenceBaseLabel =
    status.providerEvidence?.label ?? status.freshness.label
  const evidenceReconnectPath = status.providerEvidence?.reconnectPath ?? null

  return {
    badgeVariant: financialStatusBadgeVariant(status.status),
    totalLabel: money(status.billingDocument?.totalCents ?? status.amountCents),
    dueDateLabel: status.billingDocument
      ? formatDate(status.billingDocument.dueDate)
      : 'Sem vencimento',
    fiscalLabel: status.fiscalDocument.label,
    openLabel: money(openCents),
    overdueCents,
    overdueLabel: money(overdueCents),
    receivedLabel: money(receivedCents),
    lastUpdateLabel,
    evidenceLabel: evidenceReconnectPath ? 'Reconectar' : evidenceBaseLabel,
    evidenceReconnectPath,
  }
}

export function parseMoneyToCents(value: string) {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN
}

export function createEmptyQuoteItem(
  type: ServiceOrderItemType = 'service',
): QuoteDraftItem {
  return {
    id: crypto.randomUUID(),
    type,
    description: '',
    quantity: '1',
    unit: 'un',
    unitPrice: '',
    materialId: null,
  }
}

const MONEY_INPUT_FORMAT = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

// Formats catalog cents into the same masked money string the row input
// expects (pt-BR: thousands dot, decimal comma) so `parseMoneyToCents`
// round-trips it. Missing prices stay blank so the row remains editable.
export function formatCentsForMoneyInput(
  cents: number | null | undefined,
): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return ''
  return MONEY_INPUT_FORMAT.format(cents / 100)
}

// Prefill patch applied when a catalog material is selected on a part row.
// Binds the catalog reference and seeds description/unit/price; the caller
// keeps these editable.
export function materialToQuoteItemPatch(
  material: MaterialOption,
): Pick<QuoteDraftItem, 'materialId' | 'description' | 'unit' | 'unitPrice'> {
  return {
    materialId: material.id,
    description: material.name,
    unit: material.unit,
    unitPrice: formatCentsForMoneyInput(material.unitPriceCents),
  }
}

// Patch applied when a row's type changes. Only "part" rows may reference the
// material catalog, so switching to any other type drops the binding while
// leaving the typed description intact (free-form fallback).
export function quoteItemTypeChangePatch(
  type: ServiceOrderItemType,
): Partial<QuoteDraftItem> {
  return type === 'part' ? { type } : { type, materialId: null }
}

// Maps an API quote/execution item back into editable draft state, carrying
// the catalog reference (materialId) through so it round-trips on save.
export function quoteDraftItemFromApiItem(
  item: ServiceOrderQuoteItem,
): QuoteDraftItem {
  return {
    id: String(item.id),
    type: item.type,
    description: item.description,
    quantity: String(item.quantity),
    unit: item.unit,
    unitPrice: formatCentsForMoneyInput(item.unitPriceCents),
    materialId: item.materialId ?? null,
  }
}

// The API's lifecycle guards answer with these exact strings when the OS status
// forbids an action (apps/api service-order routes). Matching on them lets the
// UI add a "refresh" hint only where it is actually useful, instead of on every
// 400 — a Zod validation failure is also a 400 and means something else.
const LIFECYCLE_CONFLICT_MESSAGES = [
  'Transicao de status invalida',
  'OS encerrada ou cancelada',
  'Este orcamento ja foi respondido',
  'Apenas rascunhos podem ser enviados',
]

/**
 * True when the request failed because the order moved on (or never got to the
 * state the action needs). Duck-typed off the CalibraApiError shape, matching
 * `isScopeViolationError` in the jobs feature.
 */
export function isServiceOrderLifecycleError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const status = Reflect.get(error, 'status')
  if (status === 409) return true
  if (status !== 400) return false

  const message = Reflect.get(error, 'message')
  return (
    typeof message === 'string' &&
    LIFECYCLE_CONFLICT_MESSAGES.some((known) => message.includes(known))
  )
}

/**
 * User-facing pt-BR message for a failed service-order action. Prefers the
 * server's own message (already Portuguese) and appends a refresh hint for
 * lifecycle conflicts, whose usual cause is a page showing a stale status.
 */
export function serviceOrderActionErrorMessage(
  error: unknown,
  fallback: string,
): string {
  const serverMessage =
    error instanceof Error && error.message.trim() ? error.message : fallback

  return isServiceOrderLifecycleError(error)
    ? `${serverMessage}. Atualize a página para ver o estado atual da OS.`
    : serverMessage
}

// Line total for a single draft row. Returns null (not 0) while the row is
// still incomplete, so the editor can stay quiet instead of showing "R$ 0,00"
// on every empty line.
export function quoteItemLineTotal(item: QuoteDraftItem): number | null {
  // A blank field is "not filled in yet", not zero — `Number('')` is 0, so the
  // emptiness has to be checked before parsing. A typed "0,00" still totals 0.
  if (!item.quantity.trim() || !item.unitPrice.trim()) return null
  const quantity = Number(item.quantity.replace(',', '.'))
  const cents = parseMoneyToCents(item.unitPrice)
  if (!Number.isFinite(quantity) || !Number.isFinite(cents)) return null
  return Math.round(quantity * cents)
}

export function quoteItemsTotal(items: QuoteDraftItem[]) {
  return items.reduce((total, item) => {
    const lineTotal = quoteItemLineTotal(item)
    return lineTotal === null ? total : total + lineTotal
  }, 0)
}

export function toApiItems(items: QuoteDraftItem[]) {
  return items.map((item) => {
    const quantity = Number(item.quantity.replace(',', '.'))
    const unitPriceCents = parseMoneyToCents(item.unitPrice)
    if (!item.description.trim()) {
      throw new Error('Informe a descrição de todos os itens.')
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Informe uma quantidade válida para todos os itens.')
    }
    if (!Number.isFinite(unitPriceCents)) {
      throw new Error('Informe um valor válido para todos os itens.')
    }
    return {
      type: item.type,
      description: item.description.trim(),
      quantity,
      unit: item.unit.trim() || 'un',
      unitPriceCents,
      taxable: true,
      warrantyCovered: false,
      materialId: item.materialId ?? null,
    }
  })
}

export function buildServiceOrderTimelineItems(
  events: ServiceOrderDetail['events'],
): EventTimelineItem[] {
  return events.map((event) => {
    const isDocument = event.eventType.includes('document')
    const isExecution =
      event.eventType.includes('repair') ||
      event.eventType.includes('execution')
    const isApproval = event.eventType.includes('approved')
    const isDelivery =
      event.eventType.includes('delivered') ||
      event.eventType.includes('ready_for_pickup')
    // Customer-side reads (portal / public link / code) and outbound email are
    // not lab actions — they get their own icons instead of the generic check.
    const isCustomerView =
      event.eventType.includes('viewed') || event.eventType.includes('redeemed')
    const isEmail = event.eventType.includes('email')
    return {
      id: String(event.id),
      title: serviceOrderEventLabel(event.eventType),
      timestamp: event.createdAt,
      actor:
        event.actorName ??
        (event.actorType === 'system'
          ? 'Sistema'
          : event.actorType === 'portal_user'
            ? 'Cliente no portal'
            : event.actorType === 'public_token'
              ? 'Link público'
              : null),
      icon: isCustomerView
        ? ViewIcon
        : isEmail
          ? Mail01Icon
          : isDocument
            ? File02Icon
            : isExecution
              ? Wrench01Icon
              : isApproval
                ? UserCheck01Icon
                : isDelivery
                  ? PackageProcessIcon
                  : CheckmarkCircle02Icon,
      dotClassName:
        'border-primary/20 bg-background text-primary shadow-[inset_0_0_0_0.5rem_hsl(var(--primary)/0.12)]',
      status: 'completed' as const,
    }
  })
}

export function buildServiceOrderIntakeHtml(
  order: ServiceOrderDetail,
  publicOrigin = globalThis.location?.origin,
) {
  const snapshot = order.assetSnapshot
  const publicUrl = publicOrigin
    ? `${publicOrigin}/dashboard/service-orders/${order.id}`
    : null
  const organizationAddress = [
    order.organizationStreet,
    order.organizationNumber,
    order.organizationNeighbourhood,
    order.organizationCity,
    order.organizationState,
    order.organizationCep,
  ]
    .filter(Boolean)
    .join(', ')

  return `<!doctype html>${renderToStaticMarkup(
    <ServiceOrderIntakeDocumentHtml
      data={{
        serviceOrderNumber: order.serviceOrderNumber,
        openedAt: order.openedAt,
        requestedServices:
          order.priority === 'warranty'
            ? ['Garantia']
            : ['Orçamento', 'Manutenção corretiva'],
        lab: {
          name: order.organizationName ?? 'Laboratório',
          email: order.organizationEmail ?? null,
          phone: order.organizationPhone ?? null,
          cnpj: order.organizationCnpj ?? null,
          address: organizationAddress || null,
        },
        unit: { name: order.unitName ?? null },
        customer: {
          name: order.customerName,
          email: order.customerEmail ?? null,
          phone: order.customerPhone ?? null,
          taxId: order.customerTaxId ?? null,
          address: null,
        },
        asset: {
          name: snapshot?.assetName ?? order.assetName,
          type: snapshot?.assetType ?? null,
          manufacturer: snapshot?.manufacturer ?? null,
          model: snapshot?.model ?? null,
          serialNumber:
            snapshot?.serialNumber ?? order.assetSerialNumber ?? null,
          patrimonyNumber: snapshot?.patrimonyNumber ?? order.assetTag ?? null,
          tag: order.assetTag ?? null,
          observedIdentification: snapshot?.observedIdentification ?? null,
          // Blueprint-driven specs frozen at intake (null for pre-0056 orders, where
          // the web preview simply omits the spec grid; the worker PDF still falls back).
          specs: snapshot?.displaySpecs ?? undefined,
          metrologyRegime: order.assetMetrologyRegime ?? undefined,
        },
        intake: {
          claimedDefect: order.claimedDefect,
          intakeCondition: order.intakeCondition,
          accessories: order.accessories ?? null,
          invoiceRemittanceNumber: order.invoiceRemittanceNumber ?? null,
          invoiceRemittanceKey: order.invoiceRemittanceKey ?? null,
          carrierName: order.carrierName ?? null,
          thirdPartyName: order.thirdPartyName ?? null,
          removedSealingMarkNumber: order.removedSealingMarkNumber ?? null,
          affixedSealingMarkNumber: order.affixedSealingMarkNumber ?? null,
          inmetroRepairMarkNumber: order.inmetroRepairMarkNumber ?? null,
          clientVisibleNotes: order.clientVisibleNotes ?? null,
          internalNotes: order.internalNotes ?? null,
          terms: null,
        },
        publicUrl,
        qrCodeDataUrl: null,
      }}
    />,
  )}`
}

export function getPublicUrl(result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result))
    return null
  const record = Object.fromEntries(Object.entries(result))
  if (typeof record.publicUrl === 'string') return record.publicUrl
  const data = record.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const nested = Object.fromEntries(Object.entries(data))
  return typeof nested.publicUrl === 'string' ? nested.publicUrl : null
}

export function buildServiceOrderDetailFormKey(order: ServiceOrderDetail) {
  return [
    order.id,
    order.evaluations[0]?.id ?? 'no-evaluation',
    order.execution?.id ?? 'no-execution',
    order.deliveryDocuments[0]?.id ?? 'no-delivery-document',
  ].join(':')
}
