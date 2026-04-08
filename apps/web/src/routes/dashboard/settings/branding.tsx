import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { toast } from 'sonner'

import { usePlanAccess } from '@/hooks/use-plan-access'
import { api, resolveApiURL } from '@/utils/api'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ColorInput } from '@/components/ui/color-input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  DEFAULT_CERTIFICATE_TEMPLATE_CONFIG,
  normalizeCertificateTemplateConfig,
  type CertificateTemplateConfig,
} from '@calibra-facil/shared'
import {
  CertificateHtml,
  type JobData,
} from '../../../../../../packages/documents/src/CertificateHtml'

export const Route = createFileRoute('/dashboard/settings/branding')({
  head: () => ({
    meta: [{ title: 'Branding | Configurações | CalibraFácil' }],
  }),
  component: BrandingSettingsPage,
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
  config: CertificateTemplateConfig
}

interface TemplateListResponse {
  canManage: boolean
  items: TemplateItem[]
}

const layoutOptions = {
  headerStyle: [
    { value: 'classic', label: 'Clássico' },
    { value: 'split', label: 'Split' },
    { value: 'minimal', label: 'Minimal' },
  ],
  density: [
    { value: 'comfortable', label: 'Confortável' },
    { value: 'compact', label: 'Compacto' },
  ],
  emphasis: [
    { value: 'brand', label: 'Marca forte' },
    { value: 'formal', label: 'Formal' },
    { value: 'neutral', label: 'Neutro' },
  ],
} as const

function getOptionLabel<
  T extends ReadonlyArray<{ value: string; label: string }>,
>(options: T, value: string) {
  return options.find((option) => option.value === value)?.label ?? value
}

const sectionOptions: Array<{
  key: keyof CertificateTemplateConfig['sections']
  label: string
}> = [
  { key: 'showLabAddress', label: 'Endereço do laboratório' },
  { key: 'showLabContact', label: 'Contato do laboratório' },
  { key: 'showAccreditation', label: 'Acreditação' },
  { key: 'showCustomerContact', label: 'Contato do cliente' },
  { key: 'showEnvironmental', label: 'Condições ambientais' },
  { key: 'showStandards', label: 'Padrões utilizados' },
  { key: 'showResults', label: 'Resultados' },
  { key: 'showSignature', label: 'Assinatura' },
  { key: 'showAmendmentNotice', label: 'Aviso de retificação' },
]

function templateKey(template: TemplateItem) {
  return template.id ? String(template.id) : `system:${template.slug}`
}

function BrandingSettingsPage() {
  const queryClient = useQueryClient()
  const accessQuery = usePlanAccess()
  const [previewZoom, setPreviewZoom] = useState<75 | 100 | 125>(100)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(
    null,
  )
  const [newTemplateName, setNewTemplateName] = useState('')
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<{
    name: string
    config: CertificateTemplateConfig
  }>({
    name: '',
    config: DEFAULT_CERTIFICATE_TEMPLATE_CONFIG,
  })
  const deferredConfig = useDeferredValue(draft.config)

  const templatesQuery = useQuery({
    queryKey: ['certificate-templates'],
    queryFn: async () => {
      const res = await api.api['certificate-templates'].$get()
      if (!res.ok) {
        throw new Error('Falha ao carregar templates')
      }
      return res.json() as Promise<TemplateListResponse>
    },
  })

  const templates = templatesQuery.data?.items ?? []
  const selectedTemplate = useMemo(
    () =>
      templates.find(
        (template) => templateKey(template) === selectedTemplateKey,
      ) ??
      templates[0] ??
      null,
    [selectedTemplateKey, templates],
  )

  useEffect(() => {
    if (!selectedTemplateKey && templates.length > 0) {
      const nextSelection =
        templates.find((template) => template.isDefault) ?? templates[0]
      setSelectedTemplateKey(templateKey(nextSelection))
    }
  }, [selectedTemplateKey, templates])

  useEffect(() => {
    if (!selectedTemplate) return

    setDraft({
      name: selectedTemplate.name,
      config: normalizeCertificateTemplateConfig(selectedTemplate.config),
    })
  }, [selectedTemplate])

  const refreshTemplates = async () => {
    await queryClient.invalidateQueries({ queryKey: ['certificate-templates'] })
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api['certificate-templates'].$post({
        json: {
          name: newTemplateName.trim(),
          config: DEFAULT_CERTIFICATE_TEMPLATE_CONFIG,
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
          config: draft.config,
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
      toast.success('Template atualizado')
      setSelectedTemplateKey(templateKey(data.item))
      await refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar template',
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

  const archiveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate?.id) {
        throw new Error('Selecione um template salvo')
      }

      const res = await api.api['certificate-templates'][':id'].archive.$post({
        param: { id: String(selectedTemplate.id) },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao arquivar template',
        )
      }
    },
    onSuccess: async () => {
      toast.success('Template arquivado')
      await refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao arquivar template',
      )
    },
  })

  const previewHtml = useMemo(
    () =>
      `<!DOCTYPE html>${renderToStaticMarkup(
        CertificateHtml({
          job: createPreviewJob(deferredConfig),
        }),
      )}`,
    [deferredConfig],
  )

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedTemplate?.id) {
        throw new Error('Salve um template antes de enviar a logo')
      }

      const formData = new FormData()
      formData.append('logo', file)

      const res = await fetch(
        `${resolveApiURL()}/api/certificate-templates/${selectedTemplate.id}/logo`,
        {
          method: 'POST',
          body: formData,
          credentials: 'include',
        },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao enviar logo',
        )
      }

      return res.json() as Promise<{ item: TemplateItem }>
    },
    onSuccess: async (data) => {
      setDraft((current) => ({
        ...current,
        config: normalizeCertificateTemplateConfig(data.item.config),
      }))
      toast.success('Logo enviada')
      await refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao enviar logo',
      )
    },
  })

  const removeLogoMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate?.id) {
        throw new Error('Selecione um template salvo')
      }

      const res = await api.api['certificate-templates'][':id'].logo.$delete({
        param: { id: String(selectedTemplate.id) },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao remover logo',
        )
      }

      return res.json() as Promise<{ item: TemplateItem }>
    },
    onSuccess: async (data) => {
      setDraft((current) => ({
        ...current,
        config: normalizeCertificateTemplateConfig(data.item.config),
      }))
      toast.success('Logo removida')
      await refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao remover logo',
      )
    },
  })

  if (templatesQuery.isLoading || accessQuery.isLoading) {
    return <BrandingSkeleton />
  }

  if (templatesQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>
            {templatesQuery.error instanceof Error
              ? templatesQuery.error.message
              : 'Falha ao carregar branding'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const canManageTemplates =
    (accessQuery.data?.hasCustomTemplates ?? false) &&
    (templatesQuery.data?.canManage ?? false)
  const isSystemTemplate = selectedTemplate?.id == null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>
            Workspace estruturado para templates de certificado. O motor de PDF
            continua fixo, mas agora com mais força de marca, preview e gestão
            operacional.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {templates.length} template{templates.length === 1 ? '' : 's'}
            </Badge>
            {selectedTemplate?.isDefault && <Badge>Padrão atual</Badge>}
            {selectedTemplate && (
              <Badge variant="outline">v{selectedTemplate.version}</Badge>
            )}
            {!canManageTemplates && (
              <Badge variant="outline">Professional+</Badge>
            )}
          </div>

          {!canManageTemplates && (
            <Alert>
              <AlertDescription>
                Templates personalizados ficam disponíveis a partir do plano
                Professional. A superfície continua legível para revisão do
                layout atual.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Templates</CardTitle>
            <CardDescription>
              Defina o padrão, duplique variações e mantenha o histórico da sua
              identidade documental.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="rounded-lg border p-4"
              onSubmit={(event) => {
                event.preventDefault()
                createMutation.mutate()
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="new-template-name">
                    Novo template
                  </FieldLabel>
                  <Input
                    id="new-template-name"
                    value={newTemplateName}
                    onChange={(event) => setNewTemplateName(event.target.value)}
                    placeholder="RBC institucional 2026"
                    disabled={!canManageTemplates || createMutation.isPending}
                  />
                  <FieldDescription>
                    Cria uma nova variação a partir do template padrão do
                    sistema.
                  </FieldDescription>
                </Field>
                <Button
                  type="submit"
                  disabled={
                    !canManageTemplates ||
                    !newTemplateName.trim() ||
                    createMutation.isPending
                  }
                >
                  Criar do padrão
                </Button>
              </FieldGroup>
            </form>

            <div className="space-y-2">
              {templates.map((template) => {
                const isSelected =
                  selectedTemplate &&
                  templateKey(template) === templateKey(selectedTemplate)

                return (
                  <button
                    key={templateKey(template)}
                    type="button"
                    onClick={() =>
                      setSelectedTemplateKey(templateKey(template))
                    }
                    className={cn(
                      'w-full rounded-xl border p-4 text-left transition-colors hover:bg-muted/40',
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{template.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {template.slug}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1">
                        {template.isDefault && <Badge>Padrão</Badge>}
                        <Badge variant="secondary">v{template.version}</Badge>
                        <Badge variant="outline">{template.status}</Badge>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <span
                        className="h-4 w-4 rounded-full border"
                        style={{
                          backgroundColor: template.config.theme.primaryColor,
                        }}
                      />
                      <span
                        className="h-4 w-4 rounded-full border"
                        style={{
                          backgroundColor: template.config.theme.accentColor,
                        }}
                      />
                      <span className="text-xs text-muted-foreground">
                        {
                          layoutOptions.headerStyle.find(
                            (item) =>
                              item.value === template.config.layout.headerStyle,
                          )?.label
                        }
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>{selectedTemplate?.name ?? 'Template'}</CardTitle>
                  <CardDescription>
                    Edite branding, conteúdo e densidade mantendo a estrutura
                    fixa do certificado.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedTemplate?.isDefault && <Badge>Padrão</Badge>}
                  {selectedTemplate && (
                    <Badge variant="secondary">
                      v{selectedTemplate.version}
                    </Badge>
                  )}
                  {selectedTemplate && (
                    <Badge variant="outline">{selectedTemplate.status}</Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-wrap gap-2">
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
                  variant="outline"
                  onClick={() => archiveMutation.mutate()}
                  disabled={
                    !canManageTemplates ||
                    !selectedTemplate?.id ||
                    selectedTemplate.isDefault ||
                    selectedTemplate.status === 'ARCHIVED' ||
                    archiveMutation.isPending
                  }
                >
                  Arquivar
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
                  Salvar template
                </Button>
              </div>

              <div className="grid gap-6 2xl:grid-cols-[minmax(0,0.9fr)_minmax(460px,1.1fr)]">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="template-name">Nome</FieldLabel>
                    <Input
                      id="template-name"
                      value={draft.name}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      disabled={!canManageTemplates || isSystemTemplate}
                    />
                  </Field>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel>Cor primária</FieldLabel>
                      <ColorInput
                        value={draft.config.theme.primaryColor}
                        title="Cor primária"
                        description="Usada no cabeçalho, títulos e identidade principal do certificado."
                        onChange={(nextColor) =>
                          setDraft((current) => ({
                            ...current,
                            config: {
                              ...current.config,
                              theme: {
                                ...current.config.theme,
                                primaryColor: nextColor,
                              },
                            },
                          }))
                        }
                        disabled={!canManageTemplates || isSystemTemplate}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Cor de apoio</FieldLabel>
                      <ColorInput
                        value={draft.config.theme.accentColor}
                        title="Cor de apoio"
                        description="Usada em áreas secundárias e reforço visual sem competir com a cor principal."
                        onChange={(nextColor) =>
                          setDraft((current) => ({
                            ...current,
                            config: {
                              ...current.config,
                              theme: {
                                ...current.config.theme,
                                accentColor: nextColor,
                              },
                            },
                          }))
                        }
                        disabled={!canManageTemplates || isSystemTemplate}
                      />
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel>Logo do certificado</FieldLabel>
                    <div className="rounded-xl border p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="space-y-2">
                          {draft.config.theme.logoUrl ? (
                            <div className="rounded-lg border bg-muted/20 px-4 py-3">
                              <img
                                src={draft.config.theme.logoUrl}
                                alt="Logo do template"
                                className="max-h-16 max-w-[220px] object-contain"
                              />
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                              Nenhuma logo enviada para este template.
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <input
                            ref={logoInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/svg+xml"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0]
                              if (file) {
                                uploadLogoMutation.mutate(file)
                              }
                              event.currentTarget.value = ''
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => logoInputRef.current?.click()}
                            disabled={
                              !canManageTemplates ||
                              isSystemTemplate ||
                              uploadLogoMutation.isPending
                            }
                          >
                            {draft.config.theme.logoUrl
                              ? 'Trocar logo'
                              : 'Enviar logo'}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => removeLogoMutation.mutate()}
                            disabled={
                              !canManageTemplates ||
                              isSystemTemplate ||
                              !draft.config.theme.logoUrl ||
                              removeLogoMutation.isPending
                            }
                          >
                            Remover logo
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="template-title">
                      Título do documento
                    </FieldLabel>
                    <Input
                      id="template-title"
                      value={draft.config.content.documentTitle}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          config: {
                            ...current.config,
                            content: {
                              ...current.config.content,
                              documentTitle: event.target.value,
                            },
                          },
                        }))
                      }
                      disabled={!canManageTemplates || isSystemTemplate}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="template-intro">
                      Texto de abertura
                    </FieldLabel>
                    <Textarea
                      id="template-intro"
                      value={draft.config.content.introText ?? ''}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          config: {
                            ...current.config,
                            content: {
                              ...current.config.content,
                              introText: event.target.value.trim() || null,
                            },
                          },
                        }))
                      }
                      disabled={!canManageTemplates || isSystemTemplate}
                      rows={4}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="template-footer">
                      Nota de rodapé
                    </FieldLabel>
                    <Textarea
                      id="template-footer"
                      value={draft.config.content.footerNote ?? ''}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          config: {
                            ...current.config,
                            content: {
                              ...current.config.content,
                              footerNote: event.target.value.trim() || null,
                            },
                          },
                        }))
                      }
                      disabled={!canManageTemplates || isSystemTemplate}
                      rows={3}
                    />
                  </Field>

                  <div className="grid gap-4 md:grid-cols-3">
                    <Field>
                      <FieldLabel>Header</FieldLabel>
                      <Select
                        value={draft.config.layout.headerStyle}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            config: {
                              ...current.config,
                              layout: {
                                ...current.config.layout,
                                headerStyle:
                                  value as CertificateTemplateConfig['layout']['headerStyle'],
                              },
                            },
                          }))
                        }
                        disabled={!canManageTemplates || isSystemTemplate}
                      >
                        <SelectTrigger>
                          <SelectValue>
                            {getOptionLabel(
                              layoutOptions.headerStyle,
                              draft.config.layout.headerStyle,
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {layoutOptions.headerStyle.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field>
                      <FieldLabel>Densidade</FieldLabel>
                      <Select
                        value={draft.config.layout.density}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            config: {
                              ...current.config,
                              layout: {
                                ...current.config.layout,
                                density:
                                  value as CertificateTemplateConfig['layout']['density'],
                              },
                            },
                          }))
                        }
                        disabled={!canManageTemplates || isSystemTemplate}
                      >
                        <SelectTrigger>
                          <SelectValue>
                            {getOptionLabel(
                              layoutOptions.density,
                              draft.config.layout.density,
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {layoutOptions.density.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field>
                      <FieldLabel>Ênfase</FieldLabel>
                      <Select
                        value={draft.config.layout.emphasis}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            config: {
                              ...current.config,
                              layout: {
                                ...current.config.layout,
                                emphasis:
                                  value as CertificateTemplateConfig['layout']['emphasis'],
                              },
                            },
                          }))
                        }
                        disabled={!canManageTemplates || isSystemTemplate}
                      >
                        <SelectTrigger>
                          <SelectValue>
                            {getOptionLabel(
                              layoutOptions.emphasis,
                              draft.config.layout.emphasis,
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {layoutOptions.emphasis.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel>Seções visíveis</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {sectionOptions.map((option) => {
                        const enabled = draft.config.sections[option.key]

                        return (
                          <Button
                            key={option.key}
                            type="button"
                            variant={enabled ? 'default' : 'outline'}
                            size="sm"
                            disabled={!canManageTemplates || isSystemTemplate}
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                config: {
                                  ...current.config,
                                  sections: {
                                    ...current.config.sections,
                                    [option.key]: !enabled,
                                  },
                                },
                              }))
                            }
                          >
                            {option.label}
                          </Button>
                        )
                      })}
                    </div>
                  </Field>
                </FieldGroup>

                <div className="2xl:sticky 2xl:top-4">
                  <TemplatePreview
                    html={previewHtml}
                    isLoading={false}
                    error={null}
                    zoom={previewZoom}
                    onZoomChange={setPreviewZoom}
                    onExpand={() => setPreviewOpen(true)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] gap-4 overflow-hidden p-0 sm:max-w-7xl">
          <DialogHeader className="border-b px-6 pt-6">
            <DialogTitle>Revisão do certificado</DialogTitle>
            <DialogDescription>
              Visualização em foco do mesmo renderer estrutural usado na geração
              final do certificado.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6">
            <TemplatePreview
              html={previewHtml}
              isLoading={false}
              error={null}
              zoom={previewZoom}
              onZoomChange={setPreviewZoom}
              onExpand={null}
              expanded
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TemplatePreview({
  html,
  isLoading,
  error,
  zoom,
  onZoomChange,
  onExpand,
  expanded = false,
}: {
  html: string | null
  isLoading: boolean
  error: string | null
  zoom: 75 | 100 | 125
  onZoomChange: (zoom: 75 | 100 | 125) => void
  onExpand: (() => void) | null
  expanded?: boolean
}) {
  const zoomOptions: Array<75 | 100 | 125> = [75, 100, 125]

  return (
    <Card className={cn('overflow-hidden', expanded && 'border-0 shadow-none')}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              Visualização gerada pelo mesmo renderer estrutural do certificado.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border p-1">
              {zoomOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={zoom === option ? 'default' : 'ghost'}
                  className="h-8 px-3"
                  onClick={() => onZoomChange(option)}
                >
                  {option}%
                </Button>
              ))}
            </div>
            {onExpand && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onExpand}
              >
                Expandir
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className={expanded ? 'px-0 pb-0' : undefined}>
        {error ? (
          <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            {error}
          </div>
        ) : isLoading && !html ? (
          <Skeleton className="h-[900px] w-full rounded-2xl" />
        ) : (
          <PreviewCanvas html={html} zoom={zoom} expanded={expanded} />
        )}
      </CardContent>
    </Card>
  )
}

function PreviewCanvas({
  html,
  zoom,
  expanded,
}: {
  html: string | null
  zoom: 75 | 100 | 125
  expanded: boolean
}) {
  const scale = zoom / 100
  const previewWidth = 794
  const previewHeight = 1123

  return (
    <div
      className={cn(
        'overflow-auto rounded-2xl border bg-[radial-gradient(circle_at_top,_hsl(var(--muted)/0.55),_hsl(var(--background))_55%)] p-6 lg:p-8',
        expanded ? 'h-[calc(100vh-13rem)]' : 'h-[920px]',
      )}
    >
      <div className="mx-auto w-fit rounded-[28px] bg-white/75 p-3 shadow-sm ring-1 ring-black/5">
        <div
          className="mx-auto"
          style={{
            width: previewWidth * scale,
            height: previewHeight * scale,
          }}
        >
          <iframe
            title="Certificate preview"
            srcDoc={html ?? ''}
            className="rounded-2xl border-0 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.14)]"
            style={{
              width: previewWidth,
              height: previewHeight,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          />
        </div>
      </div>
    </div>
  )
}

function createPreviewJob(config: CertificateTemplateConfig): JobData {
  return {
    jobId: 'CF-2026-0042',
    organizationId: 'preview-org',
    performedAt: new Date('2026-03-21T10:00:00.000Z'),
    approvedAt: new Date('2026-03-22T15:30:00.000Z'),
    environmentalSnapshot: {
      temperature: 23.1,
      humidity: 52.4,
      pressure: 101.2,
      recordedAt: '2026-03-21T10:15:00.000Z',
      recordedBy: 'Mariana Alves',
      limits: {
        temperature: { min: 20, max: 25 },
        humidity: { min: 45, max: 60 },
        pressure: { min: 98, max: 103 },
      },
      withinLimits: true,
      outOfLimitsJustification: null,
    },
    lab: {
      name: 'Laboratório Exemplo',
      cnpj: '12345678000190',
      accreditationNumber: 'RBC 123',
      accreditationBody: 'Cgcre/Inmetro',
      street: 'Rua das Referências',
      number: '240',
      neighbourhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      cep: '01000-000',
      phone: '(11) 3333-0000',
      email: 'contato@labexemplo.com.br',
      website: 'https://labexemplo.com.br',
      technicalManagerName: 'Eng. Mariana Alves',
      technicalManagerTitle: 'Responsável técnica',
    },
    customer: {
      name: 'Metalúrgica Horizonte Ltda.',
      taxId: '98765432000155',
      phone: '(11) 4000-2222',
      email: 'qualidade@horizonte.com.br',
      address: {
        street: 'Av. Industrial',
        number: '1800',
        neighbourhood: 'Distrito Industrial',
        city: 'Campinas',
        state: 'SP',
        cep: '13000-000',
      },
    },
    asset: {
      name: 'Balança Analítica',
      serialNumber: 'BA-009182',
      tag: 'EQ-204',
      model: 'AX-220',
      manufacturer: 'Mettler Toledo',
    },
    methodSnapshot: {
      methodId: 1,
      methodName: 'Calibração gravimétrica',
      methodVersion: 3,
      dataFields: [
        { key: 'resolution', label: 'Resolução', type: 'number', unit: 'g' },
        {
          key: 'repeatability',
          label: 'Repetibilidade',
          type: 'number',
          unit: 'g',
        },
      ],
      formulas: [
        {
          outputKey: 'error_50g',
          expression: '50 - 49.9987',
          label: 'Erro em 50 g',
          unit: 'g',
        },
      ],
    },
    standardsSnapshot: [
      {
        id: 1,
        name: 'Conjunto de massas classe E2',
        certificateNumber: 'RB-2026-1182',
        calibrationDate: '2026-01-10T00:00:00.000Z',
        uncertainty: 0.0002,
        uncertaintyUnit: 'g',
        coverageFactor: 2,
        certifiedValues: [
          { nominal: '50 g', value: 50, uncertainty: 0.0002, unit: 'g' },
        ],
      },
    ],
    data: {
      resolution: 0.0001,
      repeatability: 0.0002,
    },
    results: {
      error_50g: 0.0013,
    },
    approverName: 'Mariana Alves',
    certificateTemplateSnapshot: {
      id: 1,
      name: 'Preview',
      slug: 'preview',
      version: 1,
      config,
    },
    approverSignatureUrl: null,
    supersedesId: null,
    supersededById: null,
    amendmentNumber: null,
    amendmentReason: null,
    originalJobId: null,
    originalApprovedAt: null,
  }
}

function BrandingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-32 w-full" />
      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Skeleton className="h-[720px] w-full" />
        <Skeleton className="h-[720px] w-full" />
      </div>
    </div>
  )
}
