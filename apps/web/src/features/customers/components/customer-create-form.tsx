import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { FloppyDiskIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { CreateCustomerInput } from '@calibra-facil/schemas'

import { calibraApi } from '@/utils/api'
import {
  parseCustomerForm,
  type CustomerFormData,
  type CustomerFormField,
} from '@/features/customers/forms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { Spinner } from '@/components/ui/spinner'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
} from '@/components/instrument-panel'
import { brazilPhoneMask, cepMask, cpfCnpjMask } from '@/lib/input-masks'
import {
  mergeViaCepAddress,
  type ViaCepAddress,
  useViaCepLookup,
} from '@/lib/viacep'
import { cn } from '@/lib/utils'

/** The customer record returned by `customers.create` (used to auto-select it). */
export type CreatedCustomer = Awaited<
  ReturnType<typeof calibraApi.customers.create>
>

/**
 * The create response carries a portal `invitationId` at runtime (when an email
 * was provided) even though the typed DTO omits it — read it defensively.
 */
export function getCustomerInvitationId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('invitationId' in data)) {
    return null
  }

  return typeof data.invitationId === 'string' ? data.invitationId : null
}

const initialFormData: CustomerFormData = {
  name: '',
  taxId: '',
  email: '',
  phone: '',
  address: {
    cep: '',
    street: '',
    number: '',
    complement: '',
    neighbourhood: '',
    city: '',
    state: '',
  },
}

const PANEL_CLASS = 'p-4 sm:p-5'

/**
 * Reusable customer-creation form. Owns its own state, validation and create
 * mutation, but never navigates or reads route/search params — the host decides
 * what "saved" means via `onSaved`. Render it on a dedicated page (`variant
 * "page"`) or inside a sheet/dialog (`variant "sheet"`).
 */
export function CustomerCreateForm({
  onSaved,
  onCancel,
  variant = 'page',
}: {
  onSaved: (customer: CreatedCustomer) => void
  onCancel: () => void
  variant?: 'page' | 'sheet'
}) {
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<CustomerFormData>(initialFormData)
  const [errors, setErrors] = useState<
    Partial<Record<CustomerFormField, string>>
  >({})

  const createMutation = useMutation({
    mutationFn: (data: CreateCustomerInput) =>
      calibraApi.customers.create(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      onSaved(data)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
  const isSaving = createMutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const parsed = parseCustomerForm(formData)
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.fieldErrors.map((error) => [error.field, error.message]),
        ),
      )
      toast.error(parsed.message)
      return
    }

    setErrors({})
    createMutation.mutate(parsed.data)
  }

  const updateField = <TKey extends keyof CustomerFormData>(
    field: TKey,
    value: CustomerFormData[TKey],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const updateAddressField = (
    field: keyof CustomerFormData['address'],
    value: string,
  ) => {
    setFormData((prev) => ({
      ...prev,
      address: { ...prev.address, [field]: value },
    }))
  }

  const handleViaCepResolved = useCallback((address: ViaCepAddress) => {
    setFormData((prev) => ({
      ...prev,
      address: mergeViaCepAddress(prev.address, address),
    }))
  }, [])

  const cepLookup = useViaCepLookup({
    cep: formData.address.cep,
    disabled: isSaving,
    onResolved: handleViaCepResolved,
  })

  return (
    <form
      onSubmit={handleSubmit}
      className={variant === 'sheet' ? 'flex min-h-0 flex-col' : 'space-y-6'}
    >
      <Panel className={PANEL_CLASS}>
        <div className="divide-y divide-foreground/10">
          <section className="pb-6">
            <PanelHeader
              eyebrow="Identificação"
              title="Dados do cliente"
              description="Nome público e documento usados em ordens, ativos e certificados."
            />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="name">Nome / Razão social *</FieldLabel>
                <Input
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Ex.: Empresa ACME…"
                  disabled={isSaving}
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
                <MaskedInput
                  id="taxId"
                  name="taxId"
                  maskOptions={cpfCnpjMask}
                  value={formData.taxId}
                  onInput={(e) => updateField('taxId', e.currentTarget.value)}
                  placeholder="Ex.: 00.000.000/0000-00…"
                  disabled={isSaving}
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            </div>
          </section>
          <section className="py-6">
            <PanelHeader
              eyebrow="Contato"
              title="Contato e portal"
              description="Canal principal de atendimento e convite de acesso do cliente."
            />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="Ex.: contato@empresa.com…"
                  disabled={isSaving}
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
                <MaskedInput
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  maskOptions={brazilPhoneMask}
                  value={formData.phone}
                  onInput={(e) => updateField('phone', e.currentTarget.value)}
                  placeholder="Ex.: (11) 99999-9999…"
                  disabled={isSaving}
                  autoComplete="tel"
                />
              </Field>
            </div>
          </section>
          <section className="pt-6">
            <PanelHeader
              eyebrow="Localização"
              title="Endereço"
              description="Opcional, mas útil para documentos comerciais e entregas."
            />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="cep">CEP</FieldLabel>
                <MaskedInput
                  id="cep"
                  name="postalCode"
                  maskOptions={cepMask}
                  value={formData.address.cep}
                  onInput={(e) => {
                    const nextCep = e.currentTarget.value
                    updateAddressField('cep', nextCep)
                    cepLookup.lookupCep(nextCep)
                  }}
                  placeholder="Ex.: 00000-000…"
                  disabled={isSaving}
                  autoComplete="postal-code"
                  spellCheck={false}
                  aria-describedby={
                    cepLookup.message ? 'cep-lookup-description' : undefined
                  }
                />
                {cepLookup.message && (
                  <FieldDescription
                    id="cep-lookup-description"
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
                  name="addressNumber"
                  value={formData.address.number}
                  onChange={(e) => updateAddressField('number', e.target.value)}
                  placeholder="Ex.: 123…"
                  disabled={isSaving}
                  autoComplete="address-line2"
                />
              </Field>

              <Field className="md:col-span-2">
                <FieldLabel htmlFor="street">Rua</FieldLabel>
                <Input
                  id="street"
                  name="street"
                  value={formData.address.street}
                  onChange={(e) => updateAddressField('street', e.target.value)}
                  placeholder="Ex.: Rua das Flores…"
                  disabled={isSaving}
                  autoComplete="address-line1"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="complement">Complemento</FieldLabel>
                <Input
                  id="complement"
                  name="addressComplement"
                  value={formData.address.complement}
                  onChange={(e) =>
                    updateAddressField('complement', e.target.value)
                  }
                  placeholder="Ex.: Sala 4, bloco B…"
                  disabled={isSaving}
                  autoComplete="address-line2"
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
                  disabled={isSaving}
                  autoComplete="address-level3"
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
                  disabled={isSaving}
                  autoComplete="address-level2"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="state">Estado</FieldLabel>
                <Input
                  id="state"
                  name="state"
                  value={formData.address.state}
                  onChange={(e) =>
                    updateAddressField('state', e.target.value.toUpperCase())
                  }
                  placeholder="Ex.: SP…"
                  disabled={isSaving}
                  autoComplete="address-level1"
                  spellCheck={false}
                  maxLength={2}
                />
              </Field>
            </div>
          </section>
        </div>
      </Panel>

      <CustomerCreateActions
        variant={variant}
        isSaving={isSaving}
        onCancel={onCancel}
      />
    </form>
  )
}

function CustomerCreateActions({
  variant,
  isSaving,
  onCancel,
}: {
  variant: 'page' | 'sheet'
  isSaving: boolean
  onCancel: () => void
}) {
  const buttons = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
        disabled={isSaving}
        className={ACTION_BUTTON_CLASS}
      >
        Cancelar
      </Button>
      <Button
        type="submit"
        disabled={isSaving}
        className={cn(ACTION_BUTTON_CLASS, 'min-w-36')}
      >
        {isSaving ? (
          <>
            <Spinner className="mr-2 size-4" />
            Salvando…
          </>
        ) : (
          <>
            <HugeiconsIcon icon={FloppyDiskIcon} className="mr-2 size-4" />
            Criar cliente
          </>
        )}
      </Button>
    </>
  )

  if (variant === 'sheet') {
    return (
      <div className="sticky bottom-0 z-10 mt-6 flex items-center justify-end gap-2 border-t border-foreground/10 bg-background/95 pt-4 backdrop-blur">
        {buttons}
      </div>
    )
  }

  return (
    <div className="sticky bottom-0 z-10 -mx-1 pt-2 pb-1">
      <div className="flex flex-col gap-3 rounded-2xl bg-card/95 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_16px_40px_rgba(15,23,42,0.08)] ring-1 ring-foreground/10 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="px-1 text-pretty text-xs text-muted-foreground">
          Com email informado, o convite do portal é enviado automaticamente.
        </p>
        <div className="flex items-center justify-end gap-2">{buttons}</div>
      </div>
    </div>
  )
}
