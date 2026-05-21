import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { calibraApi } from '@/utils/api'
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

  const templatesQuery = useCertificateTemplatesData({
    enabled: !cloudOnlyUnavailable,
  })

  const templates = templatesQuery.data?.items ?? []
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
