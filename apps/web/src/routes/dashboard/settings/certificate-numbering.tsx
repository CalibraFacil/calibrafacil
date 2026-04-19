import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Certificate01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute(
  '/dashboard/settings/certificate-numbering',
)({
  head: () => ({
    meta: [
      { title: 'Numeração de Certificados | Configurações | CalibraFácil' },
    ],
  }),
  component: CertificateNumberingSettingsPage,
})

type ResetScope = 'never' | 'year' | 'month' | 'project'

type CertificateNumberingConfig = {
  labCode: string
  projectCode?: string | null
  numberTemplate: string
  certificateNameTemplate: string
  sequence: {
    resetScope: ResetScope
    startAt: number
    increment: number
    padding: number
  }
}

type ProfileResponse = {
  profile: {
    id: number | null
    name: string
    config: CertificateNumberingConfig
    createdAt: string | null
    updatedAt: string | null
  }
  example: {
    number: string
    name: string
    sequenceKey: string
  }
  supportedTokens: string[]
}

type FormState = {
  name: string
  labCode: string
  projectCode: string
  numberTemplate: string
  certificateNameTemplate: string
  resetScope: ResetScope
  startAt: string
  increment: string
  padding: string
}

const fallbackForm: FormState = {
  name: 'Padrao',
  labCode: 'CAL',
  projectCode: '',
  numberTemplate: '{labCode}-{yyyy}-{seq}',
  certificateNameTemplate: 'Certificado {number}',
  resetScope: 'year',
  startAt: '1',
  increment: '1',
  padding: '4',
}

const examples = [
  'LAB01-2026-000123',
  'CHEM/BR/2026/0456',
  'MICROBIO-APR-26-789',
]

function formFromConfig(response: ProfileResponse): FormState {
  const config = response.profile.config
  return {
    name: response.profile.name || 'Padrao',
    labCode: config.labCode,
    projectCode: config.projectCode ?? '',
    numberTemplate: config.numberTemplate,
    certificateNameTemplate: config.certificateNameTemplate,
    resetScope: config.sequence.resetScope,
    startAt: String(config.sequence.startAt),
    increment: String(config.sequence.increment),
    padding: String(config.sequence.padding),
  }
}

function buildPayload(form: FormState) {
  return {
    name: form.name.trim() || 'Padrao',
    config: {
      labCode: form.labCode.trim() || 'CAL',
      projectCode: form.projectCode.trim() || null,
      numberTemplate: form.numberTemplate.trim() || '{labCode}-{yyyy}-{seq}',
      certificateNameTemplate:
        form.certificateNameTemplate.trim() || 'Certificado {number}',
      sequence: {
        resetScope: form.resetScope,
        startAt: Number(form.startAt || 1),
        increment: Number(form.increment || 1),
        padding: Number(form.padding || 4),
      },
    },
  }
}

function CertificateNumberingSettingsPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(fallbackForm)

  const { data, isLoading } = useQuery({
    queryKey: ['certificate-numbering-profile'],
    queryFn: async () => {
      const res = await api.api['certificate-numbering'].$get()
      if (!res.ok) {
        throw new Error('Falha ao carregar perfil de numeração')
      }
      return res.json() as Promise<ProfileResponse>
    },
  })

  useEffect(() => {
    if (data) {
      setForm(formFromConfig(data))
    }
  }, [data])

  const preview = useMemo(() => buildLocalPreview(form), [form])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api['certificate-numbering'].$put({
        json: buildPayload(form),
      })
      if (!res.ok) {
        const error = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(error?.error ?? 'Falha ao salvar perfil')
      }
      return res.json()
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['certificate-numbering-profile'],
      })
      toast.success('Perfil de numeração salvo')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao salvar')
    },
  })

  if (isLoading) {
    return <CertificateNumberingSkeleton />
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-md border p-2">
              <HugeiconsIcon icon={Certificate01Icon} className="size-5" />
            </div>
            <div>
              <CardTitle>Numeração de certificados</CardTitle>
              <CardDescription>
                Defina como este laboratório gera números e nomes de
                certificados. Certificados antigos continuam com a numeração já
                emitida.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Nome do perfil</FieldLabel>
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </Field>

            <Field>
              <FieldLabel>Código do laboratório</FieldLabel>
              <Input
                value={form.labCode}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, labCode: event.target.value }))
                }
                placeholder="LAB01"
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Formato do número</FieldLabel>
              <Input
                value={form.numberTemplate}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    numberTemplate: event.target.value,
                  }))
                }
                placeholder="{labCode}-{yyyy}-{seq}"
              />
              <FieldDescription>
                Use tokens como {'{labCode}'}, {'{yyyy}'}, {'{mon}'} e {'{seq}'}
                .
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Nome do certificado</FieldLabel>
              <Input
                value={form.certificateNameTemplate}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    certificateNameTemplate: event.target.value,
                  }))
                }
                placeholder="Certificado {number}"
              />
              <FieldDescription>
                Use {'{number}'} para inserir o número gerado.
              </FieldDescription>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <Field>
              <FieldLabel>Reset da sequência</FieldLabel>
              <Select
                value={form.resetScope}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    resetScope: value as ResetScope,
                  }))
                }
              >
                <SelectTrigger>
                  {resetScopeLabels[form.resetScope]}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Nunca</SelectItem>
                  <SelectItem value="year">A cada ano</SelectItem>
                  <SelectItem value="month">A cada mês</SelectItem>
                  <SelectItem value="project">Por projeto</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>Iniciar em</FieldLabel>
              <Input
                type="number"
                min={0}
                value={form.startAt}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, startAt: event.target.value }))
                }
              />
            </Field>

            <Field>
              <FieldLabel>Incremento</FieldLabel>
              <Input
                type="number"
                min={1}
                value={form.increment}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    increment: event.target.value,
                  }))
                }
              />
            </Field>

            <Field>
              <FieldLabel>Dígitos</FieldLabel>
              <Input
                type="number"
                min={1}
                max={12}
                value={form.padding}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, padding: event.target.value }))
                }
              />
            </Field>
          </div>

          {form.resetScope === 'project' && (
            <Field className="max-w-md">
              <FieldLabel>Código do projeto padrão</FieldLabel>
              <Input
                value={form.projectCode}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    projectCode: event.target.value,
                  }))
                }
                placeholder="BR"
              />
            </Field>
          )}

          <div className="rounded-md border p-4">
            <h3 className="font-medium">Prévia</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">Número</p>
                <p className="font-mono text-lg">{preview.number}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Nome</p>
                <p className="text-lg">{preview.name}</p>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Chave de sequência: {preview.sequenceKey}
            </p>
          </div>

          <div className="rounded-md border p-4">
            <h3 className="font-medium">Formatos suportados</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {examples.map((example) => (
                <span
                  key={example}
                  className="rounded-md bg-muted px-2 py-1 font-mono text-sm"
                >
                  {example}
                </span>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Tokens: {(data?.supportedTokens ?? []).join(', ')}
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Salvando...' : 'Salvar perfil'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

const resetScopeLabels: Record<ResetScope, string> = {
  never: 'Nunca',
  year: 'A cada ano',
  month: 'A cada mês',
  project: 'Por projeto',
}

function buildLocalPreview(form: FormState) {
  const now = new Date()
  const yyyy = String(now.getFullYear())
  const month = now.getMonth() + 1
  const mon = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ][month - 1]
  const seq = String(123).padStart(Number(form.padding || 4), '0')
  const tokens: Record<string, string> = {
    number: '',
    labCode: form.labCode || 'CAL',
    labName: 'Laboratório',
    labSlug: 'laboratorio',
    projectCode: form.projectCode || 'GERAL',
    yyyy,
    yy: yyyy.slice(-2),
    mm: String(month).padStart(2, '0'),
    mon,
    dd: String(now.getDate()).padStart(2, '0'),
    seq,
  }
  const number = render(
    form.numberTemplate || fallbackForm.numberTemplate,
    tokens,
  )
  const name = render(
    form.certificateNameTemplate || fallbackForm.certificateNameTemplate,
    { ...tokens, number },
  )

  return {
    number,
    name,
    sequenceKey:
      form.resetScope === 'never'
        ? 'global'
        : form.resetScope === 'year'
          ? `year:${yyyy}`
          : form.resetScope === 'month'
            ? `month:${yyyy}-${String(month).padStart(2, '0')}`
            : `project:${form.projectCode || 'GERAL'}`,
  }
}

function render(template: string, tokens: Record<string, string>) {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, token) =>
    token in tokens ? tokens[token] : match,
  )
}

function CertificateNumberingSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-96" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-28 w-full" />
      </CardContent>
    </Card>
  )
}
