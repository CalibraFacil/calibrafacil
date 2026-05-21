import { useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  ArrowDown01Icon,
  Building02Icon,
  DollarCircleIcon,
  Invoice01Icon,
  Location01Icon,
  Mail01Icon,
  UserAccountIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { formatMoney } from '@calibra-facil/shared'
import { calibraApi } from '@/utils/api'
import { useCustomerDetailData } from '@/features/customers/queries'
import type {
  CustomerAddress,
  CustomerDetail,
} from '@/features/customers/types'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { clientRouteId } from '@/lib/route-identifiers'
import { brazilPhoneMask, cepMask, cpfCnpjMask } from '@/lib/input-masks'
import {
  mergeViaCepAddress,
  type ViaCepAddress,
  useViaCepLookup,
} from '@/lib/viacep'
import {
  ClientMetric,
  ClientMetricStrip,
  ClientPanel,
  ClientPanelBody,
  ClientSection,
} from '@/features/customers/components/client-detail-ui'
import {
  shouldReturnToSyncConflicts,
  SyncConflictReturnNotice,
  type SyncConflictReturnSearch,
} from '@/runtime/sync-conflict-return'

export function ClientInfoTab({
  id,
  conflictReturn,
}: {
  id: string
  conflictReturn: SyncConflictReturnSearch
}) {
  const { data: customer, isLoading } = useCustomerDetailData(id)

  if (isLoading) {
    return <InfoSkeleton />
  }

  if (!customer) {
    return (
      <div className="rounded-2xl bg-card px-6 py-10 text-center text-sm text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.05),0_18px_45px_rgba(15,23,42,0.08)] ring-1 ring-foreground/10 dark:shadow-none">
        Cliente não encontrado
      </div>
    )
  }

  return (
    <ClientInfoForm
      key={customer.id}
      customer={customer}
      customerId={id}
      conflictReturn={conflictReturn}
    />
  )
}

function ClientInfoForm({
  customer,
  customerId,
  conflictReturn,
}: {
  customer: CustomerDetail
  customerId: string
  conflictReturn: SyncConflictReturnSearch
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [addressOpen, setAddressOpen] = useState(false)

  const [name, setName] = useState(customer.name || '')
  const [taxId, setTaxId] = useState(customer.taxId || '')
  const [email, setEmail] = useState(customer.email || '')
  const [phone, setPhone] = useState(customer.phone || '')
  const [address, setAddress] = useState<CustomerAddress>(
    customer.address || {},
  )
  const [formError, setFormError] = useState<string | null>(null)

  const updateMutation = useMutation({
    mutationFn: async (data: {
      name?: string
      taxId?: string
      email?: string
      phone?: string
      address?: CustomerAddress
    }) => {
      return calibraApi.customers.update(customerId, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      toast.success('Cliente atualizado com sucesso!')
      if (shouldReturnToSyncConflicts(conflictReturn)) {
        navigate({ to: '/dashboard/sync/conflicts' })
        return
      }
      navigate({
        to: '/dashboard/clients/$id/info',
        params: {
          id: clientRouteId({
            name: name.trim(),
            taxId: taxId.trim() || null,
          }),
        },
      })
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao atualizar cliente')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!name.trim()) {
      setFormError('Informe o nome ou razão social do cliente.')
      return
    }

    const hasAddressData = Object.values(address).some(
      (v) => typeof v === 'string' && v.trim() !== '',
    )

    updateMutation.mutate({
      name: name.trim(),
      taxId: taxId.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      address: hasAddressData ? address : undefined,
    })
  }

  const updateAddress = (field: keyof CustomerAddress, value: string) => {
    setAddress((prev) => ({ ...prev, [field]: value }))
  }

  const handleViaCepResolved = useCallback((lookupAddress: ViaCepAddress) => {
    setAddress((prev) => mergeViaCepAddress(prev, lookupAddress))
  }, [])

  const cepLookup = useViaCepLookup({
    cep: address.cep || '',
    disabled: updateMutation.isPending || !addressOpen,
    onResolved: handleViaCepResolved,
  })

  const financialSummary = customer.financialSummary

  return (
    <div className="space-y-6">
      <SyncConflictReturnNotice search={conflictReturn} />
      <ClientPanel
        eyebrow="Cadastro"
        title="Informações do Cliente"
        description="Dados cadastrais, contato principal e endereço usados no atendimento, nas ordens de serviço e nos documentos financeiros."
        icon={<HugeiconsIcon icon={UserAccountIcon} className="size-5" />}
        action={
          <Button
            type="submit"
            form="client-info-form"
            disabled={updateMutation.isPending}
            className="w-full active:scale-[0.96] transition-[background-color,color,box-shadow,border-color,transform] sm:w-auto"
          >
            {updateMutation.isPending ? 'Salvando…' : 'Salvar Alterações'}
          </Button>
        }
      >
        <ClientMetricStrip>
          <ClientMetric
            icon={<HugeiconsIcon icon={Invoice01Icon} className="size-4" />}
            label="Documentos em Aberto"
            value={String(financialSummary?.openDocumentsCount ?? 0)}
          />
          <ClientMetric
            icon={<HugeiconsIcon icon={Invoice01Icon} className="size-4" />}
            label="Documentos Vencidos"
            tone={
              (financialSummary?.overdueDocumentsCount ?? 0) > 0
                ? 'danger'
                : 'default'
            }
            value={String(financialSummary?.overdueDocumentsCount ?? 0)}
          />
          <ClientMetric
            icon={<HugeiconsIcon icon={DollarCircleIcon} className="size-4" />}
            label="Saldo em Aberto"
            value={formatMoney(financialSummary?.openBalanceCents ?? 0)}
          />
          <ClientMetric
            icon={<HugeiconsIcon icon={DollarCircleIcon} className="size-4" />}
            label="Saldo Vencido"
            tone={financialSummary?.overdueBalanceFlag ? 'danger' : 'default'}
            value={formatMoney(financialSummary?.overdueBalanceCents ?? 0)}
          />
        </ClientMetricStrip>

        <form id="client-info-form" onSubmit={handleSubmit}>
          <ClientPanelBody className="space-y-8">
            <ClientSection
              icon={<HugeiconsIcon icon={Building02Icon} className="size-4" />}
              title="Identificação"
              description="Dados que identificam o cliente em propostas, ordens e certificados."
            >
              <FieldGroup className="gap-5">
                <Field>
                  <FieldLabel htmlFor="name">Nome / Razão Social</FieldLabel>
                  <Input
                    id="name"
                    name="name"
                    autoComplete="organization"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value)
                      setFormError(null)
                    }}
                    disabled={updateMutation.isPending}
                    placeholder="Ex.: Empresa Modelo Ltda.…"
                    aria-invalid={formError ? true : undefined}
                  />
                  {formError && <FieldError>{formError}</FieldError>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="taxId">CNPJ / CPF</FieldLabel>
                  <MaskedInput
                    id="taxId"
                    name="tax-id"
                    autoComplete="off"
                    inputMode="numeric"
                    maskOptions={cpfCnpjMask}
                    value={taxId}
                    onInput={(e) => setTaxId(e.currentTarget.value)}
                    disabled={updateMutation.isPending}
                    placeholder="Ex.: 00.000.000/0000-00…"
                    spellCheck={false}
                  />
                  <FieldDescription>
                    Documento de identificação fiscal.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </ClientSection>

            <ClientSection
              icon={<HugeiconsIcon icon={Mail01Icon} className="size-4" />}
              title="Contato"
              description="Canal principal para atendimento e acesso ao portal do cliente."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={updateMutation.isPending}
                    placeholder="Ex.: contato@empresa.com…"
                    spellCheck={false}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="phone">Telefone</FieldLabel>
                  <MaskedInput
                    id="phone"
                    name="tel"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maskOptions={brazilPhoneMask}
                    value={phone}
                    onInput={(e) => setPhone(e.currentTarget.value)}
                    disabled={updateMutation.isPending}
                    placeholder="Ex.: (11) 99999-9999…"
                  />
                </Field>
              </div>
            </ClientSection>

            <Collapsible open={addressOpen} onOpenChange={setAddressOpen}>
              <div className="border-t border-border/70 pt-6">
                <CollapsibleTrigger
                  render={
                    <Button
                      variant="ghost"
                      type="button"
                      className="min-h-10 w-full justify-between gap-4 px-0 text-left hover:bg-transparent active:scale-[0.96] transition-[color,transform]"
                    />
                  }
                >
                  <span className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground ring-1 ring-foreground/10"
                    >
                      <HugeiconsIcon icon={Location01Icon} className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        Endereço
                      </span>
                      <span className="mt-0.5 block text-sm font-normal text-muted-foreground text-pretty">
                        CEP, logradouro e localização para coleta, entrega e
                        emissão de documentos.
                      </span>
                    </span>
                  </span>
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    aria-hidden="true"
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${addressOpen ? 'rotate-180' : ''}`}
                  />
                </CollapsibleTrigger>

                <CollapsibleContent className="space-y-5 pt-5">
                  <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)]">
                    <Field>
                      <FieldLabel htmlFor="cep">CEP</FieldLabel>
                      <MaskedInput
                        id="cep"
                        name="postal-code"
                        autoComplete="postal-code"
                        inputMode="numeric"
                        maskOptions={cepMask}
                        value={address.cep || ''}
                        onInput={(e) => {
                          const nextCep = e.currentTarget.value
                          updateAddress('cep', nextCep)
                          cepLookup.lookupCep(nextCep)
                        }}
                        disabled={updateMutation.isPending}
                        placeholder="Ex.: 00000-000…"
                        aria-describedby={
                          cepLookup.message
                            ? 'client-info-cep-lookup-description'
                            : undefined
                        }
                      />
                      {cepLookup.message && (
                        <FieldDescription
                          id="client-info-cep-lookup-description"
                          aria-live="polite"
                          className={
                            cepLookup.status === 'not-found' ||
                            cepLookup.status === 'error'
                              ? 'text-destructive'
                              : undefined
                          }
                        >
                          {cepLookup.isLoading && (
                            <Spinner className="mr-1.5 inline size-3" />
                          )}
                          {cepLookup.message}
                        </FieldDescription>
                      )}
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="number">Número</FieldLabel>
                      <Input
                        id="number"
                        name="address-line2"
                        autoComplete="address-line2"
                        value={address.number || ''}
                        onChange={(e) =>
                          updateAddress('number', e.target.value)
                        }
                        disabled={updateMutation.isPending}
                        placeholder="Ex.: 123…"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="complement">Complemento</FieldLabel>
                      <Input
                        id="complement"
                        name="address-complement"
                        autoComplete="off"
                        value={address.complement || ''}
                        onChange={(e) =>
                          updateAddress('complement', e.target.value)
                        }
                        disabled={updateMutation.isPending}
                        placeholder="Ex.: Sala 4, bloco B…"
                      />
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel htmlFor="street">Rua</FieldLabel>
                    <Input
                      id="street"
                      name="street-address"
                      autoComplete="street-address"
                      value={address.street || ''}
                      onChange={(e) => updateAddress('street', e.target.value)}
                      disabled={updateMutation.isPending}
                      placeholder="Ex.: Rua das Calibrações…"
                    />
                  </Field>

                  <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem]">
                    <Field>
                      <FieldLabel htmlFor="neighbourhood">Bairro</FieldLabel>
                      <Input
                        id="neighbourhood"
                        name="address-level3"
                        autoComplete="address-level3"
                        value={address.neighbourhood || ''}
                        onChange={(e) =>
                          updateAddress('neighbourhood', e.target.value)
                        }
                        disabled={updateMutation.isPending}
                        placeholder="Ex.: Centro…"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="city">Cidade</FieldLabel>
                      <Input
                        id="city"
                        name="address-level2"
                        autoComplete="address-level2"
                        value={address.city || ''}
                        onChange={(e) => updateAddress('city', e.target.value)}
                        disabled={updateMutation.isPending}
                        placeholder="Ex.: São Paulo…"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="state">Estado</FieldLabel>
                      <Input
                        id="state"
                        name="address-level1"
                        autoComplete="address-level1"
                        value={address.state || ''}
                        onChange={(e) =>
                          updateAddress('state', e.target.value.toUpperCase())
                        }
                        disabled={updateMutation.isPending}
                        placeholder="Ex.: SP…"
                        maxLength={2}
                      />
                    </Field>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </ClientPanelBody>
        </form>
      </ClientPanel>
    </div>
  )
}

function InfoSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-[0_1px_2px_rgba(0,0,0,0.05),0_18px_45px_rgba(15,23,42,0.08)] ring-1 ring-foreground/10 dark:shadow-none">
      <div className="border-b border-border/70 px-5 py-5 sm:px-6">
        <div className="flex items-start gap-3">
          <Skeleton className="size-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
        </div>
      </div>
      <div className="grid divide-y divide-border/70 border-b border-border/70 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="px-5 py-4 sm:px-6">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="mt-3 h-6 w-20" />
          </div>
        ))}
      </div>
      <div className="space-y-8 px-5 py-6 sm:px-6 sm:py-7">
        <SkeletonFormSection />
        <SkeletonFormSection />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    </div>
  )
}

function SkeletonFormSection() {
  return (
    <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="flex gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
    </div>
  )
}
