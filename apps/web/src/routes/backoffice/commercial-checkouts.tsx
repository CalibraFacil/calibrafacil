import { useMemo, useState } from 'react'
import { HelpCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  useBackofficeCommercialContextData,
  useBackofficeCommercialOrganizationsData,
} from '@/features/backoffice/queries'
import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { CommercialOfferSummaryCard } from '@/components/backoffice/commercial/summary-card'
import { CommercialOfferHistoryTable } from '@/components/backoffice/commercial/history-table'
import { CommercialStatusBadge } from '@/components/backoffice/commercial/status-badge'
import { ConsolePageHeader } from '@/features/backoffice/console'
import { brazilPhoneMask } from '@/lib/input-masks'

type OfferKind = 'SETUP_FEE' | 'PLAN_UPFRONT' | 'PLAN_RECURRING'
type PaymentMethod = 'PIX' | 'BOLETO' | 'CREDIT_CARD'
type BasePlanId = 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE'
type BillingCycle = 'MONTHLY' | 'YEARLY'
type CommercialOfferForm = {
  kind: OfferKind
  basePlanId: BasePlanId
  billingCycle: BillingCycle
  negotiatedAmount: string
  discountAmount: string
  setupFeeAmount: string
  contractTermMonths: string
  dueDate: string
  offerExpiresAt: string
  internalNotes: string
  customerVisibleDescription: string
  paymentMethods: PaymentMethod[]
}

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartão de crédito',
}

const KIND_DESCRIPTIONS: Record<OfferKind, string> = {
  PLAN_RECURRING:
    'Usado para cobrança recorrente do plano. O ciclo define a frequência da recorrência.',
  PLAN_UPFRONT:
    'Usado para cobrança única do plano. Nesta modalidade o ciclo fica anual, pois representa pagamento à vista do período contratado.',
  SETUP_FEE:
    'Usado apenas para taxa de implantação ou onboarding. Não gera recorrência e não usa ciclo de cobrança.',
}

const DEFAULT_FORM: CommercialOfferForm = {
  kind: 'PLAN_RECURRING',
  basePlanId: 'PROFESSIONAL',
  billingCycle: 'MONTHLY',
  negotiatedAmount: '0,00',
  discountAmount: '0,00',
  setupFeeAmount: '0,00',
  contractTermMonths: '12',
  dueDate: '',
  offerExpiresAt: '',
  internalNotes: '',
  customerVisibleDescription: '',
  paymentMethods: ['CREDIT_CARD'],
}

const PAYMENT_METHODS: PaymentMethod[] = ['PIX', 'BOLETO', 'CREDIT_CARD']

function offerKindFromInput(value: string): OfferKind {
  return value === 'SETUP_FEE' || value === 'PLAN_UPFRONT'
    ? value
    : 'PLAN_RECURRING'
}

function basePlanIdFromInput(value: string): BasePlanId {
  return value === 'STANDARD' || value === 'ENTERPRISE' ? value : 'PROFESSIONAL'
}

function billingCycleFromInput(value: string): BillingCycle {
  return value === 'YEARLY' ? 'YEARLY' : 'MONTHLY'
}

function paymentMethodFromInput(value: string): PaymentMethod {
  return value === 'PIX' || value === 'BOLETO' ? value : 'CREDIT_CARD'
}

function organizationIdFromSearch(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const organizationId = Reflect.get(value, 'organizationId')
  return typeof organizationId === 'string' ? organizationId : undefined
}

export const Route = createFileRoute('/backoffice/commercial-checkouts')({
  head: () => ({
    meta: [{ title: 'Receita | Backoffice | CalibraFácil' }],
  }),
  component: BackofficeCommercialCheckoutsPage,
})

type CommercialOfferPreview = NonNullable<
  React.ComponentProps<typeof CommercialOfferSummaryCard>['preview']
>
type IssuedOffer = NonNullable<
  React.ComponentProps<typeof CommercialOfferSummaryCard>['issuedOffer']
>

function BackofficeCommercialCheckoutsPage() {
  const queryClient = useQueryClient()
  const search = Route.useSearch()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<
    string | null
  >(organizationIdFromSearch(search) ?? null)
  const [billingContactId, setBillingContactId] = useState<number | undefined>(
    undefined,
  )
  const [form, setForm] = useState(DEFAULT_FORM)
  const [preview, setPreview] = useState<CommercialOfferPreview | null>(null)
  const [issuedOffer, setIssuedOffer] = useState<IssuedOffer | null>(null)
  const [newContact, setNewContact] = useState({
    name: '',
    email: '',
    phone: '',
    role: '',
    notes: '',
  })

  const organizationsQuery =
    useBackofficeCommercialOrganizationsData(searchTerm)
  const contextQuery = useBackofficeCommercialContextData(
    selectedOrganizationId,
  )
  const primaryBillingContact = contextQuery.data?.billingContacts.find(
    (contact) => contact.isPrimary,
  )
  const resolvedBillingContactId = billingContactId ?? primaryBillingContact?.id

  const syncBillingCustomerMutation = useMutation({
    mutationFn: async () => {
      const org = contextQuery.data?.organization
      if (!org) throw new Error('Selecione uma organização primeiro')

      return calibraApi.backoffice.commercial.syncBillingCustomer({
        organizationId: org.id,
        name: org.name,
        email: org.email ?? undefined,
        phone: org.phone ?? undefined,
        taxId: org.cnpj ?? undefined,
      })
    },
    onSuccess: () => {
      toast.success('Cliente de cobrança sincronizado')
      void queryClient.invalidateQueries({
        queryKey: [
          'backoffice',
          'commercial',
          'context',
          selectedOrganizationId,
        ],
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao sincronizar cliente',
      )
    },
  })

  const createBillingContactMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrganizationId) throw new Error('Selecione uma organização')

      return calibraApi.backoffice.commercial.createBillingContact<{
        contact: { id: number }
      }>({
        organizationId: selectedOrganizationId,
        ...newContact,
        isPrimary: contextQuery.data?.billingContacts.length === 0,
      })
    },
    onSuccess: (data) => {
      setBillingContactId(data.contact.id)
      setNewContact({ name: '', email: '', phone: '', role: '', notes: '' })
      toast.success('Contato de cobrança criado')
      void queryClient.invalidateQueries({
        queryKey: [
          'backoffice',
          'commercial',
          'context',
          selectedOrganizationId,
        ],
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao criar contato',
      )
    },
  })

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrganizationId) throw new Error('Selecione uma organização')
      return calibraApi.backoffice.commercial.previewOffer<CommercialOfferPreview>(
        buildOfferPayload(
          selectedOrganizationId,
          resolvedBillingContactId,
          form,
        ),
      )
    },
    onSuccess: (data) => setPreview(data),
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao pré-visualizar oferta',
      )
    },
  })

  const issueMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrganizationId) throw new Error('Selecione uma organização')

      return calibraApi.backoffice.commercial.issueOffer<{
        offer: IssuedOffer
      }>({
        ...buildOfferPayload(
          selectedOrganizationId,
          resolvedBillingContactId,
          form,
        ),
        idempotencyKey: crypto.randomUUID(),
      })
    },
    onSuccess: (data) => {
      setIssuedOffer(data.offer)
      toast.success('Oferta comercial emitida')
      void queryClient.invalidateQueries({
        queryKey: [
          'backoffice',
          'commercial',
          'context',
          selectedOrganizationId,
        ],
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao emitir oferta',
      )
    },
  })

  const cancelMutation = useMutation({
    mutationFn: async (offerId: string) => {
      return calibraApi.backoffice.commercial.cancelOffer(offerId, {
        reason: 'Cancelada pelo operador comercial',
      })
    },
    onSuccess: () => {
      toast.success('Oferta cancelada')
      void queryClient.invalidateQueries({
        queryKey: [
          'backoffice',
          'commercial',
          'context',
          selectedOrganizationId,
        ],
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao cancelar oferta',
      )
    },
  })

  const reissueMutation = useMutation({
    mutationFn: async (offerId: string) => {
      return calibraApi.backoffice.commercial.reissueOffer<{
        offer: IssuedOffer
      }>(offerId, {
        idempotencyKey: crypto.randomUUID(),
        overrides: buildOfferPayload(
          selectedOrganizationId!,
          resolvedBillingContactId,
          form,
        ),
      })
    },
    onSuccess: (data) => {
      setIssuedOffer(data.offer)
      toast.success('Oferta reemitida')
      void queryClient.invalidateQueries({
        queryKey: [
          'backoffice',
          'commercial',
          'context',
          selectedOrganizationId,
        ],
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao reemitir oferta',
      )
    },
  })

  const offerTypeLabel = useMemo(() => {
    switch (form.kind) {
      case 'SETUP_FEE':
        return 'Taxa de implantação'
      case 'PLAN_UPFRONT':
        return 'Plano à vista'
      case 'PLAN_RECURRING':
      default:
        return 'Plano recorrente'
    }
  }, [form.kind])

  const isSetupFee = form.kind === 'SETUP_FEE'
  const isUpfrontPlan = form.kind === 'PLAN_UPFRONT'
  const cycleDisabled = isSetupFee || isUpfrontPlan
  const cycleHelpText = isSetupFee
    ? 'Não se aplica para taxa de implantação.'
    : isUpfrontPlan
      ? 'Plano à vista é tratado como cobrança única anual.'
      : 'Define a frequência da recorrência do plano.'

  const selectedOrg = contextQuery.data?.organization

  const copyLink = async (
    offer?: { customerCheckoutUrl?: string | null } | null,
  ) => {
    if (!offer?.customerCheckoutUrl) return
    try {
      await navigator.clipboard.writeText(offer.customerCheckoutUrl)
      toast.success('Link copiado')
    } catch {
      toast.error('Não foi possível copiar o link')
    }
  }

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        eyebrow="Receita"
        title="Comercial"
        description="Emissão interna de propostas e links de pagamento personalizados via Asaas."
      />

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1.3fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Organização</CardTitle>
              <CardDescription>
                Pesquise e selecione a conta alvo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar por nome, slug ou CNPJ"
              />
              <div className="space-y-2">
                {organizationsQuery.data?.data.map((org) => (
                  <button
                    key={org.id}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                      selectedOrganizationId === org.id
                        ? 'border-primary bg-primary/5'
                        : ''
                    }`}
                    onClick={() => {
                      setSelectedOrganizationId(org.id)
                      setIssuedOffer(null)
                    }}
                    type="button"
                  >
                    <p className="font-medium">{org.name}</p>
                    <p className="text-muted-foreground">
                      {org.slug} · {org.cnpj || 'Sem CNPJ'}
                    </p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Perfil de cobrança</CardTitle>
              <CardDescription>
                Cliente de cobrança e contatos usados na emissão.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedOrg ? (
                <>
                  <div className="rounded-lg border p-4 text-sm">
                    <p className="font-medium">{selectedOrg.name}</p>
                    <p className="text-muted-foreground">
                      {selectedOrg.cnpj || 'CNPJ não informado'}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <CommercialStatusBadge
                        status={contextQuery.data?.subscription?.status}
                      />
                      {contextQuery.data?.subscription && (
                        <span className="text-muted-foreground">
                          {contextQuery.data.subscription.planId} ·{' '}
                          {contextQuery.data.subscription.billingCycle ||
                            'Sem ciclo'}
                        </span>
                      )}
                    </div>
                  </div>

                  {contextQuery.data?.billingCustomer ? (
                    <div className="rounded-lg border p-4 text-sm">
                      <p className="font-medium">Cliente Asaas sincronizado</p>
                      <p>{contextQuery.data.billingCustomer.name}</p>
                      <p className="text-muted-foreground">
                        {contextQuery.data.billingCustomer.email || 'Sem email'}{' '}
                        ·{' '}
                        {contextQuery.data.billingCustomer.phone ||
                          'Sem telefone'}
                      </p>
                    </div>
                  ) : (
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => syncBillingCustomerMutation.mutate()}
                      disabled={syncBillingCustomerMutation.isPending}
                    >
                      {syncBillingCustomerMutation.isPending
                        ? 'Sincronizando...'
                        : 'Sincronizar cliente de cobrança'}
                    </Button>
                  )}

                  <div className="space-y-2">
                    <p className="text-sm font-medium">Contato de cobrança</p>
                    <NativeSelect
                      className="w-full"
                      value={
                        resolvedBillingContactId
                          ? String(resolvedBillingContactId)
                          : ''
                      }
                      onChange={(event) =>
                        setBillingContactId(
                          event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        )
                      }
                    >
                      <NativeSelectOption value="">
                        Selecione um contato
                      </NativeSelectOption>
                      {contextQuery.data?.billingContacts.map((contact) => (
                        <NativeSelectOption
                          key={contact.id}
                          value={String(contact.id)}
                        >
                          {contact.name} · {contact.email}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>

                  <div className="grid gap-3">
                    <Input
                      value={newContact.name}
                      onChange={(event) =>
                        setNewContact((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Nome do contato"
                    />
                    <Input
                      value={newContact.email}
                      onChange={(event) =>
                        setNewContact((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      placeholder="Email"
                    />
                    <MaskedInput
                      value={newContact.phone}
                      type="tel"
                      inputMode="tel"
                      maskOptions={brazilPhoneMask}
                      onInput={(event) =>
                        setNewContact((current) => ({
                          ...current,
                          phone: event.currentTarget.value,
                        }))
                      }
                      placeholder="Telefone"
                    />
                    <Input
                      value={newContact.role}
                      onChange={(event) =>
                        setNewContact((current) => ({
                          ...current,
                          role: event.target.value,
                        }))
                      }
                      placeholder="Cargo/função"
                    />
                    <Textarea
                      value={newContact.notes}
                      onChange={(event) =>
                        setNewContact((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Observações internas do contato"
                    />
                    <Button
                      variant="outline"
                      onClick={() => createBillingContactMutation.mutate()}
                      disabled={createBillingContactMutation.isPending}
                    >
                      {createBillingContactMutation.isPending
                        ? 'Criando contato...'
                        : 'Criar contato de cobrança'}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Selecione uma organização para carregar o contexto comercial.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Oferta</CardTitle>
            <CardDescription>
              Defina o snapshot comercial antes da emissão.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel
                  label="Tipo de oferta"
                  tooltip="Escolha o modelo comercial que será emitido. O tipo altera as regras de ciclo, recorrência e ativação."
                />
                <NativeSelect
                  className="w-full"
                  value={form.kind}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      kind: offerKindFromInput(event.target.value),
                      billingCycle:
                        event.target.value === 'PLAN_RECURRING'
                          ? current.billingCycle
                          : 'YEARLY',
                    }))
                  }
                >
                  <NativeSelectOption value="PLAN_RECURRING">
                    Plano recorrente
                  </NativeSelectOption>
                  <NativeSelectOption value="PLAN_UPFRONT">
                    Plano à vista
                  </NativeSelectOption>
                  <NativeSelectOption value="SETUP_FEE">
                    Taxa de implantação
                  </NativeSelectOption>
                </NativeSelect>
                <p className="text-xs text-muted-foreground">
                  {KIND_DESCRIPTIONS[form.kind]}
                </p>
              </div>

              <div className="space-y-2">
                <FieldLabel
                  label="Plano base"
                  tooltip="Selecione o plano comercial de referência. Para taxa de implantação, esse campo não se aplica."
                />
                <NativeSelect
                  className="w-full"
                  value={form.basePlanId}
                  disabled={isSetupFee}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      basePlanId: basePlanIdFromInput(event.target.value),
                    }))
                  }
                >
                  <NativeSelectOption value="STANDARD">
                    Standard
                  </NativeSelectOption>
                  <NativeSelectOption value="PROFESSIONAL">
                    Professional
                  </NativeSelectOption>
                  <NativeSelectOption value="ENTERPRISE">
                    Enterprise
                  </NativeSelectOption>
                </NativeSelect>
                {isSetupFee && (
                  <p className="text-xs text-muted-foreground">
                    Taxa de implantação é emitida sem plano base.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <FieldLabel
                  label="Ciclo"
                  tooltip="Em plano recorrente, o ciclo define se a cobrança renova mensalmente ou anualmente. Em plano à vista, o valor representa pagamento único do período contratado. Em taxa de implantação, ciclo não se aplica."
                />
                <NativeSelect
                  className="w-full"
                  value={isSetupFee ? 'NONE' : form.billingCycle}
                  disabled={cycleDisabled}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      billingCycle: billingCycleFromInput(event.target.value),
                    }))
                  }
                >
                  {isSetupFee ? (
                    <NativeSelectOption value="NONE">
                      Não se aplica
                    </NativeSelectOption>
                  ) : isUpfrontPlan ? (
                    <NativeSelectOption value="YEARLY">
                      Anual
                    </NativeSelectOption>
                  ) : (
                    <>
                      <NativeSelectOption value="MONTHLY">
                        Mensal
                      </NativeSelectOption>
                      <NativeSelectOption value="YEARLY">
                        Anual
                      </NativeSelectOption>
                    </>
                  )}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">{cycleHelpText}</p>
              </div>

              <div className="space-y-2">
                <FieldLabel
                  label="Duração do contrato (meses)"
                  tooltip="Metadado comercial para registrar o prazo negociado, por exemplo 12 meses. Não altera sozinho a frequência da cobrança."
                />
                <Input
                  type="number"
                  min={1}
                  value={form.contractTermMonths}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      contractTermMonths: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {isSetupFee ? 'Valor da taxa (R$)' : 'Preço negociado (R$)'}
                </label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="1490,00"
                  value={form.negotiatedAmount}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      negotiatedAmount: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Desconto (R$)</label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={form.discountAmount}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      discountAmount: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Vencimento</label>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dueDate: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Expiração da oferta
                </label>
                <Input
                  type="date"
                  value={form.offerExpiresAt}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      offerExpiresAt: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Método de pagamento</label>
              <NativeSelect
                className="w-full"
                value={form.paymentMethods[0] ?? 'CREDIT_CARD'}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    paymentMethods: [
                      paymentMethodFromInput(event.target.value),
                    ],
                  }))
                }
              >
                {PAYMENT_METHODS.map((method) => (
                  <NativeSelectOption key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                Cada oferta comercial usa um único método de pagamento.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Descrição para o cliente
              </label>
              <Textarea
                value={form.customerVisibleDescription}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    customerVisibleDescription: event.target.value,
                  }))
                }
                placeholder="Resumo visível na cobrança"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Notas internas</label>
              <Textarea
                value={form.internalNotes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    internalNotes: event.target.value,
                  }))
                }
                placeholder="Contexto interno da negociação"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => previewMutation.mutate()}
                disabled={!selectedOrganizationId}
              >
                Pré-visualizar
              </Button>
              <Button
                variant="outline"
                onClick={() => issueMutation.mutate()}
                disabled={!selectedOrganizationId || issueMutation.isPending}
              >
                {issueMutation.isPending ? 'Emitindo...' : 'Emitir oferta'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <CommercialOfferSummaryCard
          preview={preview}
          issuedOffer={issuedOffer}
          offerTypeLabel={offerTypeLabel}
          onCopyLink={() => copyLink(issuedOffer)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ofertas emitidas</CardTitle>
          <CardDescription>
            Histórico recente da organização selecionada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedOrganizationId && contextQuery.data?.deals?.[0] ? (
            <div className="rounded-lg border p-4 text-sm">
              <p className="font-medium">Deal mais recente</p>
              <p>{contextQuery.data.deals[0].title}</p>
              <p className="text-muted-foreground">
                {contextQuery.data.deals[0].status} ·{' '}
                <Link
                  className="underline"
                  to="/backoffice/commercial-checkouts"
                  search={{ organizationId: selectedOrganizationId }}
                >
                  manter contexto
                </Link>
              </p>
            </div>
          ) : null}

          <CommercialOfferHistoryTable
            offers={contextQuery.data?.recentOffers || []}
            onCopyLink={(offer) => void copyLink(offer)}
            onCancel={(offerId) => cancelMutation.mutate(offerId)}
            onReissue={(offerId) => reissueMutation.mutate(offerId)}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function buildOfferPayload(
  organizationId: string,
  billingContactId: number | undefined,
  form: typeof DEFAULT_FORM,
) {
  return {
    organizationId,
    billingContactId,
    kind: form.kind,
    basePlanId: form.kind === 'SETUP_FEE' ? undefined : form.basePlanId,
    billingCycle: form.kind === 'SETUP_FEE' ? undefined : form.billingCycle,
    contractTermMonths: Number(form.contractTermMonths || 0) || undefined,
    negotiatedAmount: parseMoneyInputToCents(form.negotiatedAmount),
    discountAmount: parseMoneyInputToCents(form.discountAmount),
    setupFeeAmount: parseMoneyInputToCents(form.setupFeeAmount),
    dueDate: form.dueDate || undefined,
    offerExpiresAt: form.offerExpiresAt || undefined,
    paymentMethods: form.paymentMethods,
    customerVisibleDescription: form.customerVisibleDescription || undefined,
    internalNotes: form.internalNotes || undefined,
    items: [],
  }
}

function parseMoneyInputToCents(value: string) {
  const normalized = value.trim()

  if (!normalized) return 0

  const hasComma = normalized.includes(',')
  const digitsOnly = normalized.replace(/\s/g, '')

  if (hasComma) {
    const brlNormalized = digitsOnly.replace(/\./g, '').replace(',', '.')
    const amount = Number(brlNormalized)
    return Number.isFinite(amount) ? Math.round(amount * 100) : 0
  }

  const amount = Number(digitsOnly)
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}

function FieldLabel(props: { label: string; tooltip: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-sm font-medium">{props.label}</label>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              className="text-muted-foreground transition-colors hover:text-foreground"
              type="button"
              aria-label={`Ajuda sobre ${props.label}`}
            />
          }
        >
          <HugeiconsIcon icon={HelpCircleIcon} size={16} />
        </TooltipTrigger>
        <TooltipContent className="max-w-72 text-pretty">
          {props.tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
