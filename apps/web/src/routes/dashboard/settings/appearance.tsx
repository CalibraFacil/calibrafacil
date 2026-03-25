import { createFileRoute } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Moon01Icon,
  Settings02Icon,
  Sun01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { api } from '@/utils/api'
import { usePlanAccess } from '@/hooks/use-plan-access'
import { DEFAULT_CERTIFICATE_TEMPLATE_CONFIG } from '@calibra-facil/shared'

export const Route = createFileRoute('/dashboard/settings/appearance')({
  head: () => ({
    meta: [{ title: 'Aparência | Configuracoes | CalibraFácil' }],
  }),
  component: AppearanceSettingsPage,
})

interface ThemeOption {
  value: string
  label: string
  description: string
  icon: React.ReactNode
}

const themeOptions: Array<ThemeOption> = [
  {
    value: 'light',
    label: 'Claro',
    description: 'Tema claro para uso diurno',
    icon: <HugeiconsIcon icon={Sun01Icon} className="h-6 w-6" />,
  },
  {
    value: 'dark',
    label: 'Escuro',
    description: 'Tema escuro para reduzir o cansaço visual',
    icon: <HugeiconsIcon icon={Moon01Icon} className="h-6 w-6" />,
  },
  {
    value: 'system',
    label: 'Sistema',
    description: 'Usar a configuração do sistema operacional',
    icon: <HugeiconsIcon icon={Settings02Icon} className="h-6 w-6" />,
  },
]

function AppearanceSettingsPage() {
  const { theme, setTheme } = useTheme()
  const queryClient = useQueryClient()
  const accessQuery = usePlanAccess()
  const [templateName, setTemplateName] = useState('')
  const [primaryColor, setPrimaryColor] = useState(
    DEFAULT_CERTIFICATE_TEMPLATE_CONFIG.theme.primaryColor,
  )
  const [accentColor, setAccentColor] = useState(
    DEFAULT_CERTIFICATE_TEMPLATE_CONFIG.theme.accentColor,
  )

  const templatesQuery = useQuery({
    queryKey: ['certificate-templates'],
    queryFn: async () => {
      const res = await api.api['certificate-templates'].$get()
      if (!res.ok) {
        throw new Error('Falha ao carregar templates')
      }
      return res.json() as Promise<{
        canManage: boolean
        items: Array<{
          id: number | null
          name: string
          slug: string
          version: number
          status: string
          isDefault: boolean
          config: {
            theme: { primaryColor: string; accentColor: string }
          }
        }>
      }>
    },
  })

  const createTemplateMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api['certificate-templates'].$post({
        json: {
          name: templateName,
          config: {
            theme: {
              primaryColor,
              accentColor,
            },
          },
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
    },
    onSuccess: async () => {
      toast.success('Template criado')
      setTemplateName('')
      await queryClient.invalidateQueries({ queryKey: ['certificate-templates'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Falha ao criar template')
    },
  })

  const setDefaultMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.api['certificate-templates'][':id']['set-default'].$post({
        param: { id: String(id) },
      })
      if (!res.ok) {
        throw new Error('Falha ao definir template padrão')
      }
    },
    onSuccess: async () => {
      toast.success('Template padrão atualizado')
      await queryClient.invalidateQueries({ queryKey: ['certificate-templates'] })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.api['certificate-templates'][':id'].archive.$post({
        param: { id: String(id) },
      })
      if (!res.ok) {
        throw new Error('Falha ao arquivar template')
      }
    },
    onSuccess: async () => {
      toast.success('Template arquivado')
      await queryClient.invalidateQueries({ queryKey: ['certificate-templates'] })
    },
  })

  const hasCustomTemplates = accessQuery.data?.hasCustomTemplates ?? false
  const templates = templatesQuery.data?.items ?? []

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme)
    const option = themeOptions.find((o) => o.value === newTheme)
    if (option) {
      toast.success(`Tema alterado para ${option.label}`)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Tema</CardTitle>
          <CardDescription>
            Selecione o tema da interface que você prefere.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleThemeChange(option.value)}
                className={cn(
                  'flex flex-col items-center gap-3 rounded-lg border p-4 text-center transition-colors hover:bg-muted',
                  theme === option.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border',
                )}
              >
                <div
                  className={cn(
                    'flex h-12 w-12 items-center justify-center rounded-lg',
                    theme === option.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted',
                  )}
                >
                  {option.icon}
                </div>
                <div>
                  <p className="font-medium">{option.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {option.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Theme Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Visualização</CardTitle>
          <CardDescription>
            Veja como a interface aparece com o tema selecionado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border p-4">
            <div className="space-y-4">
              {/* Preview Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary" />
                  <div>
                    <p className="text-sm font-medium">CalibraFácil</p>
                    <p className="text-xs text-muted-foreground">
                      Gestão de Calibrações
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="h-8 w-8 rounded-md bg-muted" />
                  <div className="h-8 w-8 rounded-md bg-muted" />
                </div>
              </div>

              {/* Preview Content */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-card p-3">
                  <div className="h-2 w-16 rounded bg-muted-foreground/20" />
                  <div className="mt-2 h-8 w-full rounded bg-muted" />
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="h-2 w-20 rounded bg-muted-foreground/20" />
                  <div className="mt-2 h-8 w-full rounded bg-muted" />
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="h-2 w-12 rounded bg-muted-foreground/20" />
                  <div className="mt-2 h-8 w-full rounded bg-muted" />
                </div>
              </div>

              {/* Preview Table */}
              <div className="rounded-lg border">
                <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-2">
                  <div className="h-3 w-24 rounded bg-muted-foreground/30" />
                  <div className="h-3 w-20 rounded bg-muted-foreground/30" />
                  <div className="h-3 w-16 rounded bg-muted-foreground/30" />
                </div>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 border-b last:border-0 px-4 py-3"
                  >
                    <div className="h-3 w-24 rounded bg-muted" />
                    <div className="h-3 w-20 rounded bg-muted" />
                    <div className="h-5 w-16 rounded-full bg-primary/20" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Templates de Certificado</CardTitle>
          <CardDescription>
            Crie variações do layout do certificado mantendo o motor
            metrológico igual em todos os planos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!hasCustomTemplates && (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Templates personalizados ficam disponíveis a partir do plano
              Professional.
            </div>
          )}

          <form
            className="rounded-lg border p-4"
            onSubmit={(event) => {
              event.preventDefault()
              createTemplateMutation.mutate()
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="template-name">Nome do template</FieldLabel>
                <Input
                  id="template-name"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="RBC azul institucional"
                  disabled={!hasCustomTemplates || createTemplateMutation.isPending}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="template-primary-color">
                    Cor primária
                  </FieldLabel>
                  <Input
                    id="template-primary-color"
                    value={primaryColor}
                    onChange={(event) => setPrimaryColor(event.target.value)}
                    disabled={!hasCustomTemplates || createTemplateMutation.isPending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="template-accent-color">
                    Cor de apoio
                  </FieldLabel>
                  <Input
                    id="template-accent-color"
                    value={accentColor}
                    onChange={(event) => setAccentColor(event.target.value)}
                    disabled={!hasCustomTemplates || createTemplateMutation.isPending}
                  />
                </Field>
              </div>

              <Field>
                <FieldDescription>
                  Esta primeira versão permite personalização segura de tema e
                  preserva reprodutibilidade histórica por snapshot.
                </FieldDescription>
              </Field>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={
                    !hasCustomTemplates ||
                    !templateName.trim() ||
                    createTemplateMutation.isPending
                  }
                >
                  Criar template
                </Button>
              </div>
            </FieldGroup>
          </form>

          <div className="space-y-3">
            {templates.map((template) => (
              <div
                key={`${template.slug}-${template.version}`}
                className="flex flex-col gap-4 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{template.name}</p>
                    {template.isDefault && <Badge>Padrão</Badge>}
                    <Badge variant="secondary">v{template.version}</Badge>
                    <Badge variant="outline">{template.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {template.slug}
                  </p>
                  <div className="flex gap-2">
                    <span
                      className="h-5 w-5 rounded-full border"
                      style={{ backgroundColor: template.config.theme.primaryColor }}
                    />
                    <span
                      className="h-5 w-5 rounded-full border"
                      style={{ backgroundColor: template.config.theme.accentColor }}
                    />
                  </div>
                </div>
                {template.id && (
                  <div className="flex flex-wrap gap-2">
                    {!template.isDefault && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setDefaultMutation.mutate(template.id!)}
                        disabled={!hasCustomTemplates || setDefaultMutation.isPending}
                      >
                        Tornar padrão
                      </Button>
                    )}
                    {!template.isDefault && template.status !== 'ARCHIVED' && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => archiveMutation.mutate(template.id!)}
                        disabled={!hasCustomTemplates || archiveMutation.isPending}
                      >
                        Arquivar
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
