import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  ArrowDown01Icon,
  Building02Icon,
  FloppyDiskIcon,
  Location01Icon,
  Mail01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { calibraApi } from '@/utils/api'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ACTION_BUTTON_CLASS } from '@/components/instrument-panel'
import { brazilPhoneMask, cepMask, cpfCnpjMask } from '@/lib/input-masks'
import { isValidCnpj, normalizeCnpj } from '@calibra-facil/shared/cnpj'
import {
  mergeViaCepAddress,
  type ViaCepAddress,
  useViaCepLookup,
} from '@/lib/viacep'
import {
  keepOrFill,
  useCnpjLookup,
  type CnpjLookupResult,
} from '@/lib/cnpj-lookup'
import {
  ClientPanelBody,
  ClientSection,
} from '@/features/customers/components/client-detail-ui'
import { cn } from '@/lib/utils'

const NO_GROUP_VALUE = 'none'

export type CustomerGroupOption = { id: number; name: string }

/** The customer record returned by `customers.update` (used to refresh selection). */
export type UpdatedCustomer = CustomerDetail

/**
 * Reusable customer-edit form. Owns its state, validation and update mutation,
 * but never navigates or reads route/search params. Page-only chrome (financial
 * strip, timeline, sync-conflict notice) lives in the host. Render it on a
 * dedicated page (`variant "page"`) or inside a sheet/dialog (`variant "sheet"`).
 */
export function CustomerEditForm({
  customer,
  customerId,
  groups,
  showGroupField,
  onSaved,
  onCancel,
  variant = 'page',
}: {
  customer: CustomerDetail
  customerId: string
  groups: CustomerGroupOption[]
  showGroupField: boolean
  onSaved: (customer: UpdatedCustomer) => void
  onCancel?: () => void
  variant?: 'page' | 'sheet'
}) {
  const queryClient = useQueryClient()
  const [addressOpen, setAddressOpen] = useState(false)

  const [name, setName] = useState(customer.name || '')
  const [tradeName, setTradeName] = useState(customer.tradeName || '')
  const [taxId, setTaxId] = useState(customer.taxId || '')
  const [email, setEmail] = useState(customer.email || '')
  const [phone, setPhone] = useState(customer.phone || '')
  const [address, setAddress] = useState<CustomerAddress>(
    customer.address || {},
  )
  const [groupId, setGroupId] = useState<number | null>(
    customer.group?.id ?? customer.groupId ?? null,
  )
  const [formError, setFormError] = useState<string | null>(null)

  const updateMutation = useMutation({
    mutationFn: async (data: {
      name?: string
      tradeName?: string
      taxId?: string
      email?: string
      phone?: string
      address?: CustomerAddress
      groupId?: number | null
    }) => {
      return calibraApi.customers.update<CustomerDetail>(customerId, data)
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      // The customer's group membership changed — refresh group rollups too.
      queryClient.invalidateQueries({ queryKey: ['customer-group'] })
      queryClient.invalidateQueries({ queryKey: ['customer-groups'] })
      toast.success('Cliente atualizado com sucesso!')
      onSaved(updated)
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
      tradeName: tradeName.trim() || undefined,
      taxId: taxId.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      address: hasAddressData ? address : undefined,
      // Only labs with the customer_group entitlement edit this field; when the
      // section is hidden, omit it so we never clobber an existing assignment.
      ...(showGroupField ? { groupId } : {}),
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

  const isSaving = updateMutation.isPending

  const handleCnpjResolved = useCallback((result: CnpjLookupResult) => {
    // Fill only blank fields so we never overwrite existing customer data.
    setName((prev) => keepOrFill(prev, result.name))
    setTradeName((prev) => keepOrFill(prev, result.tradeName))
    setEmail((prev) => keepOrFill(prev, result.email))
    setPhone((prev) => keepOrFill(prev, result.phone))
    setAddress((prev) => ({
      ...prev,
      cep: keepOrFill(prev.cep || '', result.address.cep),
      street: keepOrFill(prev.street || '', result.address.street),
      number: keepOrFill(prev.number || '', result.address.number),
      complement: keepOrFill(prev.complement || '', result.address.complement),
      neighbourhood: keepOrFill(
        prev.neighbourhood || '',
        result.address.neighbourhood,
      ),
      city: keepOrFill(prev.city || '', result.address.city),
      state: keepOrFill(prev.state || '', result.address.state),
    }))
  }, [])

  const cnpjLookup = useCnpjLookup({
    cnpj: taxId,
    disabled: isSaving,
    onResolved: handleCnpjResolved,
  })

  // Non-blocking: warn on a malformed 14-char CNPJ (CPFs are 11 chars and never trigger this).
  const invalidCnpjHint =
    normalizeCnpj(taxId).length === 14 && !isValidCnpj(taxId)

  return (
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
                disabled={isSaving}
                placeholder="Ex.: Empresa Modelo Ltda.…"
                aria-invalid={formError ? true : undefined}
              />
              {formError && <FieldError>{formError}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor="tradeName">Nome fantasia</FieldLabel>
              <Input
                id="tradeName"
                name="tradeName"
                autoComplete="off"
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                disabled={isSaving}
                placeholder="Ex.: ACME…"
              />
              <FieldDescription>
                Opcional. A razão social continua sendo o nome oficial em
                certificados e documentos.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="taxId">CNPJ / CPF</FieldLabel>
              <MaskedInput
                id="taxId"
                name="tax-id"
                autoComplete="off"
                maskOptions={cpfCnpjMask}
                value={taxId}
                onInput={(e) => {
                  const nextTaxId = e.currentTarget.value
                  setTaxId(nextTaxId)
                  cnpjLookup.lookupCnpj(nextTaxId)
                }}
                disabled={isSaving}
                placeholder="Ex.: 00.000.000/0000-00…"
                spellCheck={false}
                aria-describedby={
                  cnpjLookup.message
                    ? 'client-info-taxId-lookup-description'
                    : undefined
                }
              />
              {invalidCnpjHint ? (
                <FieldDescription className="text-amber-700 dark:text-amber-400">
                  CNPJ inválido — verifique os dígitos. Você ainda pode salvar.
                </FieldDescription>
              ) : cnpjLookup.message ? (
                <FieldDescription
                  id="client-info-taxId-lookup-description"
                  aria-live="polite"
                  className={
                    cnpjLookup.status === 'not-found' ||
                    cnpjLookup.status === 'error'
                      ? 'text-amber-700 dark:text-amber-400'
                      : undefined
                  }
                >
                  {cnpjLookup.isLoading && (
                    <Spinner className="mr-1.5 inline size-3" />
                  )}
                  {cnpjLookup.message}
                </FieldDescription>
              ) : (
                <FieldDescription>
                  Documento de identificação fiscal.
                </FieldDescription>
              )}
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
                disabled={isSaving}
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
                disabled={isSaving}
                placeholder="Ex.: (11) 99999-9999…"
              />
            </Field>
          </div>
        </ClientSection>

        {showGroupField ? (
          <ClientSection
            icon={<HugeiconsIcon icon={Building02Icon} className="size-4" />}
            title="Grupo / Rede"
            description="Vincule este cliente a um grupo para dar ao gestor da rede uma visão consolidada de todas as unidades no portal."
          >
            <Field>
              <FieldLabel htmlFor="customer-group">Grupo</FieldLabel>
              <Select
                value={groupId === null ? NO_GROUP_VALUE : String(groupId)}
                onValueChange={(value) =>
                  setGroupId(
                    !value || value === NO_GROUP_VALUE ? null : Number(value),
                  )
                }
              >
                <SelectTrigger id="customer-group">
                  <span
                    className={groupId === null ? 'text-muted-foreground' : ''}
                  >
                    {groups.find((group) => group.id === groupId)?.name ??
                      'Sem grupo'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GROUP_VALUE}>Sem grupo</SelectItem>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={String(group.id)}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Apenas grupos deste laboratório podem ser selecionados.
              </FieldDescription>
            </Field>
          </ClientSection>
        ) : null}

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
                  <span className="block text-sm font-medium">Endereço</span>
                  <span className="mt-0.5 block text-sm font-normal text-muted-foreground text-pretty">
                    CEP, logradouro e localização para coleta, entrega e emissão
                    de documentos.
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
                    disabled={isSaving}
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
                    onChange={(e) => updateAddress('number', e.target.value)}
                    disabled={isSaving}
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
                    disabled={isSaving}
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
                  disabled={isSaving}
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
                    disabled={isSaving}
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
                    disabled={isSaving}
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
                    disabled={isSaving}
                    placeholder="Ex.: SP…"
                    maxLength={2}
                  />
                </Field>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        <CustomerEditActions
          variant={variant}
          isSaving={isSaving}
          onCancel={onCancel}
        />
      </ClientPanelBody>
    </form>
  )
}

function CustomerEditActions({
  variant,
  isSaving,
  onCancel,
}: {
  variant: 'page' | 'sheet'
  isSaving: boolean
  onCancel?: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 border-t border-border/70 pt-6',
        variant === 'sheet' &&
          'sticky bottom-0 z-10 mt-0 bg-background/95 pt-4 backdrop-blur',
      )}
    >
      {onCancel ? (
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSaving}
          className={ACTION_BUTTON_CLASS}
        >
          Cancelar
        </Button>
      ) : null}
      <Button
        type="submit"
        disabled={isSaving}
        className={cn(ACTION_BUTTON_CLASS, 'min-w-40')}
      >
        {isSaving ? (
          <>
            <Spinner className="mr-2 size-4" />
            Salvando…
          </>
        ) : (
          <>
            <HugeiconsIcon icon={FloppyDiskIcon} className="mr-2 size-4" />
            Salvar Alterações
          </>
        )}
      </Button>
    </div>
  )
}
