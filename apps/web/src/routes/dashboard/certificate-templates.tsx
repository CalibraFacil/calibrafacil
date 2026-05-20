import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen02Icon,
  CodeSquareIcon,
  Copy01Icon,
  Database02Icon,
  SearchIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlanAccess } from '@/hooks/use-plan-access'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { api, apiFetch } from '@/utils/api'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/dashboard/certificate-templates')({
  head: () => ({
    meta: [{ title: 'Templates de Certificados | CalibraFácil' }],
  }),
  component: CertificateTemplatesPage,
})

interface TemplateItem {
  id: number | null
  name: string
  slug: string
  version: number
  status: string
  isDefault: boolean
  createdAt: string | null
  updatedAt: string | null
  currentXlsxVersion?: XlsxVersionSummary | null
}

interface TemplateListResponse {
  canManage: boolean
  items: TemplateItem[]
}

interface WorkbookPlaceholder {
  sheet: string
  cell: string
  token: string
  fieldPath: string
}

interface WorkbookWarning {
  code: string
  message: string
  sheet?: string
  cell?: string
  fieldPath?: string
}

interface WorkbookAnalysis {
  sheets: Array<{
    name: string
    usedRange?: string
    printArea?: string | null
    namedRanges: string[]
    placeholders: WorkbookPlaceholder[]
  }>
  warnings: WorkbookWarning[]
}

interface XlsxVersionSummary {
  id: number
  templateId: number
  version: number
  status: string
  xlsxSha256: string
  bindingManifestSha256: string
  sheetCount?: number
  placeholderCount?: number
  warningCount?: number
  createdAt?: string | null
  updatedAt?: string | null
  publishedAt?: string | null
}

interface XlsxScalarBinding {
  id: string
  sheet: string
  cell: string
  fieldPath: string
  formatter?: string
  required?: boolean
  governed?: boolean
}

interface XlsxBindingManifest {
  schemaVersion: 'calibrafacil.certificateXlsxBinding.v1'
  requiredFields: string[]
  governedFields: string[]
  scalarBindings: XlsxScalarBinding[]
  imageBindings: unknown[]
  tableBindings: unknown[]
  renderPolicy: {
    formulas: 'preserve' | 'rejectVolatile'
    macros: 'reject'
    externalLinks: 'reject'
    converter: 'gotenberg-libreoffice'
  }
}

interface XlsxPreviewItem {
  id: number
  status: string
  error?: string | null
}

interface XlsxPreviewReference {
  id: number
  templateId: number
  versionId: number
}

interface XlsxWorkbenchState {
  version: XlsxVersionSummary
  analysis: WorkbookAnalysis
  manifest: XlsxBindingManifest
}

type XlsxTokenKind = 'Texto' | 'Data' | 'Número' | 'Lista' | 'URL' | 'Imagem'

interface XlsxTokenCatalogItem {
  group: string
  groupLabel: string
  path: string
  label: string
  description: string
  kind: XlsxTokenKind
  example?: string
}

const XLSX_TOKEN_CATALOG: XlsxTokenCatalogItem[] = [
  {
    group: 'customer',
    groupLabel: 'Cliente',
    path: 'customer.name',
    label: 'Nome do cliente',
    description: 'Razão social ou nome exibido no certificado.',
    kind: 'Texto',
  },
  {
    group: 'customer',
    groupLabel: 'Cliente',
    path: 'customer.taxId',
    label: 'CNPJ/CPF',
    description: 'Documento fiscal cadastrado para o cliente.',
    kind: 'Texto',
  },
  {
    group: 'customer',
    groupLabel: 'Cliente',
    path: 'customer.address',
    label: 'Endereço',
    description: 'Endereço formatado do cliente.',
    kind: 'Texto',
  },
  {
    group: 'customer',
    groupLabel: 'Cliente',
    path: 'customer.phone',
    label: 'Telefone',
    description: 'Telefone principal do cliente.',
    kind: 'Texto',
  },
  {
    group: 'customer',
    groupLabel: 'Cliente',
    path: 'customer.email',
    label: 'E-mail',
    description: 'E-mail principal do cliente.',
    kind: 'Texto',
  },
  {
    group: 'asset',
    groupLabel: 'Instrumento',
    path: 'asset.kind',
    label: 'Tipo do instrumento',
    description: 'Nome/tipo do ativo calibrado.',
    kind: 'Texto',
  },
  {
    group: 'asset',
    groupLabel: 'Instrumento',
    path: 'asset.serialNumber',
    label: 'Número de série',
    description: 'Série cadastrada no ativo.',
    kind: 'Texto',
  },
  {
    group: 'asset',
    groupLabel: 'Instrumento',
    path: 'asset.tag',
    label: 'Identificação interna',
    description: 'Tag ou código interno do ativo.',
    kind: 'Texto',
  },
  {
    group: 'asset',
    groupLabel: 'Instrumento',
    path: 'asset.model',
    label: 'Modelo',
    description: 'Modelo informado no cadastro do ativo.',
    kind: 'Texto',
  },
  {
    group: 'asset',
    groupLabel: 'Instrumento',
    path: 'asset.manufacturer',
    label: 'Fabricante',
    description: 'Fabricante informado no cadastro do ativo.',
    kind: 'Texto',
  },
  {
    group: 'asset',
    groupLabel: 'Instrumento',
    path: 'asset.measurementUnit',
    label: 'Unidade do instrumento',
    description: 'Unidade base configurada no tipo do instrumento.',
    kind: 'Texto',
  },
  {
    group: 'asset',
    groupLabel: 'Instrumento',
    path: 'asset.capacity',
    label: 'Capacidade',
    description: 'Capacidade no snapshot técnico do ativo.',
    kind: 'Texto',
  },
  {
    group: 'asset',
    groupLabel: 'Instrumento',
    path: 'asset.capacityText',
    label: 'Capacidade formatada',
    description: 'Capacidade com unidade, quando disponível.',
    kind: 'Texto',
  },
  {
    group: 'asset',
    groupLabel: 'Instrumento',
    path: 'asset.division',
    label: 'Divisão/resolução',
    description: 'Resolução no snapshot técnico do ativo.',
    kind: 'Texto',
  },
  {
    group: 'asset',
    groupLabel: 'Instrumento',
    path: 'asset.divisionText',
    label: 'Divisão formatada',
    description: 'Resolução com unidade, quando disponível.',
    kind: 'Texto',
  },
  {
    group: 'certificate',
    groupLabel: 'Certificado',
    path: 'certificate.number',
    label: 'Número do certificado',
    description: 'Identificador do certificado emitido.',
    kind: 'Texto',
  },
  {
    group: 'certificate',
    groupLabel: 'Certificado',
    path: 'certificate.name',
    label: 'Nome do certificado',
    description: 'Nome configurado para o documento emitido.',
    kind: 'Texto',
  },
  {
    group: 'certificate',
    groupLabel: 'Certificado',
    path: 'certificate.issuedAt',
    label: 'Data de emissão',
    description: 'Data/hora da aprovação usada na emissão.',
    kind: 'Data',
  },
  {
    group: 'certificate',
    groupLabel: 'Certificado',
    path: 'certificate.issuedAtText',
    label: 'Data de emissão formatada',
    description: 'Data de emissão no formato dd/mm/aaaa.',
    kind: 'Texto',
  },
  {
    group: 'certificate',
    groupLabel: 'Certificado',
    path: 'certificate.amendmentNumber',
    label: 'Número da emenda',
    description: 'Número da emenda quando o certificado é retificado.',
    kind: 'Texto',
  },
  {
    group: 'job',
    groupLabel: 'Calibração',
    path: 'job.id',
    label: 'ID da calibração',
    description: 'Identificador interno da calibração aprovada.',
    kind: 'Número',
  },
  {
    group: 'job',
    groupLabel: 'Calibração',
    path: 'job.performedAt',
    label: 'Data da calibração',
    description: 'Data/hora em que a calibração foi executada.',
    kind: 'Data',
  },
  {
    group: 'job',
    groupLabel: 'Calibração',
    path: 'job.performedAtText',
    label: 'Data da calibração formatada',
    description: 'Data da calibração no formato dd/mm/aaaa.',
    kind: 'Texto',
  },
  {
    group: 'job',
    groupLabel: 'Calibração',
    path: 'job.location',
    label: 'Local da calibração',
    description: 'Endereço ou local registrado para a execução.',
    kind: 'Texto',
  },
  {
    group: 'method',
    groupLabel: 'Método',
    path: 'method.name',
    label: 'Nome do método',
    description: 'Método aplicado na calibração.',
    kind: 'Texto',
  },
  {
    group: 'method',
    groupLabel: 'Método',
    path: 'method.version',
    label: 'Versão do método',
    description: 'Versão do método no snapshot aprovado.',
    kind: 'Texto',
  },
  {
    group: 'method',
    groupLabel: 'Método',
    path: 'method.procedureCode',
    label: 'Procedimento',
    description: 'Código de procedimento configurado no método.',
    kind: 'Texto',
  },
  {
    group: 'method',
    groupLabel: 'Método',
    path: 'method.referenceStandardsText',
    label: 'Normas de referência',
    description: 'Normas de referência do método em texto.',
    kind: 'Texto',
  },
  {
    group: 'environment',
    groupLabel: 'Ambiente',
    path: 'environment.temperature',
    label: 'Temperatura',
    description: 'Temperatura registrada no snapshot ambiental.',
    kind: 'Número',
  },
  {
    group: 'environment',
    groupLabel: 'Ambiente',
    path: 'environment.temperatureText',
    label: 'Temperatura formatada',
    description: 'Temperatura com unidade.',
    kind: 'Texto',
  },
  {
    group: 'environment',
    groupLabel: 'Ambiente',
    path: 'environment.relativeHumidity',
    label: 'Umidade relativa',
    description: 'Umidade registrada no snapshot ambiental.',
    kind: 'Número',
  },
  {
    group: 'environment',
    groupLabel: 'Ambiente',
    path: 'environment.relativeHumidityText',
    label: 'Umidade formatada',
    description: 'Umidade relativa com unidade.',
    kind: 'Texto',
  },
  {
    group: 'environment',
    groupLabel: 'Ambiente',
    path: 'environment.pressure',
    label: 'Pressão',
    description: 'Pressão registrada no snapshot ambiental.',
    kind: 'Número',
  },
  {
    group: 'environment',
    groupLabel: 'Ambiente',
    path: 'environment.pressureText',
    label: 'Pressão formatada',
    description: 'Pressão com unidade.',
    kind: 'Texto',
  },
  {
    group: 'lab',
    groupLabel: 'Laboratório',
    path: 'lab.name',
    label: 'Nome do laboratório',
    description: 'Nome da organização/unidade emissora.',
    kind: 'Texto',
  },
  {
    group: 'lab',
    groupLabel: 'Laboratório',
    path: 'lab.accreditationNumber',
    label: 'Acreditação',
    description: 'Número de acreditação da unidade emissora.',
    kind: 'Texto',
  },
  {
    group: 'lab',
    groupLabel: 'Laboratório',
    path: 'lab.technicalManagerName',
    label: 'Responsável técnico',
    description: 'Responsável técnico configurado no laboratório.',
    kind: 'Texto',
  },
  {
    group: 'organization',
    groupLabel: 'Organização',
    path: 'organization.logo',
    label: 'Logo da organização',
    description: 'Imagem do logo configurado para a organização.',
    kind: 'Imagem',
  },
  {
    group: 'approval',
    groupLabel: 'Aprovação',
    path: 'approval.approvedBy.name',
    label: 'Aprovador',
    description: 'Nome do usuário que aprovou a calibração.',
    kind: 'Texto',
  },
  {
    group: 'approval',
    groupLabel: 'Aprovação',
    path: 'approval.signatureUrl',
    label: 'Assinatura',
    description: 'Imagem da assinatura visual do aprovador.',
    kind: 'Imagem',
  },
  {
    group: 'service',
    groupLabel: 'Ordem de serviço',
    path: 'serviceOrder.inmetroRepairSealNumber',
    label: 'Lacre de reparo',
    description: 'Número do lacre Inmetro registrado na ordem de serviço.',
    kind: 'Texto',
  },
  {
    group: 'graphics',
    groupLabel: 'Gráficos',
    path: 'graphics.eccentricityIndicator',
    label: 'Indicador de excentricidade',
    description:
      'Imagem dinâmica da posição do indicador, renderizada a partir do método e do instrumento.',
    kind: 'Imagem',
  },
  {
    group: 'tables',
    groupLabel: 'Tabelas',
    path: 'standards',
    label: 'Padrões usados',
    description: 'Lista de padrões de referência disponíveis para tabelas.',
    kind: 'Lista',
  },
  {
    group: 'tables',
    groupLabel: 'Tabelas',
    path: 'calibrationResults',
    label: 'Resultados da calibração',
    description: 'Linhas de resultado normalizadas para blocos/tabelas.',
    kind: 'Lista',
  },
  {
    group: 'tables',
    groupLabel: 'Tabelas',
    path: 'dataDisplay',
    label: 'Dados preenchidos formatados',
    description:
      'Campos do método com números convertidos para a unidade base.',
    kind: 'Lista',
  },
  {
    group: 'tables',
    groupLabel: 'Tabelas',
    path: 'resultsDisplay',
    label: 'Resultados formatados',
    description:
      'Resultados calculados com números convertidos para a unidade base.',
    kind: 'Lista',
  },
  {
    group: 'tables',
    groupLabel: 'Tabelas',
    path: 'uncertaintyBudget',
    label: 'Orçamento de incerteza',
    description: 'Linhas do orçamento de incerteza para tabelas.',
    kind: 'Lista',
  },
]

const tokenGroups = [
  { value: 'all', label: 'Todos' },
  ...Array.from(
    new Map(
      XLSX_TOKEN_CATALOG.map((token) => [
        token.group,
        { value: token.group, label: token.groupLabel },
      ]),
    ).values(),
  ),
]

function formatApiError(data: unknown, fallback: string) {
  if (!data || typeof data !== 'object') {
    return fallback
  }

  const record = data as Record<string, unknown>
  const message = 'error' in record ? String(record.error) : fallback
  const warnings = Array.isArray(record.warnings)
    ? record.warnings
        .map((warning) =>
          warning && typeof warning === 'object' && 'message' in warning
            ? String((warning as { message: unknown }).message)
            : null,
        )
        .filter(Boolean)
    : []

  return [message, ...warnings.slice(0, 3)].join('\n')
}

type TemplateDraft = {
  name: string
}

type XlsxAssignmentDraft = {
  unitId: string
  serviceId: string
  methodId: string
  priority: string
}

type XlsxAssignmentOption = {
  id: number
  label: string
  detail?: string | null
}

function templateKey(template: TemplateItem) {
  return template.id ? String(template.id) : `system:${template.slug}`
}

function createTemplateDraft(template: TemplateItem): TemplateDraft {
  return {
    name: template.name,
  }
}

function parseOptionalPositiveInt(value: string): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parsePriority(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : 0
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'Nunca'

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getXlsxStatusLabel(status?: string | null): string {
  switch (status) {
    case 'PUBLISHED':
      return 'Publicado'
    case 'VALIDATED':
      return 'Validado'
    case 'ARCHIVED':
      return 'Arquivado'
    case 'DRAFT':
      return 'Rascunho'
    default:
      return status ?? 'Sem XLSX'
  }
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fall back for insecure origins or denied clipboard permission.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, value.length)

  try {
    return document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}

function CertificateTemplatesPage() {
  const queryClient = useQueryClient()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const accessQuery = usePlanAccess({
    enabled: !cloudOnlyUnavailable,
    refetchOnWindowFocus: false,
  })
  const xlsxInputRef = useRef<HTMLInputElement>(null)
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(
    null,
  )
  const [newTemplateName, setNewTemplateName] = useState('')
  const [xlsxWorkbench, setXlsxWorkbench] = useState<XlsxWorkbenchState | null>(
    null,
  )
  const [xlsxPreview, setXlsxPreview] = useState<XlsxPreviewReference | null>(
    null,
  )
  const [tokenSearch, setTokenSearch] = useState('')
  const [activeTokenGroup, setActiveTokenGroup] = useState('all')
  const [assignmentDraft, setAssignmentDraft] = useState<XlsxAssignmentDraft>({
    unitId: '',
    serviceId: '',
    methodId: '',
    priority: '100',
  })
  const [draftsByTemplateKey, setDraftsByTemplateKey] = useState<
    Record<string, TemplateDraft>
  >({})

  const templatesQuery = useQuery({
    queryKey: ['certificate-templates'],
    enabled: !cloudOnlyUnavailable,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await api.api['certificate-templates'].$get()
      if (!res.ok) {
        throw new Error('Falha ao carregar templates')
      }
      return res.json() as Promise<TemplateListResponse>
    },
  })

  const templates = templatesQuery.data?.items ?? []
  const defaultTemplateKey = useMemo(() => {
    const fallbackTemplate =
      templates.find((template) => template.isDefault) ?? templates[0] ?? null
    return fallbackTemplate ? templateKey(fallbackTemplate) : null
  }, [templates])
  const effectiveSelectedTemplateKey = selectedTemplateKey ?? defaultTemplateKey
  const selectedTemplate = useMemo(
    () =>
      templates.find(
        (template) => templateKey(template) === effectiveSelectedTemplateKey,
      ) ??
      templates[0] ??
      null,
    [effectiveSelectedTemplateKey, templates],
  )
  const canManageTemplateActions =
    (accessQuery.data?.hasCustomTemplates ?? false) &&
    (templatesQuery.data?.canManage ?? false)
  const assignmentOptionsEnabled = !cloudOnlyUnavailable
  const methodsQuery = useQuery({
    queryKey: ['certificate-template-assignment-options', 'methods', 'cloud'],
    enabled: assignmentOptionsEnabled,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await api.api.methods.$get({
        query: {
          page: '1',
          limit: '100',
        },
      })
      if (!res.ok) {
        throw new Error('Falha ao carregar métodos')
      }
      const data = (await res.json()) as {
        data: Array<{
          id: number
          name: string
          version: number
          status: string
        }>
      }

      return data.data.map<XlsxAssignmentOption>((method) => ({
        id: method.id,
        label: method.name,
        detail: `v${method.version} · ${method.status}`,
      }))
    },
  })
  const servicesQuery = useQuery({
    queryKey: ['certificate-template-assignment-options', 'services', 'cloud'],
    enabled: assignmentOptionsEnabled,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await api.api.services.$get({
        query: {
          page: '1',
          limit: '100',
        },
      })
      if (!res.ok) {
        throw new Error('Falha ao carregar serviços')
      }
      const data = (await res.json()) as {
        data: Array<{
          id: number
          name: string
          methodName: string | null
        }>
      }

      return data.data.map<XlsxAssignmentOption>((service) => ({
        id: service.id,
        label: service.name,
        detail: service.methodName,
      }))
    },
  })
  const unitsQuery = useQuery({
    queryKey: ['certificate-template-assignment-options', 'units', 'cloud'],
    enabled: assignmentOptionsEnabled,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await api.api.units.$get()
      if (res.status === 403) return []
      if (!res.ok) {
        throw new Error('Falha ao carregar unidades')
      }
      const data = (await res.json()) as {
        data: Array<{ id: number; name: string; role: string }>
      }

      return data.data.map<XlsxAssignmentOption>((unit) => ({
        id: unit.id,
        label: unit.name,
        detail: unit.role,
      }))
    },
  })
  const selectedCurrentXlsxVersionId =
    selectedTemplate?.currentXlsxVersion?.id ?? null
  const currentXlsxVersionQuery = useQuery({
    queryKey: [
      'certificate-template-xlsx-version',
      selectedTemplate?.id,
      selectedCurrentXlsxVersionId,
    ],
    enabled:
      !cloudOnlyUnavailable &&
      Boolean(selectedTemplate?.id && selectedCurrentXlsxVersionId),
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!selectedTemplate?.id || !selectedCurrentXlsxVersionId) {
        throw new Error('Versão XLSX indisponível')
      }

      const res = await apiFetch(
        `/api/certificate-templates/${selectedTemplate.id}/versions/${selectedCurrentXlsxVersionId}`,
      )
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao carregar XLSX atual',
        )
      }

      const data = (await res.json()) as {
        item: XlsxVersionSummary
        analysis: WorkbookAnalysis
        bindingManifest: XlsxBindingManifest
      }

      return {
        version: data.item,
        analysis: data.analysis,
        manifest: data.bindingManifest,
      } satisfies XlsxWorkbenchState
    },
  })
  const activeXlsxWorkbench = useMemo(() => {
    if (
      xlsxWorkbench &&
      selectedTemplate?.id &&
      xlsxWorkbench.version.templateId === selectedTemplate.id
    ) {
      return xlsxWorkbench
    }

    return currentXlsxVersionQuery.data ?? null
  }, [currentXlsxVersionQuery.data, selectedTemplate?.id, xlsxWorkbench])
  const activeXlsxPreviewId =
    selectedTemplate?.id &&
    activeXlsxWorkbench?.version.id &&
    xlsxPreview?.templateId === selectedTemplate.id &&
    xlsxPreview.versionId === activeXlsxWorkbench.version.id
      ? xlsxPreview.id
      : null
  const xlsxPreviewQuery = useQuery({
    queryKey: [
      'certificate-template-xlsx-preview',
      selectedTemplate?.id,
      activeXlsxWorkbench?.version.id,
      activeXlsxPreviewId,
    ],
    enabled:
      !cloudOnlyUnavailable &&
      Boolean(
        selectedTemplate?.id &&
        activeXlsxWorkbench?.version.id &&
        activeXlsxPreviewId,
      ),
    refetchInterval: (query) =>
      query.state.data?.item.status === 'PENDING' ? 3000 : false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (
        !selectedTemplate?.id ||
        !activeXlsxWorkbench?.version.id ||
        !activeXlsxPreviewId
      ) {
        throw new Error('Prévia indisponível')
      }
      const res = await apiFetch(
        `/api/certificate-templates/${selectedTemplate.id}/versions/${activeXlsxWorkbench.version.id}/previews/${activeXlsxPreviewId}`,
      )
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao consultar prévia',
        )
      }
      return res.json() as Promise<{
        item: XlsxPreviewItem
        pdfUrl: string | null
      }>
    },
  })
  const draft =
    selectedTemplate && effectiveSelectedTemplateKey
      ? (draftsByTemplateKey[effectiveSelectedTemplateKey] ??
        createTemplateDraft(selectedTemplate))
      : {
          name: '',
        }

  const setDraft = (
    updater: TemplateDraft | ((current: TemplateDraft) => TemplateDraft),
  ) => {
    if (!selectedTemplate || !effectiveSelectedTemplateKey) return

    setDraftsByTemplateKey((current) => {
      const base =
        current[effectiveSelectedTemplateKey] ??
        createTemplateDraft(selectedTemplate)
      const nextDraft = typeof updater === 'function' ? updater(base) : updater

      return {
        ...current,
        [effectiveSelectedTemplateKey]: nextDraft,
      }
    })
  }

  const refreshTemplates = async () => {
    await queryClient.invalidateQueries({ queryKey: ['certificate-templates'] })
  }

  const xlsxUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedTemplate?.id) {
        throw new Error('Selecione um template editável')
      }

      const formData = new FormData()
      formData.append('xlsx', file)

      const res = await apiFetch(
        `/api/certificate-templates/${selectedTemplate.id}/versions/upload-xlsx`,
        {
          method: 'POST',
          body: formData,
        },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(formatApiError(data, 'Falha ao enviar XLSX'))
      }

      const data = (await res.json()) as {
        item: XlsxVersionSummary
        analysis: WorkbookAnalysis
        bindingManifest: XlsxBindingManifest
      }
      return {
        version: data.item,
        analysis: data.analysis,
        manifest: data.bindingManifest,
      }
    },
    onSuccess: async (data) => {
      toast.success('XLSX analisado')
      setXlsxWorkbench(data)
      setXlsxPreview(null)
      await refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao enviar XLSX',
      )
    },
  })

  const xlsxValidateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate?.id || !activeXlsxWorkbench?.version.id) {
        throw new Error('Envie um XLSX antes de validar')
      }

      const res = await apiFetch(
        `/api/certificate-templates/${selectedTemplate.id}/versions/${activeXlsxWorkbench.version.id}/validate`,
        {
          method: 'POST',
        },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(formatApiError(data, 'Falha ao validar XLSX'))
      }

      return res.json() as Promise<{
        item: XlsxVersionSummary
        analysis: WorkbookAnalysis
        validation: { ok: boolean; warnings: WorkbookWarning[] }
      }>
    },
    onSuccess: async (data) => {
      toast.success(data.validation.ok ? 'XLSX validado' : 'XLSX com avisos')
      setXlsxWorkbench((current) => {
        const base = current ?? activeXlsxWorkbench

        return base
          ? {
              version: data.item,
              analysis: data.analysis,
              manifest: base.manifest,
            }
          : current
      })
      await refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao validar XLSX',
      )
    },
  })

  const xlsxBindingSaveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate?.id || !activeXlsxWorkbench?.version.id) {
        throw new Error('Envie um XLSX antes de salvar os vínculos')
      }

      const manifest: XlsxBindingManifest = {
        ...activeXlsxWorkbench.manifest,
        requiredFields: activeXlsxWorkbench.manifest.scalarBindings
          .filter((binding) => binding.required)
          .map((binding) => binding.fieldPath),
        governedFields: activeXlsxWorkbench.manifest.scalarBindings
          .filter((binding) => binding.governed !== false)
          .map((binding) => binding.fieldPath),
      }
      const res = await apiFetch(
        `/api/certificate-templates/${selectedTemplate.id}/versions/${activeXlsxWorkbench.version.id}/bindings`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manifest }),
        },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao salvar vínculos XLSX',
        )
      }

      return res.json() as Promise<{ item: XlsxVersionSummary }>
    },
    onSuccess: async (data) => {
      toast.success('Vínculos XLSX salvos')
      setXlsxWorkbench((current) => {
        const base = current ?? activeXlsxWorkbench

        return base ? { ...base, version: data.item } : current
      })
      await refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao salvar vínculos',
      )
    },
  })

  const xlsxPreviewMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate?.id || !activeXlsxWorkbench?.version.id) {
        throw new Error('Envie um XLSX antes de solicitar a prévia')
      }

      const res = await apiFetch(
        `/api/certificate-templates/${selectedTemplate.id}/versions/${activeXlsxWorkbench.version.id}/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sampleData: {} }),
        },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao solicitar prévia XLSX',
        )
      }

      return res.json() as Promise<{ item: XlsxPreviewItem }>
    },
    onSuccess: (data) => {
      toast.success('Prévia XLSX solicitada')
      if (!selectedTemplate?.id || !activeXlsxWorkbench?.version.id) return
      setXlsxPreview({
        id: data.item.id,
        templateId: selectedTemplate.id,
        versionId: activeXlsxWorkbench.version.id,
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao solicitar prévia',
      )
    },
  })

  const xlsxPublishMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate?.id || !activeXlsxWorkbench?.version.id) {
        throw new Error('Envie e valide um XLSX antes de publicar')
      }

      const res = await apiFetch(
        `/api/certificate-templates/${selectedTemplate.id}/versions/${activeXlsxWorkbench.version.id}/publish`,
        {
          method: 'POST',
        },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(formatApiError(data, 'Falha ao publicar XLSX'))
      }

      return res.json() as Promise<{ item: XlsxVersionSummary }>
    },
    onSuccess: async (data) => {
      toast.success('Versão XLSX publicada')
      setXlsxWorkbench((current) => {
        const base = current ?? activeXlsxWorkbench

        return base ? { ...base, version: data.item } : current
      })
      await refreshTemplates()
      await queryClient.invalidateQueries({
        queryKey: ['certificate-template-xlsx-version'],
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao publicar XLSX',
      )
    },
  })

  const xlsxAssignmentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate?.id || !activeXlsxWorkbench?.version.id) {
        throw new Error('Selecione uma versão XLSX publicada')
      }

      const payload = {
        certificateType: 'calibration',
        priority: parsePriority(assignmentDraft.priority),
        unitId: parseOptionalPositiveInt(assignmentDraft.unitId),
        serviceId: parseOptionalPositiveInt(assignmentDraft.serviceId),
        methodId: parseOptionalPositiveInt(assignmentDraft.methodId),
      }

      const res = await apiFetch(
        `/api/certificate-templates/${selectedTemplate.id}/versions/${activeXlsxWorkbench.version.id}/assignments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(formatApiError(data, 'Falha ao atribuir template'))
      }

      return res.json() as Promise<{ item: unknown }>
    },
    onSuccess: () => {
      toast.success('Template atribuído')
      void refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atribuir template',
      )
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const name = newTemplateName.trim()
      const res = await api.api['certificate-templates'].$post({
        json: {
          name,
        },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao criar template',
        )
      }

      return res.json() as Promise<{ item: TemplateItem }>
    },
    onSuccess: async (data) => {
      toast.success('Template criado')
      setNewTemplateName('')
      setSelectedTemplateKey(templateKey(data.item))
      await refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao criar template',
      )
    },
  })

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate?.id) {
        throw new Error('Selecione um template editável')
      }

      const res = await api.api['certificate-templates'][':id'].$put({
        param: { id: String(selectedTemplate.id) },
        json: {
          name: draft.name.trim(),
        },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao atualizar template',
        )
      }

      return res.json() as Promise<{ item: TemplateItem }>
    },
    onSuccess: async (data) => {
      toast.success('Template salvo')
      setSelectedTemplateKey(templateKey(data.item))
      await refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao salvar template',
      )
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate?.id) {
        throw new Error('Selecione um template salvo para duplicar')
      }

      const res = await api.api['certificate-templates'][':id'].duplicate.$post(
        {
          param: { id: String(selectedTemplate.id) },
        },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao duplicar template',
        )
      }

      return res.json() as Promise<{ item: TemplateItem }>
    },
    onSuccess: async (data) => {
      toast.success('Template duplicado')
      setSelectedTemplateKey(templateKey(data.item))
      await refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao duplicar template',
      )
    },
  })

  const setDefaultMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate?.id) {
        throw new Error('Selecione um template salvo')
      }

      const res = await api.api['certificate-templates'][':id'][
        'set-default'
      ].$post({
        param: { id: String(selectedTemplate.id) },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao definir template padrão',
        )
      }
    },
    onSuccess: async () => {
      toast.success('Template padrão atualizado')
      await refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao definir template padrão',
      )
    },
  })

  if (cloudOnlyUnavailable) {
    return (
      <CloudOnlyOfflineState title="Templates de certificados indisponíveis offline" />
    )
  }

  if (templatesQuery.isLoading || accessQuery.isLoading) {
    return <DesignerSkeleton />
  }

  if (templatesQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Templates de certificados</CardTitle>
          <CardDescription>
            {templatesQuery.error instanceof Error
              ? templatesQuery.error.message
              : 'Falha ao carregar templates'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const canManageTemplates = canManageTemplateActions
  const isSystemTemplate = selectedTemplate?.id == null
  const isReadOnly = !canManageTemplates || isSystemTemplate
  const currentXlsxVersion =
    activeXlsxWorkbench?.version ?? selectedTemplate?.currentXlsxVersion ?? null
  const isCurrentXlsxLoading =
    Boolean(selectedCurrentXlsxVersionId) && currentXlsxVersionQuery.isLoading
  const placeholderRows =
    activeXlsxWorkbench?.analysis.sheets.flatMap(
      (sheet) => sheet.placeholders,
    ) ?? []
  const scalarBindings = activeXlsxWorkbench?.manifest.scalarBindings ?? []
  const isXlsxPublished = activeXlsxWorkbench?.version.status === 'PUBLISHED'
  const isXlsxImmutable =
    activeXlsxWorkbench?.version.status === 'PUBLISHED' ||
    activeXlsxWorkbench?.version.status === 'ARCHIVED'
  const hasRenderedPreview = xlsxPreviewQuery.data?.item.status === 'RENDERED'
  const canPublishXlsx =
    Boolean(activeXlsxWorkbench) &&
    !isReadOnly &&
    !isXlsxPublished &&
    hasRenderedPreview
  const usedFieldPaths = new Set(
    scalarBindings.map((binding) => binding.fieldPath),
  )
  const tokenQuery = tokenSearch.trim().toLowerCase()
  const filteredTokens = XLSX_TOKEN_CATALOG.filter((token) => {
    const matchesGroup =
      activeTokenGroup === 'all' || token.group === activeTokenGroup
    const matchesQuery =
      !tokenQuery ||
      [token.path, token.label, token.description, token.groupLabel, token.kind]
        .join(' ')
        .toLowerCase()
        .includes(tokenQuery)

    return matchesGroup && matchesQuery
  })
  const copyToken = async (path: string) => {
    const token = `{{${path}}}`
    const copied = await copyTextToClipboard(token)

    if (!copied) {
      toast.error('Não foi possível copiar o token')
    }

    return copied
  }
  const updateScalarBinding = (
    bindingId: string,
    patch: Partial<XlsxScalarBinding>,
  ) => {
    setXlsxWorkbench((current) => {
      const base = current ?? activeXlsxWorkbench

      return base
        ? {
            ...base,
            manifest: {
              ...base.manifest,
              scalarBindings: base.manifest.scalarBindings.map((binding) =>
                binding.id === bindingId ? { ...binding, ...patch } : binding,
              ),
            },
          }
        : current
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-background p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">Templates de certificados</h1>
            {selectedTemplate?.isDefault && <Badge>Padrão</Badge>}
            {selectedTemplate && (
              <Badge variant="secondary">
                Template v{selectedTemplate.version}
              </Badge>
            )}
            {currentXlsxVersion && (
              <Badge variant="outline">
                XLSX v{currentXlsxVersion.version}
              </Badge>
            )}
            {isReadOnly && <Badge variant="outline">Somente leitura</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Use a planilha oficial do laboratório como fonte do layout do
            certificado e vincule os placeholders aos dados da calibração.
          </p>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <NativeSelect
            value={effectiveSelectedTemplateKey ?? ''}
            onChange={(event) => setSelectedTemplateKey(event.target.value)}
            className="min-w-56"
          >
            {templates.map((template) => (
              <NativeSelectOption
                key={templateKey(template)}
                value={templateKey(template)}
              >
                {template.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            type="button"
            variant="outline"
            onClick={() => duplicateMutation.mutate()}
            disabled={
              !canManageTemplates ||
              !selectedTemplate?.id ||
              duplicateMutation.isPending
            }
          >
            Duplicar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDefaultMutation.mutate()}
            disabled={
              !canManageTemplates ||
              !selectedTemplate?.id ||
              selectedTemplate.isDefault ||
              setDefaultMutation.isPending
            }
          >
            Tornar padrão
          </Button>
          <Button
            type="button"
            onClick={() => updateMutation.mutate()}
            disabled={
              !canManageTemplates ||
              isSystemTemplate ||
              !draft.name.trim() ||
              updateMutation.isPending
            }
          >
            Salvar
          </Button>
        </div>
      </div>

      {!canManageTemplates && (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          Templates personalizados ficam disponíveis a partir do plano
          Professional. A prévia permanece disponível para revisão.
        </div>
      )}

      <div className="grid gap-3 rounded-lg border bg-background p-3 md:grid-cols-[minmax(220px,360px)_auto] md:items-end">
        <label className="space-y-1">
          <span className="text-sm font-medium">Nome do template</span>
          <Input
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
            disabled={isReadOnly}
          />
        </label>

        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault()
            createMutation.mutate()
          }}
        >
          <Input
            value={newTemplateName}
            onChange={(event) => setNewTemplateName(event.target.value)}
            placeholder="Novo template"
            disabled={!canManageTemplates || createMutation.isPending}
            className="sm:w-64"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={
              !canManageTemplates ||
              !newTemplateName.trim() ||
              createMutation.isPending
            }
          >
            Criar
          </Button>
        </form>
      </div>

      <input
        ref={xlsxInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        disabled={isReadOnly || xlsxUploadMutation.isPending}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            xlsxUploadMutation.mutate(file)
          }
          event.currentTarget.value = ''
        }}
      />

      <div className="grid gap-3 rounded-lg border bg-background p-3 lg:grid-cols-[minmax(260px,360px)_1fr]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Template XLSX</h2>
              <p className="text-xs text-muted-foreground">
                Upload, análise e validação da pasta de certificado.
              </p>
            </div>
            {currentXlsxVersion && (
              <Badge variant="secondary">
                v{currentXlsxVersion.version} ·{' '}
                {getXlsxStatusLabel(currentXlsxVersion.status)}
              </Badge>
            )}
          </div>

          {currentXlsxVersion ? (
            <div className="rounded-lg bg-background p-3 text-xs shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_10px_24px_rgba(0,0,0,0.04)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.10)]">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    XLSX atual v{currentXlsxVersion.version}
                  </p>
                  <p className="text-muted-foreground">
                    Atualizado em {formatDateTime(currentXlsxVersion.updatedAt)}
                  </p>
                </div>
                <Badge
                  variant={
                    currentXlsxVersion.status === 'PUBLISHED'
                      ? 'default'
                      : 'secondary'
                  }
                >
                  {getXlsxStatusLabel(currentXlsxVersion.status)}
                </Badge>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-md bg-muted/45 p-2">
                  <dt className="text-muted-foreground">Abas</dt>
                  <dd className="font-medium tabular-nums">
                    {activeXlsxWorkbench?.analysis.sheets.length ??
                      currentXlsxVersion.sheetCount ??
                      0}
                  </dd>
                </div>
                <div className="rounded-md bg-muted/45 p-2">
                  <dt className="text-muted-foreground">Campos</dt>
                  <dd className="font-medium tabular-nums">
                    {(activeXlsxWorkbench
                      ? placeholderRows.length
                      : currentXlsxVersion.placeholderCount) ?? 0}
                  </dd>
                </div>
                <div className="rounded-md bg-muted/45 p-2">
                  <dt className="text-muted-foreground">Avisos</dt>
                  <dd className="font-medium tabular-nums">
                    {activeXlsxWorkbench?.analysis.warnings.length ??
                      currentXlsxVersion.warningCount ??
                      0}
                  </dd>
                </div>
              </dl>
              {isCurrentXlsxLoading && (
                <p className="mt-2 text-muted-foreground">
                  Carregando detalhes da versão...
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Nenhum XLSX foi carregado neste template ainda.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isReadOnly || xlsxUploadMutation.isPending}
              onClick={() => xlsxInputRef.current?.click()}
            >
              {xlsxUploadMutation.isPending ? 'Analisando...' : 'Enviar XLSX'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                isReadOnly ||
                !activeXlsxWorkbench ||
                isXlsxImmutable ||
                xlsxValidateMutation.isPending
              }
              onClick={() => xlsxValidateMutation.mutate()}
            >
              {xlsxValidateMutation.isPending ? 'Validando...' : 'Validar'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                isReadOnly ||
                !activeXlsxWorkbench ||
                xlsxPreviewMutation.isPending
              }
              onClick={() => xlsxPreviewMutation.mutate()}
            >
              {xlsxPreviewMutation.isPending ? 'Solicitando...' : 'Prévia PDF'}
            </Button>
          </div>

          {xlsxPreviewQuery.data && (
            <div className="rounded-md border bg-muted/20 p-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  Prévia {xlsxPreviewQuery.data.item.status}
                </span>
                {xlsxPreviewQuery.data.pdfUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    render={
                      <a
                        href={xlsxPreviewQuery.data.pdfUrl}
                        target="_blank"
                        rel="noreferrer"
                      />
                    }
                  >
                    Abrir PDF
                  </Button>
                )}
              </div>
              {xlsxPreviewQuery.data.item.error && (
                <p className="mt-2 text-destructive">
                  {xlsxPreviewQuery.data.item.error}
                </p>
              )}
            </div>
          )}

          {activeXlsxWorkbench ? (
            <div className="space-y-2">
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border bg-muted/20 p-2">
                  <dt className="text-muted-foreground">Abas</dt>
                  <dd className="font-medium">
                    {activeXlsxWorkbench.analysis.sheets.length}
                  </dd>
                </div>
                <div className="rounded-md border bg-muted/20 p-2">
                  <dt className="text-muted-foreground">Campos</dt>
                  <dd className="font-medium">{placeholderRows.length}</dd>
                </div>
                <div className="rounded-md border bg-muted/20 p-2">
                  <dt className="text-muted-foreground">Avisos</dt>
                  <dd className="font-medium">
                    {activeXlsxWorkbench.analysis.warnings.length}
                  </dd>
                </div>
                <div className="rounded-md border bg-muted/20 p-2">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="font-medium">
                    {getXlsxStatusLabel(activeXlsxWorkbench.version.status)}
                  </dd>
                </div>
              </dl>
              {activeXlsxWorkbench.analysis.warnings.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
                  {activeXlsxWorkbench.analysis.warnings
                    .slice(0, 4)
                    .map((warning) => (
                      <p
                        key={`${warning.code}-${warning.sheet ?? ''}-${warning.cell ?? ''}`}
                      >
                        {warning.message}
                      </p>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Envie a planilha criada pelo laboratório para detectar abas,
              intervalos usados e placeholders.
            </div>
          )}

          <XlsxAssignmentPanel
            disabled={isReadOnly || !activeXlsxWorkbench}
            isPublished={isXlsxPublished}
            canPublish={canPublishXlsx}
            hasRenderedPreview={Boolean(hasRenderedPreview)}
            publishPending={xlsxPublishMutation.isPending}
            assignmentPending={xlsxAssignmentMutation.isPending}
            draft={assignmentDraft}
            methods={methodsQuery.data ?? []}
            services={servicesQuery.data ?? []}
            units={unitsQuery.data ?? []}
            optionsLoading={
              methodsQuery.isLoading ||
              servicesQuery.isLoading ||
              unitsQuery.isLoading
            }
            optionsError={
              methodsQuery.isError ||
              servicesQuery.isError ||
              unitsQuery.isError
            }
            onDraftChange={setAssignmentDraft}
            onPublish={() => xlsxPublishMutation.mutate()}
            onAssign={() => xlsxAssignmentMutation.mutate()}
          />
        </div>

        <div className="min-w-0 space-y-3">
          <TokenLibrary
            search={tokenSearch}
            onSearchChange={setTokenSearch}
            activeGroup={activeTokenGroup}
            onActiveGroupChange={setActiveTokenGroup}
            tokens={filteredTokens}
            usedFieldPaths={usedFieldPaths}
            onCopyToken={copyToken}
          />

          <div className="rounded-md border">
            <div className="grid grid-cols-[1.1fr_80px_1fr] border-b bg-muted/30 px-3 py-2 text-xs font-medium">
              <span>Aba detectada</span>
              <span>Célula</span>
              <span>Placeholder</span>
            </div>
            <div className="max-h-40 overflow-auto">
              {placeholderRows.length > 0 ? (
                placeholderRows.slice(0, 40).map((placeholder) => (
                  <div
                    key={`${placeholder.sheet}:${placeholder.cell}:${placeholder.fieldPath}`}
                    className="grid grid-cols-[1.1fr_80px_1fr] gap-2 border-b px-3 py-2 text-xs last:border-0"
                  >
                    <span className="truncate">{placeholder.sheet}</span>
                    <span className="font-mono">{placeholder.cell}</span>
                    <span className="truncate font-mono">
                      {placeholder.fieldPath}
                    </span>
                  </div>
                ))
              ) : (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Nenhum placeholder detectado.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-md border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
              <span className="text-xs font-medium">Vínculos escalares</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  isReadOnly ||
                  !activeXlsxWorkbench ||
                  isXlsxImmutable ||
                  xlsxBindingSaveMutation.isPending
                }
                onClick={() => xlsxBindingSaveMutation.mutate()}
              >
                {xlsxBindingSaveMutation.isPending
                  ? 'Salvando...'
                  : 'Salvar vínculos'}
              </Button>
            </div>
            <div className="max-h-64 overflow-auto">
              {scalarBindings.length > 0 ? (
                scalarBindings.map((binding) => (
                  <div
                    key={binding.id}
                    className="grid gap-2 border-b px-3 py-2 text-xs last:border-0 md:grid-cols-[1fr_72px_1.1fr_120px_80px]"
                  >
                    <Input
                      value={binding.sheet}
                      disabled={isReadOnly || isXlsxImmutable}
                      className="h-8 text-xs"
                      onChange={(event) =>
                        updateScalarBinding(binding.id, {
                          sheet: event.target.value,
                        })
                      }
                    />
                    <Input
                      value={binding.cell}
                      disabled={isReadOnly || isXlsxImmutable}
                      className="h-8 font-mono text-xs"
                      onChange={(event) =>
                        updateScalarBinding(binding.id, {
                          cell: event.target.value,
                        })
                      }
                    />
                    <Input
                      value={binding.fieldPath}
                      disabled={isReadOnly || isXlsxImmutable}
                      className="h-8 font-mono text-xs"
                      onChange={(event) =>
                        updateScalarBinding(binding.id, {
                          fieldPath: event.target.value,
                        })
                      }
                    />
                    <Input
                      value={binding.formatter ?? ''}
                      placeholder="formatter"
                      disabled={isReadOnly || isXlsxImmutable}
                      className="h-8 text-xs"
                      onChange={(event) =>
                        updateScalarBinding(binding.id, {
                          formatter: event.target.value || undefined,
                        })
                      }
                    />
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={Boolean(binding.required)}
                        disabled={isReadOnly || isXlsxImmutable}
                        onCheckedChange={(checked) =>
                          updateScalarBinding(binding.id, {
                            required: Boolean(checked),
                          })
                        }
                      />
                      <span>Obrig.</span>
                    </label>
                  </div>
                ))
              ) : (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Envie um XLSX com placeholders para gerar vínculos iniciais.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function XlsxAssignmentPanel({
  disabled,
  isPublished,
  canPublish,
  hasRenderedPreview,
  publishPending,
  assignmentPending,
  draft,
  methods,
  services,
  units,
  optionsLoading,
  optionsError,
  onDraftChange,
  onPublish,
  onAssign,
}: {
  disabled: boolean
  isPublished: boolean
  canPublish: boolean
  hasRenderedPreview: boolean
  publishPending: boolean
  assignmentPending: boolean
  draft: XlsxAssignmentDraft
  methods: XlsxAssignmentOption[]
  services: XlsxAssignmentOption[]
  units: XlsxAssignmentOption[]
  optionsLoading: boolean
  optionsError: boolean
  onDraftChange: (draft: XlsxAssignmentDraft) => void
  onPublish: () => void
  onAssign: () => void
}) {
  const formDisabled = disabled || !isPublished || assignmentPending
  const selectedScopeCount = [
    draft.unitId,
    draft.serviceId,
    draft.methodId,
  ].filter(Boolean).length

  const updateDraft = (patch: Partial<XlsxAssignmentDraft>) => {
    onDraftChange({ ...draft, ...patch })
  }

  return (
    <section className="rounded-lg bg-background shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_10px_28px_rgba(0,0,0,0.05)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.10)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-3 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Publicação e atribuição</h2>
            <Badge variant={isPublished ? 'default' : 'secondary'}>
              {isPublished ? 'Publicado' : 'Não publicado'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Defina quais calibrações usam esta versão XLSX quando o certificado
            for emitido.
          </p>
        </div>
        <Button
          type="button"
          variant={isPublished ? 'outline' : 'default'}
          size="sm"
          disabled={disabled || isPublished || !canPublish || publishPending}
          onClick={onPublish}
        >
          {publishPending
            ? 'Publicando...'
            : isPublished
              ? 'Publicado'
              : 'Publicar versão'}
        </Button>
      </div>

      {!isPublished && (
        <div className="border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {hasRenderedPreview
            ? 'Prévia concluída. Publique a versão para liberar a atribuição.'
            : 'Valide o XLSX e gere uma prévia PDF concluída antes de publicar.'}
        </div>
      )}

      {optionsError && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Não foi possível carregar todos os métodos, serviços ou unidades.
          Atualize a página e tente novamente.
        </div>
      )}

      <form
        className="space-y-3 px-3 py-3"
        onSubmit={(event) => {
          event.preventDefault()
          onAssign()
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium">Método</span>
            <NativeSelect
              value={draft.methodId}
              disabled={formDisabled || optionsLoading}
              onChange={(event) =>
                updateDraft({ methodId: event.target.value })
              }
              className="h-9 text-xs"
            >
              <NativeSelectOption value="">Todos os métodos</NativeSelectOption>
              {methods.map((method) => (
                <NativeSelectOption key={method.id} value={String(method.id)}>
                  {method.label}
                  {method.detail ? ` · ${method.detail}` : ''}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium">Serviço</span>
            <NativeSelect
              value={draft.serviceId}
              disabled={formDisabled || optionsLoading}
              onChange={(event) =>
                updateDraft({ serviceId: event.target.value })
              }
              className="h-9 text-xs"
            >
              <NativeSelectOption value="">
                Todos os serviços
              </NativeSelectOption>
              {services.map((service) => (
                <NativeSelectOption key={service.id} value={String(service.id)}>
                  {service.label}
                  {service.detail ? ` · ${service.detail}` : ''}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium">Unidade</span>
            <NativeSelect
              value={draft.unitId}
              disabled={formDisabled || optionsLoading}
              onChange={(event) => updateDraft({ unitId: event.target.value })}
              className="h-9 text-xs"
            >
              <NativeSelectOption value="">
                Todas as unidades
              </NativeSelectOption>
              {units.map((unit) => (
                <NativeSelectOption key={unit.id} value={String(unit.id)}>
                  {unit.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium">Prioridade</span>
            <Input
              type="number"
              inputMode="numeric"
              value={draft.priority}
              disabled={formDisabled}
              onChange={(event) =>
                updateDraft({ priority: event.target.value })
              }
              className="h-9 text-xs tabular-nums"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded bg-muted px-2 py-1">
              {selectedScopeCount === 0
                ? 'Escopo amplo'
                : `${selectedScopeCount} filtro${selectedScopeCount === 1 ? '' : 's'}`}
            </span>
            <span className="rounded bg-muted px-2 py-1">
              Maior prioridade vence
            </span>
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={formDisabled || optionsLoading}
          >
            {assignmentPending ? 'Atribuindo...' : 'Atribuir versão'}
          </Button>
        </div>
      </form>
    </section>
  )
}

function TokenLibrary({
  search,
  onSearchChange,
  activeGroup,
  onActiveGroupChange,
  tokens,
  usedFieldPaths,
  onCopyToken,
}: {
  search: string
  onSearchChange: (value: string) => void
  activeGroup: string
  onActiveGroupChange: (value: string) => void
  tokens: XlsxTokenCatalogItem[]
  usedFieldPaths: Set<string>
  onCopyToken: (path: string) => Promise<boolean> | boolean
}) {
  const [copiedTokenPath, setCopiedTokenPath] = useState<string | null>(null)
  const copiedResetTimerRef = useRef<number | null>(null)

  useMountEffect(() => {
    return () => {
      if (copiedResetTimerRef.current !== null) {
        window.clearTimeout(copiedResetTimerRef.current)
      }
    }
  })

  const handleCopyToken = async (path: string) => {
    const copied = await onCopyToken(path)

    if (!copied) return

    setCopiedTokenPath(path)
    if (copiedResetTimerRef.current !== null) {
      window.clearTimeout(copiedResetTimerRef.current)
    }
    copiedResetTimerRef.current = window.setTimeout(() => {
      setCopiedTokenPath(null)
      copiedResetTimerRef.current = null
    }, 1200)
  }

  return (
    <section className="overflow-hidden rounded-lg bg-background shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_10px_30px_rgba(0,0,0,0.06)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.10)]">
      <div className="grid gap-3 border-b bg-[linear-gradient(135deg,hsl(var(--muted))_0%,hsl(var(--background))_68%)] px-3 py-3 md:grid-cols-[1fr_280px] md:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-[0_6px_18px_hsl(var(--primary)/0.24)]">
              <HugeiconsIcon icon={BookOpen02Icon} className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-wrap-balance text-sm font-semibold">
                Biblioteca de tokens
              </h2>
              <p className="text-xs text-muted-foreground">
                Copie um token e cole na célula do XLSX no formato{' '}
                <code className="rounded bg-background px-1 py-0.5 font-mono text-[11px] text-foreground">
                  {'{{asset.serialNumber}}'}
                </code>
                .
              </p>
            </div>
          </div>
        </div>

        <label className="relative block">
          <HugeiconsIcon
            icon={SearchIcon}
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar token, campo ou seção"
            className="h-9 pl-8 text-sm"
          />
        </label>
      </div>

      <div className="border-b px-3 py-2">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {tokenGroups.map((group) => {
            const count =
              group.value === 'all'
                ? XLSX_TOKEN_CATALOG.length
                : XLSX_TOKEN_CATALOG.filter(
                    (token) => token.group === group.value,
                  ).length

            return (
              <button
                key={group.value}
                type="button"
                onClick={() => onActiveGroupChange(group.value)}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.96]',
                  activeGroup === group.value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <span>{group.label}</span>
                <span className="rounded bg-background/20 px-1 font-mono text-[10px] tabular-nums">
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="max-h-72 overflow-auto">
        {tokens.length > 0 ? (
          <div className="divide-y">
            {tokens.map((token) => {
              const isUsed = usedFieldPaths.has(token.path)
              const isCopied = copiedTokenPath === token.path
              return (
                <div
                  key={token.path}
                  className="grid gap-2 px-3 py-2.5 transition-[background-color] hover:bg-muted/40 md:grid-cols-[minmax(180px,1fr)_minmax(220px,1.2fr)_96px]"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <HugeiconsIcon
                        icon={isUsed ? Database02Icon : CodeSquareIcon}
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="truncate text-sm font-medium">
                        {token.label}
                      </span>
                      {isUsed && (
                        <Badge
                          variant="secondary"
                          className="h-4 px-1 text-[10px]"
                        >
                          Em uso
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {token.description}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleCopyToken(token.path)}
                    className="group/token flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-md bg-primary/10 px-2 text-left font-mono text-xs text-primary ring-1 ring-primary/15 transition-[background-color,box-shadow] hover:bg-primary/15 active:bg-primary/20"
                    aria-label={
                      isCopied
                        ? `Token ${token.path} copiado`
                        : `Copiar token ${token.path}`
                    }
                  >
                    <span className="truncate">{`{{${token.path}}}`}</span>
                    <HugeiconsIcon
                      icon={isCopied ? Tick02Icon : Copy01Icon}
                      className={cn(
                        'size-4 shrink-0 transition-[color,transform]',
                        isCopied
                          ? 'scale-110 text-primary'
                          : 'text-primary/70 group-hover/token:text-primary group-active/token:scale-90',
                      )}
                    />
                  </button>

                  <div className="flex items-center justify-between gap-2 md:justify-end">
                    <Badge variant="outline" className="font-normal">
                      {token.kind}
                    </Badge>
                    {token.example && (
                      <span className="max-w-28 truncate text-right text-xs text-muted-foreground">
                        {token.example}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            Nenhum token encontrado para esta busca.
          </div>
        )}
      </div>
    </section>
  )
}

function DesignerSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-[760px] w-full" />
    </div>
  )
}
