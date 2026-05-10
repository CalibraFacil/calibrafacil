import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { CertificateDesigner } from '@/components/certificate-designer/certificate-designer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { cn } from '@/lib/utils'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import { api, apiFetch } from '@/utils/api'
import {
  DEFAULT_CERTIFICATE_TEMPLATE_CONFIG,
  normalizeCertificateTemplateConfig,
  type CertificateTemplateConfig,
} from '@calibra-facil/shared'

export const Route = createFileRoute('/dashboard/certificate-designer')({
  head: () => ({
    meta: [{ title: 'Editor de Certificados | CalibraFácil' }],
  }),
  component: CertificateDesignerPage,
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

type TemplateDraft = {
  name: string
  config: CertificateTemplateConfig
}

function templateKey(template: TemplateItem) {
  return template.id ? String(template.id) : `system:${template.slug}`
}

function createTemplateDraft(template: TemplateItem): TemplateDraft {
  return {
    name: template.name,
    config: normalizeCertificateTemplateConfig(template.config),
  }
}

function CertificateDesignerPage() {
  const queryClient = useQueryClient()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const accessQuery = usePlanAccess({ enabled: !cloudOnlyUnavailable })
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(
    null,
  )
  const [newTemplateName, setNewTemplateName] = useState('')
  const [draftsByTemplateKey, setDraftsByTemplateKey] = useState<
    Record<string, TemplateDraft>
  >({})

  const templatesQuery = useQuery({
    queryKey: ['certificate-templates'],
    enabled: !cloudOnlyUnavailable,
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
  const draft =
    selectedTemplate && effectiveSelectedTemplateKey
      ? (draftsByTemplateKey[effectiveSelectedTemplateKey] ??
        createTemplateDraft(selectedTemplate))
      : {
          name: '',
          config: DEFAULT_CERTIFICATE_TEMPLATE_CONFIG,
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

  const createMutation = useMutation({
    mutationFn: async () => {
      const name = newTemplateName.trim()
      const res = await api.api['certificate-templates'].$post({
        json: {
          name,
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

  const logoUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedTemplate?.id) {
        throw new Error('Selecione um template editável')
      }

      const formData = new FormData()
      formData.append('logo', file)

      const res = await apiFetch(
        `/api/certificate-templates/${selectedTemplate.id}/logo`,
        {
          method: 'POST',
          body: formData,
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
      toast.success('Logo do template atualizado')
      setDraft((current) => ({
        ...current,
        config: {
          ...current.config,
          theme: {
            ...current.config.theme,
            logoUrl: data.item.config.theme.logoUrl,
          },
        },
      }))
      await refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao enviar logo',
      )
    },
  })

  const logoDeleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate?.id) {
        throw new Error('Selecione um template editável')
      }

      const res = await apiFetch(
        `/api/certificate-templates/${selectedTemplate.id}/logo`,
        {
          method: 'DELETE',
        },
      )

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
    onSuccess: async () => {
      toast.success('Logo do template removido')
      setDraft((current) => ({
        ...current,
        config: {
          ...current.config,
          theme: {
            ...current.config.theme,
            logoUrl: null,
          },
        },
      }))
      await refreshTemplates()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao remover logo',
      )
    },
  })

  if (cloudOnlyUnavailable) {
    return (
      <CloudOnlyOfflineState title="Editor de certificados indisponível offline" />
    )
  }

  if (templatesQuery.isLoading || accessQuery.isLoading) {
    return <DesignerSkeleton />
  }

  if (templatesQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Editor de certificados</CardTitle>
          <CardDescription>
            {templatesQuery.error instanceof Error
              ? templatesQuery.error.message
              : 'Falha ao carregar templates'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const canManageTemplates =
    (accessQuery.data?.hasCustomTemplates ?? false) &&
    (templatesQuery.data?.canManage ?? false)
  const isSystemTemplate = selectedTemplate?.id == null
  const isReadOnly = !canManageTemplates || isSystemTemplate
  const logoControls = (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">Logo</h4>
          <p className="text-xs text-muted-foreground">Salvo neste template.</p>
        </div>
        {draft.config.theme.logoUrl && (
          <Badge variant="outline" className="shrink-0">
            Ativo
          </Badge>
        )}
      </div>

      <div className="mt-3 grid h-24 place-items-center overflow-hidden rounded-md border bg-background">
        {draft.config.theme.logoUrl ? (
          <img
            src={draft.config.theme.logoUrl}
            alt="Logo do template"
            className="max-h-full max-w-full object-contain p-2"
          />
        ) : (
          <span className="text-xs text-muted-foreground">Sem logo</span>
        )}
      </div>

      <input
        ref={logoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        disabled={isReadOnly || logoUploadMutation.isPending}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            logoUploadMutation.mutate(file)
          }
          event.currentTarget.value = ''
        }}
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isReadOnly || logoUploadMutation.isPending}
          onClick={() => logoInputRef.current?.click()}
        >
          {logoUploadMutation.isPending ? 'Enviando...' : 'Enviar'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            isReadOnly ||
            !draft.config.theme.logoUrl ||
            logoDeleteMutation.isPending
          }
          onClick={() => logoDeleteMutation.mutate()}
        >
          Remover
        </Button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-background p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">Editor de certificados</h1>
            {selectedTemplate?.isDefault && <Badge>Padrão</Badge>}
            {selectedTemplate && (
              <Badge variant="secondary">v{selectedTemplate.version}</Badge>
            )}
            {isReadOnly && <Badge variant="outline">Somente leitura</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Edite blocos em A4 com coordenadas em milímetros. O PDF usa o
            renderer determinístico, não o editor visual.
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

      <div
        className={cn(
          'min-h-[calc(100vh-18rem)] rounded-lg border bg-background p-3',
          isReadOnly && 'bg-muted/10',
        )}
      >
        <CertificateDesigner
          config={draft.config}
          readOnly={isReadOnly}
          inspectorHeader={logoControls}
          onChange={(nextConfig) =>
            setDraft((current) => ({
              ...current,
              config: nextConfig,
            }))
          }
        />
      </div>
    </div>
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
