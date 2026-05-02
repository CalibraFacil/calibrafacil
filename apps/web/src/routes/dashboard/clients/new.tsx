import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft01Icon,
  Copy01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export const Route = createFileRoute('/dashboard/clients/new')({
  head: () => ({
    meta: [{ title: 'Novo Cliente | CalibraFácil' }],
  }),
  component: NewClientPage,
})

interface FormData {
  name: string
  taxId: string
  email: string
  phone: string
  address: {
    cep: string
    street: string
    number: string
    neighbourhood: string
    city: string
    state: string
  }
}

const initialFormData: FormData = {
  name: '',
  taxId: '',
  email: '',
  phone: '',
  address: {
    cep: '',
    street: '',
    number: '',
    neighbourhood: '',
    city: '',
    state: '',
  },
}

const DEFAULT_PRODUCTION_PORTAL_URL = 'https://portal.calibrafacil.com'
const DEFAULT_DEVELOPMENT_PORTAL_PORT = '5174'

function getPortalBaseUrl() {
  const configuredPortalUrl = import.meta.env.VITE_PORTAL_APP_URL?.trim()
  if (configuredPortalUrl) {
    return configuredPortalUrl.replace(/\/+$/, '')
  }

  const { hostname, protocol } = window.location
  const isLocalHost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)

  if (isLocalHost) {
    return `${protocol}//${hostname}:${DEFAULT_DEVELOPMENT_PORTAL_PORT}`
  }

  return DEFAULT_PRODUCTION_PORTAL_URL
}

function NewClientPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<FormData>(initialFormData)
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>(
    {},
  )

  // Invitation dialog state
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [invitationId, setInvitationId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Generate the invitation URL for the portal
  const getInviteUrl = () => {
    if (!invitationId) return ''
    return `${getPortalBaseUrl()}/accept-invite?token=${invitationId}`
  }

  const handleCopyLink = async () => {
    const url = getInviteUrl()
    await navigator.clipboard.writeText(url)
    setCopied(true)
    toast.success('Link copiado!')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCloseDialog = () => {
    setShowInviteDialog(false)
    navigate({ to: '/dashboard/clients' })
  }

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await api.api.customers.$post({
        json: {
          name: data.name,
          taxId: data.taxId || undefined,
          email: data.email || undefined,
          phone: data.phone || undefined,
          address:
            data.address.cep || data.address.street || data.address.city
              ? {
                  cep: data.address.cep || undefined,
                  street: data.address.street || undefined,
                  number: data.address.number || undefined,
                  neighbourhood: data.address.neighbourhood || undefined,
                  city: data.address.city || undefined,
                  state: data.address.state || undefined,
                }
              : undefined,
        },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao criar cliente',
        )
      }

      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })

      // Check if the response contains an invitationId
      const result = data as { invitationId?: string | null }
      if (result.invitationId) {
        setInvitationId(result.invitationId)
        setShowInviteDialog(true)
      } else {
        toast.success('Cliente criado com sucesso!')
        navigate({ to: '/dashboard/clients' })
      }
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Informe o nome ou razão social do cliente.'
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Use pelo menos 2 caracteres para identificar o cliente.'
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Revise o endereço de email antes de enviar o convite.'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!validate()) {
      return
    }

    createMutation.mutate(formData)
  }

  const updateField = <TKey extends keyof FormData>(
    field: TKey,
    value: FormData[TKey],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const updateAddressField = (
    field: keyof FormData['address'],
    value: string,
  ) => {
    setFormData((prev) => ({
      ...prev,
      address: { ...prev.address, [field]: value },
    }))
  }

  const hasAddress = Object.values(formData.address).some(Boolean)
  const registrationSummary = [
    {
      label: 'Identificação',
      value: formData.name || 'Nome pendente',
      complete: formData.name.trim().length >= 2,
    },
    {
      label: 'Portal',
      value: formData.email ? 'Convite será enviado' : 'Sem convite automático',
      complete: Boolean(formData.email),
    },
    {
      label: 'Endereço',
      value: hasAddress ? 'Endereço informado' : 'Opcional',
      complete: hasAddress,
    },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="border-b pb-5">
        <div className="min-w-0 space-y-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: '/dashboard/clients' })}
            className="-ml-2"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
            Voltar
          </Button>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">
              Novo Cliente
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
              Cadastre os dados essenciais do cliente. Quando um email é
              informado, o convite para o portal é enviado automaticamente.
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <form
          id="client-registration-form"
          onSubmit={handleSubmit}
          className="min-w-0"
        >
          <FieldGroup className="gap-0 divide-y">
            <FormSection
              title="Identificação"
              description="Nome público e documentos usados em ordens, ativos e certificados."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="name">Nome / Razão Social *</FieldLabel>
                  <Input
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="Ex.: Empresa ACME…"
                    disabled={createMutation.isPending}
                    autoComplete="organization"
                    aria-invalid={Boolean(errors.name)}
                    aria-describedby={errors.name ? 'name-error' : undefined}
                  />
                  {errors.name && (
                    <FieldError id="name-error">{errors.name}</FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="taxId">CNPJ / CPF</FieldLabel>
                  <Input
                    id="taxId"
                    name="taxId"
                    value={formData.taxId}
                    onChange={(e) => updateField('taxId', e.target.value)}
                    placeholder="Ex.: 00.000.000/0000-00…"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="Contato e Portal"
              description="Canal principal de atendimento e convite de acesso do cliente."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => updateField('email', e.target.value)}
                    placeholder="Ex.: contato@empresa.com…"
                    disabled={createMutation.isPending}
                    autoComplete="email"
                    spellCheck={false}
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={
                      errors.email ? 'email-error' : 'email-description'
                    }
                  />
                  <FieldDescription id="email-description">
                    Enviaremos o convite do portal para este endereço.
                  </FieldDescription>
                  {errors.email && (
                    <FieldError id="email-error">{errors.email}</FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="phone">Telefone</FieldLabel>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    value={formData.phone}
                    onChange={(e) => updateField('phone', e.target.value)}
                    placeholder="Ex.: (11) 99999-9999…"
                    disabled={createMutation.isPending}
                    autoComplete="tel"
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="Endereço"
              description="Opcional, mas útil para documentos comerciais e entregas."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="cep">CEP</FieldLabel>
                  <Input
                    id="cep"
                    name="postalCode"
                    value={formData.address.cep}
                    onChange={(e) => updateAddressField('cep', e.target.value)}
                    placeholder="Ex.: 00000-000…"
                    disabled={createMutation.isPending}
                    autoComplete="postal-code"
                    spellCheck={false}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="state">Estado</FieldLabel>
                  <Input
                    id="state"
                    name="state"
                    value={formData.address.state}
                    onChange={(e) =>
                      updateAddressField('state', e.target.value)
                    }
                    placeholder="Ex.: SP…"
                    disabled={createMutation.isPending}
                    autoComplete="address-level1"
                    spellCheck={false}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="city">Cidade</FieldLabel>
                  <Input
                    id="city"
                    name="city"
                    value={formData.address.city}
                    onChange={(e) => updateAddressField('city', e.target.value)}
                    placeholder="Ex.: São Paulo…"
                    disabled={createMutation.isPending}
                    autoComplete="address-level2"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="neighbourhood">Bairro</FieldLabel>
                  <Input
                    id="neighbourhood"
                    name="neighbourhood"
                    value={formData.address.neighbourhood}
                    onChange={(e) =>
                      updateAddressField('neighbourhood', e.target.value)
                    }
                    placeholder="Ex.: Centro…"
                    disabled={createMutation.isPending}
                    autoComplete="address-level3"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="street">Rua</FieldLabel>
                  <Input
                    id="street"
                    name="street"
                    value={formData.address.street}
                    onChange={(e) =>
                      updateAddressField('street', e.target.value)
                    }
                    placeholder="Ex.: Rua das Flores…"
                    disabled={createMutation.isPending}
                    autoComplete="address-line1"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="number">Número</FieldLabel>
                  <Input
                    id="number"
                    name="addressNumber"
                    value={formData.address.number}
                    onChange={(e) =>
                      updateAddressField('number', e.target.value)
                    }
                    placeholder="Ex.: 123…"
                    disabled={createMutation.isPending}
                    autoComplete="address-line2"
                  />
                </Field>
              </div>
            </FormSection>

            <div className="flex flex-col-reverse gap-3 pt-6 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/dashboard/clients' })}
                disabled={createMutation.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Salvando…' : 'Criar Cliente'}
              </Button>
            </div>
          </FieldGroup>
        </form>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="border-l pl-5">
            <h2 className="text-sm font-medium">Resumo do Cadastro</h2>
            <dl className="mt-4 space-y-4">
              {registrationSummary.map((item) => (
                <div key={item.label} className="space-y-1">
                  <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span
                      className={`size-1.5 rounded-full ${
                        item.complete ? 'bg-primary' : 'bg-muted-foreground/35'
                      }`}
                    />
                    {item.label}
                  </dt>
                  <dd className="min-w-0 truncate text-sm text-foreground">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 border-t pt-4 text-xs leading-5 text-muted-foreground text-pretty">
              O cadastro fica disponível para ativos, ordens e acesso ao portal
              assim que for criado.
            </p>
          </div>
        </aside>
      </div>

      {/* Invitation Link Dialog */}
      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Cliente Criado com Sucesso</DialogTitle>
            <DialogDescription>
              Um link de convite foi gerado para o cliente acessar o portal.
              Copie e envie para o cliente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Field>
              <FieldLabel htmlFor="invite-link">Link de Convite</FieldLabel>
              <div className="flex min-w-0 gap-2">
                <Input
                  id="invite-link"
                  name="inviteLink"
                  value={getInviteUrl()}
                  readOnly
                  className="font-mono text-xs"
                  aria-describedby="invite-link-description"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopyLink}
                  aria-label="Copiar link de convite"
                >
                  <HugeiconsIcon
                    icon={copied ? Tick02Icon : Copy01Icon}
                    className="size-4"
                    aria-hidden="true"
                  />
                </Button>
              </div>
              <FieldDescription id="invite-link-description" aria-live="polite">
                {copied
                  ? 'Link copiado.'
                  : 'Este link permite que o cliente crie uma conta e acesse o portal.'}
              </FieldDescription>
            </Field>
          </div>

          <DialogFooter>
            <Button onClick={handleCloseDialog}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-5 py-6 lg:grid-cols-[180px_minmax(0,1fr)]">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-balance">{title}</h2>
        {description && (
          <p className="text-sm leading-5 text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}
