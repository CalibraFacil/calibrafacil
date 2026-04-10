import { useMemo, useState } from 'react'
import { HelpCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

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

type OfferKind = 'SETUP_FEE' | 'PLAN_UPFRONT' | 'PLAN_RECURRING'
type PaymentMethod = 'PIX' | 'BOLETO' | 'CREDIT_CARD'

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

const DEFAULT_FORM = {
  kind: 'PLAN_RECURRING' as OfferKind,
  basePlanId: 'PROFESSIONAL' as 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE',
  billingCycle: 'MONTHLY' as 'MONTHLY' | 'YEARLY',
  negotiatedAmount: '0,00',
  discountAmount: '0,00',
  setupFeeAmount: '0,00',
  contractTermMonths: '12',
  dueDate: '',
  offerExpiresAt: '',
  internalNotes: '',
  customerVisibleDescription: '',
  paymentMethods: ['CREDIT_CARD'] as PaymentMethod[],
}

export const Route = createFileRoute('/backoffice/commercial-checkouts')({
  component: BackofficeCommercialCheckoutsPage,
})

function BackofficeCommercialCheckoutsPage() {
  const queryClient = useQueryClient()
  const search = Route.useSearch() as { organizationId?: string } | undefined
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(
    search?.organizationId ?? null,
  )
  const [billingContactId, setBillingContactId] = useState<number | undefined>(undefined)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [preview, setPreview] = useState<any | null>(null)
  const [issuedOffer, setIssuedOffer] = useState<any | null>(null)
  const [newContact, setNewContact] = useState({
    name: '',
    email: '',
    phone: '',
    role: '',
    notes: '',
  })

  const organizationsQuery = useQuery({
    queryKey: ['backoffice', 'commercial', 'organizations', searchTerm],
    queryFn: async () => {
      const res = await api.api.backoffice.commercial.organizations.$get({
        query: searchTerm ? { search: searchTerm } : {},
      })
      if (!res.ok) throw new Error('Falha ao buscar organizações')
      return res.json() as Promise<{
        data: Array<{ id: string; name: string; slug: string; cnpj: string | null }>
      }>
    },
  })

  const contextQuery = useQuery({
    queryKey: ['backoffice', 'commercial', 'context', selectedOrganizationId],
    queryFn: async () => {
      const res = await api.api.backoffice.commercial.organizations[':organizationId'].context.$get(
        {
          param: { organizationId: selectedOrganizationId! },
        },
      )
      if (!res.ok) throw new Error('Falha ao carregar contexto comercial')
      return res.json() as Promise<{
        organization: {
          id: string
          name: string
          cnpj: string | null
          email: string | null
          phone: string | null
        }
        subscription: {
          planId: string
          status: string
          billingCycle: string | null
        } | null
        billingCustomer: {
          id: number
          name: string
          email: string | null
          phone: string | null
        } | null
        billingContacts: Array<{
          id: number
          name: string
          email: string
          isPrimary: boolean
        }>
        recentOffers: Array<{
          id: string
          kind: string
          status: string
          totalAmount: number
          issuedAt?: string | null
          offerExpiresAt?: string | null
          paidAt?: string | null
          customerCheckoutUrl?: string | null
        }>
        deals: Array<{ id: string; title: string; status: string }>
      }>
    },
    enabled: !!selectedOrganizationId,
  })
  const primaryBillingContact = contextQuery.data?.billingContacts.find((contact) =>
    contact.isPrimary,
  )
  const resolvedBillingContactId = billingContactId ?? primaryBillingContact?.id

  const syncBillingCustomerMutation = useMutation({
    mutationFn: async () => {
      const org = contextQuery.data?.organization
      if (!org) throw new Error('Selecione uma organização primeiro')

      const res = await api.api.backoffice.commercial['billing-customer'].sync.$post({
        json: {
          organizationId: org.id,
          name: org.name,
          email: org.email ?? undefined,
          phone: org.phone ?? undefined,
          taxId: org.cnpj ?? undefined,
        },
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error((payload as { error?: string } | null)?.error || 'Falha ao sincronizar cliente')
      }

      return res.json()
    },
    onSuccess: () => {
      toast.success('Cliente de cobrança sincronizado')
      void queryClient.invalidateQueries({
        queryKey: ['backoffice', 'commercial', 'context', selectedOrganizationId],
      })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Falha ao sincronizar cliente')
    },
  })

  const createBillingContactMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrganizationId) throw new Error('Selecione uma organização')

      const res = await api.api.backoffice.commercial['billing-contacts'].$post({
        json: {
          organizationId: selectedOrganizationId,
          ...newContact,
          isPrimary: contextQuery.data?.billingContacts.length === 0,
        },
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error((payload as { error?: string } | null)?.error || 'Falha ao criar contato')
      }
      return res.json() as Promise<{ contact: { id: number } }>
    },
    onSuccess: (data) => {
      setBillingContactId(data.contact.id)
      setNewContact({ name: '', email: '', phone: '', role: '', notes: '' })
      toast.success('Contato de cobrança criado')
      void queryClient.invalidateQueries({
        queryKey: ['backoffice', 'commercial', 'context', selectedOrganizationId],
      })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Falha ao criar contato')
    },
  })

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrganizationId) throw new Error('Selecione uma organização')
      const res = await api.api.backoffice.commercial.offers.preview.$post({
        json: buildOfferPayload(selectedOrganizationId, resolvedBillingContactId, form),
      })
      if (!res.ok) throw new Error('Falha ao gerar prévia')
      return res.json()
    },
    onSuccess: (data) => setPreview(data),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Falha ao pré-visualizar oferta')
    },
  })

  const issueMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrganizationId) throw new Error('Selecione uma organização')

      const res = await api.api.backoffice.commercial.offers.$post({
        json: {
          ...buildOfferPayload(selectedOrganizationId, resolvedBillingContactId, form),
          idempotencyKey: crypto.randomUUID(),
        },
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error((payload as { error?: string } | null)?.error || 'Falha ao emitir oferta')
      }
      return payload as { offer: any }
    },
    onSuccess: (data) => {
      setIssuedOffer(data.offer)
      toast.success('Oferta comercial emitida')
      void queryClient.invalidateQueries({
        queryKey: ['backoffice', 'commercial', 'context', selectedOrganizationId],
      })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Falha ao emitir oferta')
    },
  })

  const cancelMutation = useMutation({
    mutationFn: async (offerId: string) => {
      const res = await api.api.backoffice.commercial.offers[':offerId'].cancel.$post({
        param: { offerId },
        json: { reason: 'Cancelada pelo operador comercial' },
      })
      if (!res.ok) throw new Error('Falha ao cancelar oferta')
      return res.json()
    },
    onSuccess: () => {
      toast.success('Oferta cancelada')
      void queryClient.invalidateQueries({
        queryKey: ['backoffice', 'commercial', 'context', selectedOrganizationId],
      })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Falha ao cancelar oferta')
    },
  })

  const reissueMutation = useMutation({
    mutationFn: async (offerId: string) => {
      const res = await api.api.backoffice.commercial.offers[':offerId'].reissue.$post({
        param: { offerId },
        json: {
          idempotencyKey: crypto.randomUUID(),
          overrides: buildOfferPayload(selectedOrganizationId!, resolvedBillingContactId, form),
        },
      })
      if (!res.ok) throw new Error('Falha ao reemitir oferta')
      return res.json()
    },
    onSuccess: (data) => {
      setIssuedOffer((data as { offer: any }).offer)
      toast.success('Oferta reemitida')
      void queryClient.invalidateQueries({
        queryKey: ['backoffice', 'commercial', 'context', selectedOrganizationId],
      })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Falha ao reemitir oferta')
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

  const copyLink = async (offer?: { customerCheckoutUrl?: string | null } | null) => {
    if (!offer?.customerCheckoutUrl) return
    try {
      await navigator.clipboard.writeText(offer.customerCheckoutUrl)
      toast.success('Link copiado')
    } catch {
      toast.error('Não foi possível copiar o link')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Checkout Comercial</h1>
        <p className="text-sm text-muted-foreground">
          Emissão interna de propostas e links de pagamento personalizados via Asaas.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1.3fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Organização</CardTitle>
              <CardDescription>Pesquise e selecione a conta alvo.</CardDescription>
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
                      selectedOrganizationId === org.id ? 'border-primary bg-primary/5' : ''
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
                      <CommercialStatusBadge status={contextQuery.data?.subscription?.status} />
                      {contextQuery.data?.subscription && (
                        <span className="text-muted-foreground">
                          {contextQuery.data.subscription.planId} ·{' '}
                          {contextQuery.data.subscription.billingCycle || 'Sem ciclo'}
                        </span>
                      )}
                    </div>
                  </div>

                  {contextQuery.data?.billingCustomer ? (
                    <div className="rounded-lg border p-4 text-sm">
                      <p className="font-medium">Cliente Asaas sincronizado</p>
                      <p>{contextQuery.data.billingCustomer.name}</p>
                      <p className="text-muted-foreground">
                        {contextQuery.data.billingCustomer.email || 'Sem email'} ·{' '}
                        {contextQuery.data.billingCustomer.phone || 'Sem telefone'}
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
                      value={resolvedBillingContactId ? String(resolvedBillingContactId) : ''}
                      onChange={(event) =>
                        setBillingContactId(
                          event.target.value ? Number(event.target.value) : undefined,
                        )
                      }
                    >
                      <NativeSelectOption value="">Selecione um contato</NativeSelectOption>
                      {contextQuery.data?.billingContacts.map((contact) => (
                        <NativeSelectOption key={contact.id} value={String(contact.id)}>
                          {contact.name} · {contact.email}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>

                  <div className="grid gap-3">
                    <Input
                      value={newContact.name}
                      onChange={(event) =>
                        setNewContact((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder="Nome do contato"
                    />
                    <Input
                      value={newContact.email}
                      onChange={(event) =>
                        setNewContact((current) => ({ ...current, email: event.target.value }))
                      }
                      placeholder="Email"
                    />
                    <Input
                      value={newContact.phone}
                      onChange={(event) =>
                        setNewContact((current) => ({ ...current, phone: event.target.value }))
                      }
                      placeholder="Telefone"
                    />
                    <Input
                      value={newContact.role}
                      onChange={(event) =>
                        setNewContact((current) => ({ ...current, role: event.target.value }))
                      }
                      placeholder="Cargo/função"
                    />
                    <Textarea
                      value={newContact.notes}
                      onChange={(event) =>
                        setNewContact((current) => ({ ...current, notes: event.target.value }))
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
                      kind: event.target.value as OfferKind,
                      billingCycle:
                        event.target.value === 'PLAN_RECURRING'
                          ? current.billingCycle
                          : 'YEARLY',
                    }))
                  }
                >
                  <NativeSelectOption value="PLAN_RECURRING">Plano recorrente</NativeSelectOption>
                  <NativeSelectOption value="PLAN_UPFRONT">Plano à vista</NativeSelectOption>
                  <NativeSelectOption value="SETUP_FEE">Taxa de implantação</NativeSelectOption>
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
                      basePlanId: event.target.value as typeof current.basePlanId,
                    }))
                  }
                >
                  <NativeSelectOption value="STANDARD">Standard</NativeSelectOption>
                  <NativeSelectOption value="PROFESSIONAL">Professional</NativeSelectOption>
                  <NativeSelectOption value="ENTERPRISE">Enterprise</NativeSelectOption>
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
                      billingCycle: event.target.value as 'MONTHLY' | 'YEARLY',
                    }))
                  }
                >
                  {isSetupFee ? (
                    <NativeSelectOption value="NONE">Não se aplica</NativeSelectOption>
                  ) : isUpfrontPlan ? (
                    <NativeSelectOption value="YEARLY">Anual</NativeSelectOption>
                  ) : (
                    <>
                      <NativeSelectOption value="MONTHLY">Mensal</NativeSelectOption>
                      <NativeSelectOption value="YEARLY">Anual</NativeSelectOption>
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
                    setForm((current) => ({ ...current, dueDate: event.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Expiração da oferta</label>
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
                    paymentMethods: [event.target.value as PaymentMethod],
                  }))
                }
              >
                {(['PIX', 'BOLETO', 'CREDIT_CARD'] as PaymentMethod[]).map((method) => (
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
              <label className="text-sm font-medium">Descrição para o cliente</label>
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
                  setForm((current) => ({ ...current, internalNotes: event.target.value }))
                }
                placeholder="Contexto interno da negociação"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => previewMutation.mutate()} disabled={!selectedOrganizationId}>
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
