import { renderToStaticMarkup } from 'react-dom/server'
import {
  CheckmarkCircle02Icon,
  File02Icon,
  PackageProcessIcon,
  UserCheck01Icon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'

import { ServiceOrderIntakeDocumentHtml } from '@calibra-facil/documents'
import type { MaterialsListData } from '@calibra-facil/client-runtime'
import type { EventTimelineItem } from '@/components/event-timeline'
import type {
  FinancialContinuityStatus,
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

export const SERVICE_ORDER_EVENT_LABELS: Record<string, string> = {
  'service_order.created': 'OS criada',
  'service_order.intake_document_issued': 'Comprovante emitido',
  'service_order.tag_printed': 'Etiqueta gerada',
  'service_order.status_changed': 'Status alterado',
  'service_order.technician_assigned': 'Técnico atribuído',
  'service_order.evaluation_completed': 'Avaliação concluída',
  'service_order.quote_created': 'Orçamento criado',
  'service_order.quote_sent': 'Orçamento enviado',
  'service_order.quote_approved_by_client': 'Orçamento aprovado pelo cliente',
  'service_order.quote_approved_manually': 'Orçamento aprovado manualmente',
  'service_order.quote_rejected_by_client': 'Orçamento recusado pelo cliente',
  'service_order.repair_started': 'Execução iniciada',
  'service_order.repair_finished': 'Execução finalizada',
  'service_order.delivery_document_issued': 'Comprovante de entrega emitido',
  'service_order.repair_seal_updated': 'Etiqueta de Reparo atualizada',
  'service_order.ready_for_pickup': 'Disponível para retirada',
  'service_order.delivered': 'Entregue ao cliente',
  'service_order.closed': 'OS encerrada',
  'service_order.canceled': 'OS cancelada',
  'service_order.certificate_linked': 'Calibração vinculada',
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

export function quoteItemsTotal(items: QuoteDraftItem[]) {
  return items.reduce((total, item) => {
    const quantity = Number(item.quantity.replace(',', '.'))
    const cents = parseMoneyToCents(item.unitPrice)
    if (!Number.isFinite(quantity) || !Number.isFinite(cents)) return total
    return total + Math.round(quantity * cents)
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
    return {
      id: String(event.id),
      title: SERVICE_ORDER_EVENT_LABELS[event.eventType] ?? event.eventType,
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
      icon: isDocument
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
          oldSealNumber: order.oldSealNumber ?? null,
          newSealNumber: order.newSealNumber ?? null,
          inmetroRepairSealNumber: order.inmetroRepairSealNumber ?? null,
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
