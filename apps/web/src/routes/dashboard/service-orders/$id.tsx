import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle02Icon,
  Delete02Icon,
  File02Icon,
  PackageProcessIcon,
  PlusSignIcon,
  SentIcon,
  UserCheck01Icon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import {
  EventTimeline,
  type EventTimelineItem,
} from '@/components/event-timeline'
import { ServiceOrderIntakeDocumentHtml } from '@calibra-facil/documents'
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
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

export const Route = createFileRoute('/dashboard/service-orders/$id')({
  head: () => ({ meta: [{ title: 'Detalhe da OS | CalibraFácil' }] }),
  component: ServiceOrderDetailPage,
})

type ServiceOrderItemType =
  | 'service'
  | 'part'
  | 'external_service'
  | 'freight'
  | 'discount'
  | 'evaluation_fee'
  | 'other'

type ServiceOrderRecommendedAction =
  | 'repair'
  | 'calibration_only'
  | 'return_without_repair'
  | 'condemned'
  | 'warranty_service'
  | 'external_service_required'

type ServiceOrderExecutionResult =
  | 'repaired'
  | 'not_repaired'
  | 'condemned'
  | 'returned_without_service'
  | 'sent_to_third_party'

type ServiceOrderQuoteItem = {
  id: number
  type: ServiceOrderItemType
  description: string
  quantity: number
  unit: string
  unitPriceCents: number
  totalPriceCents: number
  taxable?: boolean
  warrantyCovered?: boolean
  notes?: string | null
}

type ServiceOrderQuote = {
  id: number
  status: string
  totalCents: number
  version: number
  validUntil?: string | null
  paymentTerms?: string | null
  deliveryEstimate?: string | null
  warrantyTerms?: string | null
  clientMessage?: string | null
  subtotalServicesCents?: number
  subtotalPartsCents?: number
  freightCents?: number
  discountCents?: number
  items: ServiceOrderQuoteItem[]
}

type ServiceOrderEvaluation = {
  id: number
  diagnosis: string
  detectedIssues?: string | null
  recommendedAction: ServiceOrderRecommendedAction
  requiresQuote: boolean
  requiresClientApproval: boolean
  calibrationRecommended: boolean
  clientVisibleNotes?: string | null
  internalNotes?: string | null
  evaluatedAt: string
}

type ServiceOrderExecution = {
  id: number
  startedAt: string
  finishedAt?: string | null
  servicePerformed?: string | null
  partsUsedSummary?: string | null
  technicalNotes?: string | null
  calibrationRequiredAfterRepair: boolean
  result?: ServiceOrderExecutionResult | null
  items: ServiceOrderQuoteItem[]
}

type ServiceOrderSignatureData = {
  signerName: string
  signedAt?: string
  dataUrl: string
}

type ServiceOrderDeliveryDocument = {
  id: number
  documentNumber: string
  version: number
  pdfR2Key?: string | null
  issuedAt?: string | null
}

type ServiceOrderDetail = {
  id: number
  serviceOrderNumber: string
  organizationName?: string | null
  organizationCnpj?: string | null
  organizationPhone?: string | null
  organizationEmail?: string | null
  organizationStreet?: string | null
  organizationNumber?: string | null
  organizationNeighbourhood?: string | null
  organizationCity?: string | null
  organizationState?: string | null
  organizationCep?: string | null
  priority: string
  statusLabel: string
  customerName: string
  customerTaxId?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  assetName: string
  assetTag?: string | null
  assetSerialNumber?: string | null
  unitName?: string | null
  assetSnapshot?: {
    assetName: string
    assetType?: string | null
    manufacturer?: string | null
    model?: string | null
    serialNumber?: string | null
    patrimonyNumber?: string | null
    capacity?: string | null
    resolution?: string | null
    observedIdentification?: string | null
  } | null
  claimedDefect: string
  intakeCondition: string
  accessories?: string | null
  invoiceRemittanceNumber?: string | null
  invoiceRemittanceKey?: string | null
  carrierName?: string | null
  thirdPartyName?: string | null
  oldSealNumber?: string | null
  newSealNumber?: string | null
  inmetroRepairSealNumber?: string | null
  inmetroRepairSealIssuedAt?: string | null
  inmetroRepairSealAppliedAt?: string | null
  inmetroRepairSealNotes?: string | null
  deliveredAt?: string | null
  deliveredToName?: string | null
  deliveredToDocument?: string | null
  deliveryMethod?: 'pickup_at_lab' | 'ship_to_client' | 'third_party_pickup'
  deliveryNotes?: string | null
  clientVisibleNotes?: string | null
  internalNotes?: string | null
  openedAt: string
  evaluations: ServiceOrderEvaluation[]
  quotes: ServiceOrderQuote[]
  execution?: ServiceOrderExecution | null
  deliveryDocuments: ServiceOrderDeliveryDocument[]
  events: Array<{
    id: number
    eventType: string
    actorType?: string | null
    actorName?: string | null
    createdAt: string
  }>
}

type QuoteDraftItem = {
  id: string
  type: ServiceOrderItemType
  description: string
  quantity: string
  unit: string
  unitPrice: string
}

function money(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Não informado'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function parseMoneyToCents(value: string) {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN
}

function createEmptyQuoteItem(
  type: ServiceOrderItemType = 'service',
): QuoteDraftItem {
  return {
    id: crypto.randomUUID(),
    type,
    description: '',
    quantity: '1',
    unit: 'un',
    unitPrice: '',
  }
}

function quoteItemsTotal(items: QuoteDraftItem[]) {
  return items.reduce((total, item) => {
    const quantity = Number(item.quantity.replace(',', '.'))
    const cents = parseMoneyToCents(item.unitPrice)
    if (!Number.isFinite(quantity) || !Number.isFinite(cents)) return total
    return total + Math.round(quantity * cents)
  }, 0)
}

function toApiItems(items: QuoteDraftItem[]) {
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
    }
  })
}

const itemTypeLabels: Record<ServiceOrderItemType, string> = {
  service: 'Serviço',
  part: 'Peça',
  external_service: 'Serviço externo',
  freight: 'Frete',
  discount: 'Desconto',
  evaluation_fee: 'Taxa de avaliação',
  other: 'Outro',
}

const recommendedActionLabels: Record<ServiceOrderRecommendedAction, string> = {
  repair: 'Reparo',
  calibration_only: 'Somente calibração',
  return_without_repair: 'Devolver sem reparo',
  condemned: 'Condenado',
  warranty_service: 'Atendimento em garantia',
  external_service_required: 'Serviço externo',
}

const executionResultLabels: Record<ServiceOrderExecutionResult, string> = {
  repaired: 'Reparado',
  not_repaired: 'Não reparado',
  condemned: 'Condenado',
  returned_without_service: 'Devolvido sem serviço',
  sent_to_third_party: 'Enviado a terceiro',
}

const deliveryMethodLabels = {
  pickup_at_lab: 'Retirada no laboratório',
  ship_to_client: 'Envio ao cliente',
  third_party_pickup: 'Retirada por terceiro',
} as const

const serviceOrderEventLabels: Record<string, string> = {
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
  'service_order.repair_seal_updated': 'Selo de reparado atualizado',
  'service_order.ready_for_pickup': 'Disponível para retirada',
  'service_order.delivered': 'Entregue ao cliente',
  'service_order.closed': 'OS encerrada',
  'service_order.canceled': 'OS cancelada',
  'service_order.certificate_linked': 'Calibração vinculada',
}

function buildServiceOrderTimelineItems(
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
      title: serviceOrderEventLabels[event.eventType] ?? event.eventType,
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
      dotClassName: 'border-primary/20 bg-primary/10 text-primary',
      status: 'completed' as const,
    }
  })
}

function buildServiceOrderIntakeHtml(order: ServiceOrderDetail) {
  const snapshot = order.assetSnapshot
  const publicUrl = `${window.location.origin}/dashboard/service-orders/${order.id}`
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
          capacity: snapshot?.capacity ?? null,
          resolution: snapshot?.resolution ?? null,
          observedIdentification: snapshot?.observedIdentification ?? null,
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

function SignaturePad({
  label,
  signerName,
  onSignerNameChange,
  onDataUrlChange,
}: {
  label: string
  signerName: string
  onSignerNameChange: (value: string) => void
  onDataUrlChange: (value: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)

  function getContext() {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(rect.width * ratio)) {
      canvas.width = Math.round(rect.width * ratio)
      canvas.height = Math.round(rect.height * ratio)
      const ctx = canvas.getContext('2d')
      ctx?.scale(ratio, ratio)
      if (ctx) {
        ctx.lineWidth = 1.8
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.strokeStyle = '#111827'
      }
    }
    return canvas.getContext('2d')
  }

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function finishSignature() {
    drawingRef.current = false
    const canvas = canvasRef.current
    if (canvas) onDataUrlChange(canvas.toDataURL('image/png'))
  }

  function clearSignature() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    onDataUrlChange('')
  }

  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-2">
          <Label>{label}</Label>
          <Input
            value={signerName}
            onChange={(event) => onSignerNameChange(event.target.value)}
            placeholder="Nome de quem assina"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10 active:scale-[0.96] transition-transform"
          onClick={clearSignature}
        >
          Limpar
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        className="h-28 w-full rounded-md bg-background shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)] touch-none"
        onPointerDown={(event) => {
          const ctx = getContext()
          if (!ctx) return
          drawingRef.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          const { x, y } = point(event)
          ctx.beginPath()
          ctx.moveTo(x, y)
        }}
        onPointerMove={(event) => {
          if (!drawingRef.current) return
          const ctx = getContext()
          if (!ctx) return
          const { x, y } = point(event)
          ctx.lineTo(x, y)
          ctx.stroke()
        }}
        onPointerUp={finishSignature}
        onPointerCancel={finishSignature}
      />
    </div>
  )
}

function ServiceOrderDetailPage() {
  const { id } = Route.useParams()
  const queryClient = useQueryClient()
  const [diagnosis, setDiagnosis] = useState('')
  const [detectedIssues, setDetectedIssues] = useState('')
  const [recommendedAction, setRecommendedAction] =
    useState<ServiceOrderRecommendedAction>('repair')
  const [requiresQuote, setRequiresQuote] = useState(true)
  const [requiresClientApproval, setRequiresClientApproval] = useState(true)
  const [calibrationRecommended, setCalibrationRecommended] = useState(false)
  const [evaluationClientNotes, setEvaluationClientNotes] = useState('')
  const [quoteItems, setQuoteItems] = useState<QuoteDraftItem[]>([
    createEmptyQuoteItem('service'),
    createEmptyQuoteItem('part'),
  ])
  const [paymentTerms, setPaymentTerms] = useState('')
  const [deliveryEstimate, setDeliveryEstimate] = useState('')
  const [quoteClientMessage, setQuoteClientMessage] = useState('')
  const [executionServicePerformed, setExecutionServicePerformed] = useState('')
  const [executionPartsUsedSummary, setExecutionPartsUsedSummary] = useState('')
  const [executionTechnicalNotes, setExecutionTechnicalNotes] = useState('')
  const [executionResult, setExecutionResult] =
    useState<ServiceOrderExecutionResult>('repaired')
  const [executionRequiresCalibration, setExecutionRequiresCalibration] =
    useState(false)
  const [deliveryMethod, setDeliveryMethod] =
    useState<keyof typeof deliveryMethodLabels>('pickup_at_lab')
  const [deliveredToName, setDeliveredToName] = useState('')
  const [deliveredToDocument, setDeliveredToDocument] = useState('')
  const [deliveryNotes, setDeliveryNotes] = useState('')
  const [repairSealNumber, setRepairSealNumber] = useState('')
  const [repairSealNotes, setRepairSealNotes] = useState('')
  const [repairSealApplied, setRepairSealApplied] = useState(false)
  const [technicianSignerName, setTechnicianSignerName] = useState('')
  const [technicianSignatureDataUrl, setTechnicianSignatureDataUrl] =
    useState('')
  const [clientSignerName, setClientSignerName] = useState('')
  const [clientSignatureDataUrl, setClientSignatureDataUrl] = useState('')

  const orderQuery = useQuery({
    queryKey: ['service-order', id],
    queryFn: async () => {
      const response = await api.api['service-orders'][':id'].$get({
        param: { id },
      })
      if (!response.ok) throw new Error('Erro ao carregar OS')
      const result = await response.json()
      return result.data as ServiceOrderDetail
    },
  })

  const order = orderQuery.data
  const latestEvaluation = order?.evaluations[0]
  const latestQuote = order?.quotes[0]
  const draftQuotes =
    order?.quotes.filter((quote) => quote.status === 'draft') ?? []
  const approvedQuote = order?.quotes.find(
    (quote) => quote.status === 'approved',
  )
  const quoteTotal = useMemo(() => quoteItemsTotal(quoteItems), [quoteItems])
  const latestDeliveryDocument = order?.deliveryDocuments[0]

  useEffect(() => {
    if (!latestEvaluation) return
    setDiagnosis(latestEvaluation.diagnosis)
    setDetectedIssues(latestEvaluation.detectedIssues ?? '')
    setRecommendedAction(latestEvaluation.recommendedAction)
    setRequiresQuote(latestEvaluation.requiresQuote)
    setRequiresClientApproval(latestEvaluation.requiresClientApproval)
    setCalibrationRecommended(latestEvaluation.calibrationRecommended)
    setEvaluationClientNotes(latestEvaluation.clientVisibleNotes ?? '')
  }, [latestEvaluation])

  useEffect(() => {
    if (!order) return
    setDeliveryMethod(order.deliveryMethod ?? 'pickup_at_lab')
    setDeliveredToName(order.deliveredToName ?? '')
    setDeliveredToDocument(order.deliveredToDocument ?? '')
    setDeliveryNotes(order.deliveryNotes ?? '')
    setRepairSealNumber(order.inmetroRepairSealNumber ?? '')
    setRepairSealNotes(order.inmetroRepairSealNotes ?? '')
    setRepairSealApplied(Boolean(order.inmetroRepairSealAppliedAt))
  }, [order])

  const saveEvaluation = useMutation({
    mutationFn: async () => {
      if (!diagnosis.trim()) throw new Error('Informe o diagnóstico técnico.')
      const json = {
        diagnosis,
        detectedIssues: detectedIssues || null,
        recommendedAction,
        requiresQuote,
        requiresClientApproval,
        calibrationRecommended,
        clientVisibleNotes: evaluationClientNotes || null,
        photos: [],
      }
      const response = latestEvaluation
        ? await api.api['service-orders'][':id'].evaluations[
            ':evaluationId'
          ].$patch({
            param: { id, evaluationId: String(latestEvaluation.id) },
            json,
          })
        : await api.api['service-orders'][':id'].evaluations.$post({
            param: { id },
            json,
          })
      if (!response.ok) throw new Error('Erro ao salvar avaliação')
    },
    onSuccess: () => {
      toast.success(
        latestEvaluation ? 'Avaliação atualizada' : 'Avaliação registrada',
      )
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao salvar avaliação',
      )
    },
  })

  const createQuote = useMutation({
    mutationFn: async () => {
      const response = await api.api['service-orders'][':id'].quotes.$post({
        param: { id },
        json: {
          deliveryEstimate: deliveryEstimate || null,
          paymentTerms: paymentTerms || null,
          clientMessage: quoteClientMessage || null,
          items: toApiItems(quoteItems),
        },
      })
      if (!response.ok) throw new Error('Erro ao salvar orçamento')
    },
    onSuccess: () => {
      toast.success('Orçamento salvo como rascunho')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao salvar orçamento',
      )
    },
  })

  const sendQuote = useMutation({
    mutationFn: async (quoteId: number) => {
      const response = await api.api['service-orders'][':id'].quotes[
        ':quoteId'
      ].send.$post({
        param: { id, quoteId: String(quoteId) },
        json: {
          clientMessage: quoteClientMessage || null,
        },
      })
      if (!response.ok) throw new Error('Erro ao emitir orçamento')
      return response.json()
    },
    onSuccess: (result) => {
      toast.success('Orçamento emitido para aprovação')
      if ('data' in result && 'publicUrl' in result) {
        navigator.clipboard?.writeText(result.publicUrl as string)
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
      const response = await api.api['service-orders'][
        ':id'
      ].execution.start.$post({
        param: { id },
        json: { notes: executionTechnicalNotes || null },
      })
      if (!response.ok) throw new Error('Erro ao iniciar execução')
    },
    onSuccess: () => {
      toast.success('Execução iniciada')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
    },
  })

  const finishExecution = useMutation({
    mutationFn: async () => {
      const response = await api.api['service-orders'][
        ':id'
      ].execution.finish.$post({
        param: { id },
        json: {
          servicePerformed: executionServicePerformed,
          partsUsedSummary: executionPartsUsedSummary || null,
          technicalNotes: executionTechnicalNotes || null,
          calibrationRequiredAfterRepair: executionRequiresCalibration,
          result: executionResult,
          items: approvedQuote?.items.map((item) => ({
            quoteItemId: item.id,
            type: item.type,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitPriceCents: item.unitPriceCents,
          })),
        },
      })
      if (!response.ok) throw new Error('Erro ao finalizar execução')
    },
    onSuccess: () => {
      toast.success('Execução finalizada')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao finalizar execução',
      )
    },
  })

  const generateIntakeDocument = useMutation({
    mutationFn: async () => {
      const response = await api.api['service-orders'][':id'][
        'intake-document'
      ].$post({
        param: { id },
      })
      if (!response.ok) throw new Error('Erro ao gerar comprovante')
    },
    onSuccess: () => {
      toast.success('Comprovante enviado para geração')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
    },
  })

  const openIntakeDocument = useMutation({
    mutationFn: async () => {
      const response = await api.api['service-orders'][':id'][
        'intake-document.pdf'
      ].$get({
        param: { id },
      })
      if (!response.ok) throw new Error('PDF ainda indisponível')
      const result = await response.json()
      window.open(result.url, '_blank', 'noopener,noreferrer')
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
    mutationFn: async () => {
      const response = await api.api['service-orders'][':id'].tag.$post({
        param: { id },
      })
      if (!response.ok) throw new Error('Erro ao gerar etiqueta')
    },
    onSuccess: () => {
      toast.success('Etiqueta enviada para geração')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
    },
  })

  const openTag = useMutation({
    mutationFn: async () => {
      const response = await api.api['service-orders'][':id']['tag.pdf'].$get({
        param: { id },
      })
      if (!response.ok) throw new Error('PDF ainda indisponível')
      const result = await response.json()
      window.open(result.url, '_blank', 'noopener,noreferrer')
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
      const response = await api.api['service-orders'][':id'][
        'repair-seal'
      ].$patch({
        param: { id },
        json: {
          inmetroRepairSealNumber: repairSealNumber || null,
          inmetroRepairSealIssuedAt: repairSealNumber
            ? new Date().toISOString()
            : null,
          inmetroRepairSealAppliedAt: repairSealApplied
            ? new Date().toISOString()
            : null,
          inmetroRepairSealNotes: repairSealNotes || null,
        },
      })
      if (!response.ok) throw new Error('Erro ao salvar selo de reparado')
    },
    onSuccess: () => {
      toast.success('Selo de reparado atualizado')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao salvar selo',
      )
    },
  })

  const deliverOrder = useMutation({
    mutationFn: async () => {
      if (!deliveredToName.trim()) throw new Error('Informe o recebedor.')
      const response = await api.api['service-orders'][':id'].deliver.$post({
        param: { id },
        json: {
          deliveryMethod,
          deliveredToName,
          deliveredToDocument: deliveredToDocument || null,
          deliveryNotes: deliveryNotes || null,
          inmetroRepairSealNumber: repairSealNumber || null,
        },
      })
      if (!response.ok) throw new Error('Erro ao registrar entrega')
    },
    onSuccess: () => {
      toast.success('Entrega registrada')
      queryClient.invalidateQueries({ queryKey: ['service-order', id] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao registrar entrega',
      )
    },
  })

  function buildSignature(
    signerName: string,
    dataUrl: string,
  ): ServiceOrderSignatureData | null {
    if (!signerName.trim() && !dataUrl) return null
    if (!signerName.trim() || !dataUrl) {
      throw new Error('Informe o nome e assine nos dois campos obrigatórios.')
    }
    return {
      signerName: signerName.trim(),
      signedAt: new Date().toISOString(),
      dataUrl,
    }
  }

  const issueDeliveryDocument = useMutation({
    mutationFn: async () => {
      const technicianSignature = buildSignature(
        technicianSignerName,
        technicianSignatureDataUrl,
      )
      const clientSignature = buildSignature(
        clientSignerName,
        clientSignatureDataUrl,
      )
      if (!technicianSignature || !clientSignature) {
        throw new Error('Assinatura do técnico e do cliente são obrigatórias.')
      }
      const response = await api.api['service-orders'][':id'][
        'delivery-document'
      ].$post({
        param: { id },
        json: {
          technicianSignatureData: technicianSignature,
          clientSignatureData: clientSignature,
        },
      })
      if (!response.ok) throw new Error('Erro ao gerar comprovante de entrega')
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
      const response = await api.api['service-orders'][':id'][
        'delivery-document.pdf'
      ].$get({
        param: { id },
      })
      if (!response.ok) throw new Error('PDF ainda indisponível')
      const result = await response.json()
      window.open(result.url, '_blank', 'noopener,noreferrer')
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

  if (!order) {
    return (
      <Card>
        <CardContent className="pt-6">Carregando OS...</CardContent>
      </Card>
    )
  }

  const execution = order.execution

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-balance text-lg">
                  {order.serviceOrderNumber}
                </CardTitle>
                <Badge>{order.statusLabel}</Badge>
              </div>
              <CardDescription className="text-pretty">
                {order.customerName} · {order.assetName}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="active:scale-[0.96] transition-transform"
                onClick={() => openServiceOrderIntakePreview(order)}
              >
                <HugeiconsIcon icon={File02Icon} className="mr-2 size-4" />
                Pré-visualizar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="active:scale-[0.96] transition-transform"
                onClick={() => generateIntakeDocument.mutate()}
                disabled={generateIntakeDocument.isPending}
              >
                Gerar comprovante
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="active:scale-[0.96] transition-transform"
                onClick={() => openIntakeDocument.mutate()}
                disabled={openIntakeDocument.isPending}
              >
                Abrir comprovante
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="active:scale-[0.96] transition-transform"
                onClick={() => generateTag.mutate()}
                disabled={generateTag.isPending}
              >
                Gerar etiqueta
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="active:scale-[0.96] transition-transform"
                onClick={() => openTag.mutate()}
                disabled={openTag.isPending}
              >
                Abrir etiqueta
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg bg-muted/40 p-4">
            <h3 className="text-sm font-medium">Recebimento</h3>
            <p className="mt-2 text-pretty text-sm text-muted-foreground">
              {order.claimedDefect}
            </p>
            <p className="mt-2 text-pretty text-sm">{order.intakeCondition}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-4">
            <h3 className="text-sm font-medium">Última avaliação</h3>
            <p className="mt-2 text-pretty text-sm text-muted-foreground">
              {latestEvaluation?.diagnosis ?? 'Nenhuma avaliação registrada.'}
            </p>
            {latestEvaluation ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {recommendedActionLabels[latestEvaluation.recommendedAction] ??
                  latestEvaluation.recommendedAction}
              </p>
            ) : null}
          </div>
          <div className="rounded-lg bg-muted/40 p-4">
            <h3 className="text-sm font-medium">Orçamento atual</h3>
            {latestQuote ? (
              <div className="mt-2 space-y-1 text-sm">
                <p>
                  v{latestQuote.version} · {latestQuote.status} ·{' '}
                  <span className="tabular-nums">
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
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
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
                        event.target.value as ServiceOrderRecommendedAction,
                      )
                    }
                  >
                    {Object.entries(recommendedActionLabels).map(
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
                    onChange={(event) => setDetectedIssues(event.target.value)}
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
                  disabled={saveEvaluation.isPending}
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
                            type: event.target.value as ServiceOrderItemType,
                          })
                        }
                      >
                        {Object.entries(itemTypeLabels).map(
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
                          updateQuoteItem(item.id, { unit: event.target.value })
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
                        <HugeiconsIcon icon={Delete02Icon} className="size-4" />
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
                    setQuoteItems((items) => [...items, createEmptyQuoteItem()])
                  }
                >
                  <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
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
                    disabled={sendQuote.isPending}
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
                          ? (executionResultLabels[execution.result] ??
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
                        event.target.value as ServiceOrderExecutionResult,
                      )
                    }
                  >
                    {Object.entries(executionResultLabels).map(
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
                      executionTechnicalNotes || execution?.technicalNotes || ''
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

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle>Entrega e selo Inmetro</CardTitle>
                  <CardDescription>
                    Gere as duas vias do comprovante com valores, assinaturas e
                    selo de reparado.
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
                      setDeliveryMethod(
                        event.target.value as keyof typeof deliveryMethodLabels,
                      )
                    }
                  >
                    {Object.entries(deliveryMethodLabels).map(
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
                  <Input
                    value={deliveredToName}
                    onChange={(event) => setDeliveredToName(event.target.value)}
                    placeholder="Nome do cliente ou retirante"
                  />
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
                    onChange={(event) => setRepairSealNotes(event.target.value)}
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
                    disabled={updateRepairSeal.isPending}
                  >
                    Salvar selo
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <SignaturePad
                  label="Assinatura do técnico"
                  signerName={technicianSignerName}
                  onSignerNameChange={setTechnicianSignerName}
                  onDataUrlChange={setTechnicianSignatureDataUrl}
                />
                <SignaturePad
                  label="Assinatura do cliente"
                  signerName={clientSignerName}
                  onSignerNameChange={setClientSignerName}
                  onDataUrlChange={setClientSignatureDataUrl}
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  className="active:scale-[0.96] transition-transform"
                  onClick={() => deliverOrder.mutate()}
                  disabled={deliverOrder.isPending}
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
                  disabled={openDeliveryDocument.isPending}
                >
                  Abrir comprovante
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
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
                          {quote.status}
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
                            {itemTypeLabels[item.type]} · {item.description}
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
