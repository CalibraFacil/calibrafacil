/**
 * Reusable editor for a contract's negotiated price table. Controlled: the
 * parent owns the `value` array, the editor emits the next array on every
 * change. Rows carry a stable `id` so React keys are not array indices, and
 * selecting a service auto-fills its catalog price. Price is held as integer
 * cents via CurrencyInput — no raw-cents or free-text parsing at the call site.
 */
import { Delete02Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@/components/ui/button'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FINANCE_CURRENCY } from '@/lib/finance-formatters'
import type { FinanceContractServiceOption } from '@/features/finance/types'

export type ServiceTermDraft = {
  id: string
  serviceId: string
  priceCents: number
}

export function createEmptyServiceTerm(): ServiceTermDraft {
  return { id: crypto.randomUUID(), serviceId: '', priceCents: 0 }
}

export function ServiceTermsEditor({
  value,
  onChange,
  services,
}: {
  value: ServiceTermDraft[]
  onChange: (next: ServiceTermDraft[]) => void
  services: FinanceContractServiceOption[]
}) {
  function updateAt(index: number, patch: Partial<ServiceTermDraft>) {
    onChange(
      value.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry,
      ),
    )
  }

  function selectService(index: number, serviceId: string) {
    const service = services.find((entry) => String(entry.id) === serviceId)
    updateAt(index, {
      serviceId,
      priceCents:
        service?.price != null ? service.price : value[index].priceCents,
    })
  }

  return (
    <div className="space-y-3">
      {value.map((term, index) => (
        <div
          key={term.id}
          className="grid gap-4 rounded-xl border bg-background p-4 md:grid-cols-[minmax(0,2fr)_220px_48px] md:items-end"
        >
          <Field>
            <FieldLabel>Serviço</FieldLabel>
            <Select
              value={term.serviceId || undefined}
              onValueChange={(serviceId) =>
                selectService(index, serviceId ?? '')
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione um serviço" />
              </SelectTrigger>
              <SelectContent align="start">
                {services.map((service) => (
                  <SelectItem key={service.id} value={String(service.id)}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>Preço negociado</FieldLabel>
            <CurrencyInput
              valueCents={term.priceCents}
              onValueChange={(priceCents) => updateAt(index, { priceCents })}
              currency={FINANCE_CURRENCY}
            />
          </Field>

          <div className="flex items-end md:justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remover serviço"
              disabled={value.length === 1}
              onClick={() =>
                onChange(
                  value.length === 1
                    ? value
                    : value.filter((_, entryIndex) => entryIndex !== index),
                )
              }
            >
              <HugeiconsIcon icon={Delete02Icon} className="size-4" />
            </Button>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        onClick={() => onChange([...value, createEmptyServiceTerm()])}
      >
        <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
        Adicionar serviço
      </Button>
    </div>
  )
}
