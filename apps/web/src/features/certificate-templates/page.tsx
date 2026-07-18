import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertCircleIcon,
  BookOpen02Icon,
  CheckmarkCircle02Icon,
  CloudUploadIcon,
  CodeSquareIcon,
  Copy01Icon,
  Database02Icon,
  DocumentValidationIcon,
  Link01Icon,
  LinkSquare02Icon,
  RocketIcon,
  SearchIcon,
  Table01Icon,
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
import {
  ACTION_BUTTON_CLASS,
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { usePlanAccess } from '@/hooks/use-plan-access'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { calibraApi } from '@/utils/api'
import { isWysiwygEditorEnabled } from './wysiwyg-flag'
import { cn } from '@/lib/utils'
import {
  useCertificateTemplateAssignmentOptions,
  useCertificateTemplatesData,
  useCertificateTemplateXlsxPreviewData,
  useCertificateTemplateXlsxVersionData,
} from '@/features/certificate-templates/queries'
import {
  buildXlsxAssignmentPayload,
  buildXlsxBindingManifestForSave,
  certificateTemplateKey,
  copyTextToClipboard,
  createEmptyCertificateTemplateDraft,
  createCertificateTemplateDraft,
  formatCertificateTemplateDateTime,
  getActiveCertificateTemplateXlsxPreviewId,
  getActiveCertificateTemplateXlsxWorkbench,
  getDefaultCertificateTemplateKey,
  getSelectedCertificateTemplate,
  getXlsxStatusLabel,
  updateXlsxScalarBinding,
  type TemplateDraft,
  type XlsxAssignmentDraft,
} from '@/features/certificate-templates/model'
import {
  XLSX_TOKEN_CATALOG,
  xlsxTokenGroups,
  type XlsxTokenCatalogItem,
} from '@/features/certificate-templates/token-catalog'
import type {
  TemplateItem,
  WorkbookAnalysis,
  XlsxAssignmentOption,
  XlsxBindingManifest,
  XlsxPreviewItem,
  XlsxPreviewReference,
  XlsxScalarBinding,
  XlsxVersionSummary,
  XlsxWorkbenchState,
} from '@/features/certificate-templates/types'

type StageId = 'source' | 'mapping' | 'verify' | 'publish'

const CERTIFICATE_STAGES: ReadonlyArray<{
  id: StageId
  label: string
  hint: string
  icon: typeof CloudUploadIcon
}> = [
  {
    id: 'source',
    label: 'Planilha',
    hint: 'Layout oficial',
    icon: CloudUploadIcon,
  },
  {
    id: 'mapping',
    label: 'Vínculos',
    hint: 'Campos × dados',
    icon: Link01Icon,
  },
  {
    id: 'verify',
    label: 'Verificação',
    hint: 'Validar e prever',
    icon: DocumentValidationIcon,
  },
  {
    id: 'publish',
    label: 'Publicação',
    hint: 'Publicar e atribuir',
    icon: RocketIcon,
  },
]

export function CertificateTemplatesPage() {
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
  const navigate = useNavigate()
  const [xlsxWorkbench, setXlsxWorkbench] = useState<XlsxWorkbenchState | null>(
    null,
  )
  const [xlsxPreview, setXlsxPreview] = useState<XlsxPreviewReference | null>(
    null,
  )
  const [tokenSearch, setTokenSearch] = useState('')
  const [activeTokenGroup, setActiveTokenGroup] = useState('all')
  const [activeStage, setActiveStage] = useState<StageId | null>(null)
  const [assignmentDraft, setAssignmentDraft] = useState<XlsxAssignmentDraft>({
    unitId: '',
    serviceId: '',
    methodId: '',
    priority: '100',
  })
  const [draftsByTemplateKey, setDraftsByTemplateKey] = useState<
    Record<string, TemplateDraft>
  >({})

  const templatesQuery = useCertificateTemplatesData({
    enabled: !cloudOnlyUnavailable,
  })

  const templates = useMemo(
    () => templatesQuery.data?.items ?? [],
    [templatesQuery.data?.items],
  )
  const defaultTemplateKey = useMemo(
    () => getDefaultCertificateTemplateKey(templates),
    [templates],
  )
  const effectiveSelectedTemplateKey = selectedTemplateKey ?? defaultTemplateKey
  const selectedTemplate = useMemo(
    () =>
      getSelectedCertificateTemplate({
        templates,
        selectedTemplateKey: effectiveSelectedTemplateKey,
      }),
    [effectiveSelectedTemplateKey, templates],
  )
  const canManageTemplateActions =
    (accessQuery.data?.hasCustomTemplates ?? false) &&
    (templatesQuery.data?.canManage ?? false)
  const assignmentOptionsEnabled = !cloudOnlyUnavailable
  const { methodsQuery, servicesQuery, unitsQuery } =
    useCertificateTemplateAssignmentOptions({
      enabled: assignmentOptionsEnabled,
    })
  const selectedCurrentXlsxVersionId =
    selectedTemplate?.currentXlsxVersion?.id ?? null
  const currentXlsxVersionQuery = useCertificateTemplateXlsxVersionData({
    templateId: selectedTemplate?.id,
    versionId: selectedCurrentXlsxVersionId,
    enabled:
      !cloudOnlyUnavailable &&
      Boolean(selectedTemplate?.id && selectedCurrentXlsxVersionId),
  })
  const activeXlsxWorkbench = useMemo(
    () =>
      getActiveCertificateTemplateXlsxWorkbench({
        currentXlsxWorkbench: currentXlsxVersionQuery.data,
        selectedTemplate,
        xlsxWorkbench,
      }),
    [currentXlsxVersionQuery.data, selectedTemplate, xlsxWorkbench],
  )
  const activeXlsxPreviewId = getActiveCertificateTemplateXlsxPreviewId({
    activeXlsxWorkbench,
    selectedTemplate,
    xlsxPreview,
  })
  const xlsxPreviewQuery = useCertificateTemplateXlsxPreviewData({
    templateId: selectedTemplate?.id,
    versionId: activeXlsxWorkbench?.version.id,
    previewId: activeXlsxPreviewId,
    enabled:
      !cloudOnlyUnavailable &&
      Boolean(
        selectedTemplate?.id &&
        activeXlsxWorkbench?.version.id &&
        activeXlsxPreviewId,
      ),
  })
  const draft =
    selectedTemplate && effectiveSelectedTemplateKey
      ? (draftsByTemplateKey[effectiveSelectedTemplateKey] ??
        createCertificateTemplateDraft(selectedTemplate))
      : createEmptyCertificateTemplateDraft()

  const setDraft = (
    updater: TemplateDraft | ((current: TemplateDraft) => TemplateDraft),
  ) => {
    if (!selectedTemplate || !effectiveSelectedTemplateKey) return

    setDraftsByTemplateKey((current) => {
      const base =
        current[effectiveSelectedTemplateKey] ??
        createCertificateTemplateDraft(selectedTemplate)
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

      const data = await calibraApi.certificateTemplates.uploadXlsx<{
        item: XlsxVersionSummary
        analysis: WorkbookAnalysis
        bindingManifest: XlsxBindingManifest
      }>(selectedTemplate.id, file, { fileName: file.name })
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
      setActiveStage('mapping')
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

      return calibraApi.certificateTemplates.validateXlsx<{
        item: XlsxVersionSummary
        analysis: WorkbookAnalysis
        validation: { ok: boolean; warnings: unknown[] }
      }>(selectedTemplate.id, activeXlsxWorkbench.version.id)
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

      const manifest = buildXlsxBindingManifestForSave(
        activeXlsxWorkbench.manifest,
      )
      return calibraApi.certificateTemplates.updateXlsxBindings<{
        item: XlsxVersionSummary
      }>(selectedTemplate.id, activeXlsxWorkbench.version.id, { manifest })
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

      return calibraApi.certificateTemplates.createXlsxPreview<{
        item: XlsxPreviewItem
      }>(selectedTemplate.id, activeXlsxWorkbench.version.id, {
        sampleData: {},
      })
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

      return calibraApi.certificateTemplates.publishXlsx<{
        item: XlsxVersionSummary
      }>(selectedTemplate.id, activeXlsxWorkbench.version.id)
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

      const payload = buildXlsxAssignmentPayload(assignmentDraft)

      return calibraApi.certificateTemplates.createXlsxAssignment<{
        item: unknown
      }>(selectedTemplate.id, activeXlsxWorkbench.version.id, payload)
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
      return calibraApi.certificateTemplates.create<{ item: TemplateItem }>({
        name,
      })
    },
    onSuccess: async (data) => {
      toast.success('Template criado')
      setNewTemplateName('')
      setSelectedTemplateKey(certificateTemplateKey(data.item))
      setActiveStage('source')
      await refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao criar template',
      )
    },
  })

  const migrateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate?.id) throw new Error('Nenhum template selecionado')
      return calibraApi.certificateTemplates.migrateToWysiwyg<{
        item: TemplateItem
        importedPaths: string[]
        skippedPaths: string[]
      }>(selectedTemplate.id)
    },
    onSuccess: async (data) => {
      toast.success(
        `Template migrado — ${data.importedPaths.length} campos importados`,
      )
      await refreshTemplates()
      await navigate({
        to: '/dashboard/certificate-templates/$slug/editor',
        params: { slug: data.item.slug },
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao migrar template',
      )
    },
  })

  const createWysiwygMutation = useMutation({
    mutationFn: async () => {
      const name = newTemplateName.trim()
      return calibraApi.certificateTemplates.create<{
        item: TemplateItem
        initialVersion: { id: number } | null
      }>({ name, engine: 'wysiwyg' })
    },
    onSuccess: async (data) => {
      toast.success('Modelo criado no editor visual')
      setNewTemplateName('')
      await refreshTemplates()
      if (data.item.id) {
        await navigate({
          to: '/dashboard/certificate-templates/$slug/editor',
          params: { slug: data.item.slug },
        })
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao criar modelo',
      )
    },
  })

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate?.id) {
        throw new Error('Selecione um template editável')
      }

      return calibraApi.certificateTemplates.update<{ item: TemplateItem }>(
        selectedTemplate.id,
        { name: draft.name.trim() },
      )
    },
    onSuccess: async (data) => {
      toast.success('Template salvo')
      setSelectedTemplateKey(certificateTemplateKey(data.item))
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

      return calibraApi.certificateTemplates.duplicate<{
        item: TemplateItem
      }>(selectedTemplate.id)
    },
    onSuccess: async (data) => {
      toast.success('Template duplicado')
      setSelectedTemplateKey(certificateTemplateKey(data.item))
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

      await calibraApi.certificateTemplates.setDefault(selectedTemplate.id)
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

      return base ? updateXlsxScalarBinding(base, bindingId, patch) : current
    })
  }

  // — Lifecycle of the controlled certificate template (document control) —
  const hasWorkbench = Boolean(activeXlsxWorkbench)
  const detectedCount = placeholderRows.length
  const boundCount = scalarBindings.filter(
    (binding) => binding.fieldPath.trim().length > 0,
  ).length
  const requiredPending = scalarBindings.filter(
    (binding) => binding.required && binding.fieldPath.trim().length === 0,
  ).length
  const warningCount =
    activeXlsxWorkbench?.analysis.warnings.length ??
    currentXlsxVersion?.warningCount ??
    0
  const sheetCount =
    activeXlsxWorkbench?.analysis.sheets.length ??
    currentXlsxVersion?.sheetCount ??
    0
  const fieldCount = activeXlsxWorkbench
    ? detectedCount
    : (currentXlsxVersion?.placeholderCount ?? 0)
  const mappingComplete = scalarBindings.length > 0 && requiredPending === 0
  const fullyBound =
    scalarBindings.length > 0 && boundCount === scalarBindings.length
  // Verification is concluded once the version reached a validated/published
  // state on the server — not just when a preview was rendered this session.
  const xlsxStatus = currentXlsxVersion?.status
  const isXlsxVerified =
    xlsxStatus === 'VALIDATED' ||
    xlsxStatus === 'PUBLISHED' ||
    xlsxStatus === 'ARCHIVED' ||
    Boolean(hasRenderedPreview)

  const stageDone: Record<StageId, boolean> = {
    source: Boolean(currentXlsxVersion),
    mapping: mappingComplete,
    verify: isXlsxVerified,
    publish: isXlsxPublished,
  }
  const stageBlocked: Record<StageId, boolean> = {
    source: false,
    mapping: !currentXlsxVersion,
    verify: !currentXlsxVersion,
    publish: !isXlsxPublished && !canPublishXlsx,
  }
  const defaultStage: StageId = !currentXlsxVersion
    ? 'source'
    : !mappingComplete
      ? 'mapping'
      : !isXlsxVerified
        ? 'verify'
        : 'publish'
  const effectiveStage: StageId = activeStage ?? defaultStage
  const templateNameDirty =
    !isReadOnly &&
    draft.name.trim().length > 0 &&
    draft.name.trim() !== (selectedTemplate?.name ?? '')
  const showTokenAside =
    hasWorkbench &&
    (effectiveStage === 'mapping' || effectiveStage === 'verify')
  const goToSource = () => setActiveStage('source')

  const warningsPreview =
    activeXlsxWorkbench?.analysis.warnings.slice(0, 4) ?? []

  return (
    <div className="space-y-5">
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

      {/* Identity + lifecycle status */}
      <Panel className="relative overflow-hidden p-6">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Certificados
            </p>
            {isReadOnly ? (
              <h1 className="mt-0.5 text-balance text-2xl font-semibold tracking-tight">
                {selectedTemplate?.name ?? 'Template de certificado'}
              </h1>
            ) : (
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                aria-label="Nome do template"
                placeholder="Nome do template"
                className="-mx-1 mt-0.5 w-full max-w-xl rounded-md bg-transparent px-1 text-balance text-2xl font-semibold tracking-tight outline-none focus:bg-background/70 focus:ring-2 focus:ring-ring/40"
              />
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {selectedTemplate?.isDefault && <Badge>Padrão</Badge>}
              {selectedTemplate && (
                <Badge variant="secondary">
                  Template v{selectedTemplate.version}
                </Badge>
              )}
              {currentXlsxVersion && (
                <Badge variant="outline">
                  XLSX v{currentXlsxVersion.version} ·{' '}
                  {getXlsxStatusLabel(currentXlsxVersion.status)}
                </Badge>
              )}
              {isReadOnly && <Badge variant="outline">Somente leitura</Badge>}
            </div>
            <p className="mt-2 max-w-2xl text-pretty text-sm text-muted-foreground">
              A planilha oficial do laboratório é o layout do certificado; cada
              célula com placeholder vira um dado da calibração quando o
              certificado é emitido.
            </p>
          </div>
          {templateNameDirty && (
            <Button
              className={`${ACTION_BUTTON_CLASS} shrink-0`}
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending || !draft.name.trim()}
            >
              {updateMutation.isPending ? 'Salvando...' : 'Salvar nome'}
            </Button>
          )}
        </div>
      </Panel>

      {/* Template library controls */}
      <Panel className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Template
          </span>
          <NativeSelect
            value={effectiveSelectedTemplateKey ?? ''}
            onChange={(event) => {
              setSelectedTemplateKey(event.target.value)
              setActiveStage(null)
            }}
            className="min-w-56"
          >
            {templates.map((template) => (
              <NativeSelectOption
                key={certificateTemplateKey(template)}
                value={certificateTemplateKey(template)}
              >
                {template.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            type="button"
            variant="outline"
            size="sm"
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
            size="sm"
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
          {isWysiwygEditorEnabled() &&
            selectedTemplate?.id &&
            selectedTemplate.currentXlsxVersion?.engine !== 'wysiwyg' &&
            (selectedTemplate.wysiwygVersions?.length ?? 0) === 0 &&
            selectedTemplate.currentXlsxVersion != null && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => migrateMutation.mutate()}
                disabled={!canManageTemplates || migrateMutation.isPending}
              >
                {migrateMutation.isPending
                  ? 'Migrando…'
                  : 'Migrar para o editor visual'}
              </Button>
            )}
          {isWysiwygEditorEnabled() &&
            selectedTemplate?.id &&
            ((selectedTemplate.wysiwygVersions?.length ?? 0) > 0 ||
              selectedTemplate.currentXlsxVersion?.engine === 'wysiwyg') && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  navigate({
                    to: '/dashboard/certificate-templates/$slug/editor',
                    params: { slug: selectedTemplate.slug },
                  })
                }
              >
                {selectedTemplate.wysiwygVersions?.some(
                  (version) => version.status === 'DRAFT',
                )
                  ? 'Abrir rascunho no editor'
                  : 'Abrir no editor'}
              </Button>
            )}
        </div>

        {canManageTemplates && (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              createMutation.mutate()
            }}
          >
            <Input
              value={newTemplateName}
              onChange={(event) => setNewTemplateName(event.target.value)}
              placeholder="Novo template"
              disabled={createMutation.isPending}
              className="h-9 w-44 sm:w-56"
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={!newTemplateName.trim() || createMutation.isPending}
            >
              Criar
            </Button>
            {isWysiwygEditorEnabled() && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => createWysiwygMutation.mutate()}
                disabled={
                  !newTemplateName.trim() || createWysiwygMutation.isPending
                }
              >
                Criar no editor visual
              </Button>
            )}
          </form>
        )}
      </Panel>

      {!canManageTemplates && (
        <div className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
          Templates personalizados ficam disponíveis a partir do plano
          Professional. A prévia permanece disponível para revisão.
        </div>
      )}

      {/* Lifecycle rail */}
      <Panel className="p-2">
        <nav
          className="flex items-stretch gap-1 overflow-x-auto"
          aria-label="Etapas do template de certificado"
        >
          {CERTIFICATE_STAGES.map((stage, index) => {
            const done = stageDone[stage.id]
            const blocked = stageBlocked[stage.id] && !done
            const active = stage.id === effectiveStage

            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => setActiveStage(stage.id)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'group flex min-w-[8.5rem] flex-1 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-[background-color,box-shadow,transform] active:scale-[0.99]',
                  active
                    ? 'bg-background shadow-[0_0_0_1px_rgba(15,23,42,0.10),0_10px_24px_rgba(15,23,42,0.06)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]'
                    : 'hover:bg-background/60',
                )}
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                    done
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : active
                        ? 'bg-primary text-primary-foreground'
                        : blocked
                          ? 'bg-muted text-muted-foreground/50'
                          : 'bg-muted text-muted-foreground',
                  )}
                >
                  <HugeiconsIcon
                    icon={done ? CheckmarkCircle02Icon : stage.icon}
                    className="size-4"
                  />
                </span>
                <span className="min-w-0">
                  <span className="block font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Etapa {index + 1}
                  </span>
                  <span className="block truncate text-sm font-medium">
                    {stage.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {stage.hint}
                  </span>
                </span>
              </button>
            )
          })}
        </nav>
      </Panel>

      {/* Active stage workspace */}
      <div
        className={cn(
          'grid gap-4',
          showTokenAside && 'lg:grid-cols-[1fr_minmax(280px,360px)]',
        )}
      >
        <div className="min-w-0 space-y-4">
          {effectiveStage === 'source' && (
            <Panel className="p-5">
              <PanelHeader
                eyebrow="Etapa 1"
                title="Planilha do certificado"
                description="Envie a planilha oficial (.xlsx). Ela define o layout e vira a base versionada deste template."
                action={
                  <Button
                    type="button"
                    className={ACTION_BUTTON_CLASS}
                    disabled={isReadOnly || xlsxUploadMutation.isPending}
                    onClick={() => xlsxInputRef.current?.click()}
                  >
                    <HugeiconsIcon
                      icon={CloudUploadIcon}
                      className="mr-2 size-4"
                    />
                    {xlsxUploadMutation.isPending
                      ? 'Analisando...'
                      : currentXlsxVersion
                        ? 'Enviar nova versão'
                        : 'Enviar XLSX'}
                  </Button>
                }
              />
              <div className="mt-4">
                {currentXlsxVersion ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          XLSX v{currentXlsxVersion.version}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Atualizado em{' '}
                          {formatCertificateTemplateDateTime(
                            currentXlsxVersion.updatedAt,
                          )}
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
                    <StaggerGroup className="mt-4 grid gap-3 sm:grid-cols-3">
                      <StaggerItem>
                        <SignalTile
                          icon={Table01Icon}
                          label="Abas"
                          value={sheetCount}
                          tone="neutral"
                        />
                      </StaggerItem>
                      <StaggerItem>
                        <SignalTile
                          icon={Database02Icon}
                          label="Campos detectados"
                          value={fieldCount}
                          tone="info"
                        />
                      </StaggerItem>
                      <StaggerItem>
                        <SignalTile
                          icon={AlertCircleIcon}
                          label="Avisos"
                          value={warningCount}
                          tone={warningCount > 0 ? 'warning' : 'ok'}
                        />
                      </StaggerItem>
                    </StaggerGroup>
                    {isCurrentXlsxLoading && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Carregando detalhes da versão...
                      </p>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={isReadOnly || xlsxUploadMutation.isPending}
                    onClick={() => xlsxInputRef.current?.click()}
                    className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 px-6 py-12 text-center transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <HugeiconsIcon
                        icon={CloudUploadIcon}
                        className="size-6"
                      />
                    </span>
                    <span className="text-sm font-medium">
                      Envie a planilha oficial do certificado
                    </span>
                    <span className="max-w-sm text-xs text-muted-foreground">
                      Detectamos as abas, intervalos usados e placeholders{' '}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono">
                        {'{{...}}'}
                      </code>{' '}
                      para você vincular aos dados da calibração.
                    </span>
                  </button>
                )}

                {warningsPreview.length > 0 && (
                  <div className="mt-4 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                    <p className="font-medium">Avisos da análise</p>
                    {warningsPreview.map((warning) => (
                      <p
                        key={`${warning.code}-${warning.sheet ?? ''}-${warning.cell ?? ''}`}
                      >
                        {warning.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          )}

          {effectiveStage === 'mapping' &&
            (hasWorkbench ? (
              <Panel className="p-5">
                <PanelHeader
                  eyebrow="Etapa 2"
                  title="Mapa de campos"
                  description="Cada placeholder da planilha aponta para um dado da calibração. Copie tokens da biblioteca ao lado para preencher as células."
                  action={
                    <Button
                      type="button"
                      className={ACTION_BUTTON_CLASS}
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
                  }
                />

                <StaggerGroup className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StaggerItem>
                    <SignalTile
                      icon={Table01Icon}
                      label="Detectados"
                      value={detectedCount}
                      tone="neutral"
                    />
                  </StaggerItem>
                  <StaggerItem>
                    <SignalTile
                      icon={Link01Icon}
                      label="Vinculados"
                      value={`${boundCount}/${scalarBindings.length}`}
                      tone={fullyBound ? 'ok' : 'info'}
                    />
                  </StaggerItem>
                  <StaggerItem>
                    <SignalTile
                      icon={AlertCircleIcon}
                      label="Obrigatórios pendentes"
                      value={requiredPending}
                      tone={requiredPending > 0 ? 'critical' : 'ok'}
                    />
                  </StaggerItem>
                  <StaggerItem>
                    <SignalTile
                      icon={AlertCircleIcon}
                      label="Avisos"
                      value={warningCount}
                      tone={warningCount > 0 ? 'warning' : 'neutral'}
                    />
                  </StaggerItem>
                </StaggerGroup>

                <div className="mt-4 overflow-hidden rounded-xl border">
                  <div className="grid grid-cols-[1fr_72px_1.1fr_120px_80px] gap-2 border-b bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <span>Aba</span>
                    <span>Célula</span>
                    <span>Campo de dados</span>
                    <span>Formato</span>
                    <span>Obrig.</span>
                  </div>
                  <div className="max-h-[28rem] overflow-auto">
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
                            className={cn(
                              'h-8 font-mono text-xs',
                              binding.required &&
                                !binding.fieldPath.trim() &&
                                'ring-1 ring-destructive/50',
                            )}
                            placeholder="ex.: asset.serialNumber"
                            onChange={(event) =>
                              updateScalarBinding(binding.id, {
                                fieldPath: event.target.value,
                              })
                            }
                          />
                          <Input
                            value={binding.formatter ?? ''}
                            placeholder="formato"
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
                      <div className="px-3 py-10 text-center text-xs text-muted-foreground">
                        Nenhum placeholder gerou vínculos. Envie uma planilha
                        com células no formato{' '}
                        <code className="font-mono">{'{{campo}}'}</code>.
                      </div>
                    )}
                  </div>
                </div>
              </Panel>
            ) : (
              <StageLocked
                message="Envie uma planilha na etapa Planilha para liberar o mapa de campos."
                onGoToSource={goToSource}
              />
            ))}

          {effectiveStage === 'verify' &&
            (hasWorkbench ? (
              <Panel className="p-5">
                <PanelHeader
                  eyebrow="Etapa 3"
                  title="Verificação"
                  description="Valide a planilha e gere uma prévia em PDF com dados de exemplo — é como você confere o certificado antes de publicar."
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          isReadOnly ||
                          !activeXlsxWorkbench ||
                          isXlsxImmutable ||
                          xlsxValidateMutation.isPending
                        }
                        onClick={() => xlsxValidateMutation.mutate()}
                      >
                        <HugeiconsIcon
                          icon={DocumentValidationIcon}
                          className="mr-2 size-4"
                        />
                        {xlsxValidateMutation.isPending
                          ? 'Validando...'
                          : 'Validar'}
                      </Button>
                      <Button
                        type="button"
                        className={ACTION_BUTTON_CLASS}
                        disabled={
                          isReadOnly ||
                          !activeXlsxWorkbench ||
                          xlsxPreviewMutation.isPending
                        }
                        onClick={() => xlsxPreviewMutation.mutate()}
                      >
                        {xlsxPreviewMutation.isPending
                          ? 'Gerando...'
                          : 'Gerar prévia PDF'}
                      </Button>
                    </div>
                  }
                />

                <div className="mt-4">
                  {xlsxPreviewQuery.data ? (
                    <div className="rounded-xl border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              hasRenderedPreview ? 'default' : 'secondary'
                            }
                          >
                            Prévia {xlsxPreviewQuery.data.item.status}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {hasRenderedPreview
                              ? 'PDF pronto para conferência.'
                              : 'Processando a prévia...'}
                          </span>
                        </div>
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
                            <HugeiconsIcon
                              icon={LinkSquare02Icon}
                              className="mr-2 size-4"
                            />
                            Abrir PDF
                          </Button>
                        )}
                      </div>
                      {xlsxPreviewQuery.data.item.error && (
                        <p className="mt-3 text-sm text-destructive">
                          {xlsxPreviewQuery.data.item.error}
                        </p>
                      )}
                    </div>
                  ) : isXlsxVerified ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border p-4">
                      <Badge variant="default">
                        {getXlsxStatusLabel(xlsxStatus)}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        Esta versão já passou pela verificação. Gere uma nova
                        prévia se quiser reconferir o resultado.
                      </span>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                      Gere uma prévia em PDF para conferir o certificado com
                      dados de exemplo.
                    </div>
                  )}

                  {!isXlsxVerified && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Uma prévia concluída é necessária para liberar a
                      publicação.
                    </p>
                  )}
                </div>
              </Panel>
            ) : (
              <StageLocked
                message="Envie uma planilha antes de validar e gerar a prévia."
                onGoToSource={goToSource}
              />
            ))}

          {effectiveStage === 'publish' &&
            (hasWorkbench ? (
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
            ) : (
              <StageLocked
                message="Envie e verifique uma planilha antes de publicar e atribuir."
                onGoToSource={goToSource}
              />
            ))}
        </div>

        {showTokenAside && (
          <aside className="min-w-0">
            <TokenLibrary
              search={tokenSearch}
              onSearchChange={setTokenSearch}
              activeGroup={activeTokenGroup}
              onActiveGroupChange={setActiveTokenGroup}
              tokens={filteredTokens}
              usedFieldPaths={usedFieldPaths}
              onCopyToken={copyToken}
            />
          </aside>
        )}
      </div>
    </div>
  )
}

function StageLocked({
  message,
  onGoToSource,
}: {
  message: string
  onGoToSource: () => void
}) {
  return (
    <Panel className="flex flex-col items-center gap-3 p-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <HugeiconsIcon icon={CloudUploadIcon} className="size-6" />
      </span>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onGoToSource}>
        Ir para Planilha
      </Button>
    </Panel>
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
    <Panel className="overflow-hidden p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Etapa 4
            </p>
            <Badge variant={isPublished ? 'default' : 'secondary'}>
              {isPublished ? 'Publicado' : 'Não publicado'}
            </Badge>
          </div>
          <h2 className="text-base font-semibold">Publicação e atribuição</h2>
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
          <HugeiconsIcon icon={RocketIcon} className="mr-2 size-4" />
          {publishPending
            ? 'Publicando...'
            : isPublished
              ? 'Publicado'
              : 'Publicar versão'}
        </Button>
      </div>

      {!isPublished && (
        <div className="border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
          {hasRenderedPreview
            ? 'Prévia concluída. Publique a versão para liberar a atribuição.'
            : 'Valide o XLSX e gere uma prévia PDF concluída antes de publicar.'}
        </div>
      )}

      {optionsError && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          Não foi possível carregar todos os métodos, serviços ou unidades.
          Atualize a página e tente novamente.
        </div>
      )}

      <form
        className="space-y-3 px-4 py-4"
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
    </Panel>
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
    <Panel className="overflow-hidden p-0 lg:sticky lg:top-4">
      <div className="grid gap-3 border-b bg-[linear-gradient(135deg,hsl(var(--muted))_0%,hsl(var(--background))_68%)] px-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-[0_6px_18px_hsl(var(--primary)/0.24)]">
              <HugeiconsIcon icon={BookOpen02Icon} className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-balance text-sm font-semibold">
                Biblioteca de tokens
              </h2>
              <p className="text-xs text-muted-foreground">
                Copie um token e cole na célula do XLSX, ex.{' '}
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
          {xlsxTokenGroups.map((group) => {
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

      <div className="max-h-[32rem] overflow-auto">
        {tokens.length > 0 ? (
          <div className="divide-y">
            {tokens.map((token) => {
              const isUsed = usedFieldPaths.has(token.path)
              const isCopied = copiedTokenPath === token.path
              return (
                <div
                  key={token.path}
                  className="space-y-2 px-3 py-2.5 transition-[background-color] hover:bg-muted/40"
                >
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
                    <Badge
                      variant="outline"
                      className="ml-auto font-normal text-[10px]"
                    >
                      {token.kind}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {token.description}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleCopyToken(token.path)}
                    className="group/token flex min-h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md bg-primary/10 px-2 text-left font-mono text-xs text-primary ring-1 ring-primary/15 transition-[background-color,box-shadow] hover:bg-primary/15 active:bg-primary/20"
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
    </Panel>
  )
}

function DesignerSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-[560px] w-full" />
    </div>
  )
}
