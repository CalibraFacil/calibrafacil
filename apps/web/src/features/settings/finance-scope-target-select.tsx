/**
 * Scope-aware, searchable target picker for finance automation exceptions.
 * Instead of typing a numeric record ID, the operator searches a named list —
 * customers, commercial agreements, or services. The emitted value matches what
 * the policy/rule APIs expect: the entity id (as a string) for customer /
 * agreement scopes, and the service name for service scope.
 */
import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Tick02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  useFinanceContractCustomerOptionsData,
  useFinanceContractServiceOptionsData,
  useFinanceContractsData,
} from '@/features/finance/queries'

export type AutomationScope = 'customer' | 'agreement' | 'service'

type Option = { value: string; label: string }

export function ScopeTargetSelect({
  scope,
  value,
  onChange,
}: {
  scope: AutomationScope
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const customers = useFinanceContractCustomerOptionsData()
  const services = useFinanceContractServiceOptionsData()
  const contracts = useFinanceContractsData({ search: '' })

  let options: Option[] = []
  let loading = false
  let placeholder = 'Selecionar'

  if (scope === 'customer') {
    loading = customers.isPending
    placeholder = 'Selecionar cliente'
    options = (customers.data?.data ?? []).map((customer) => ({
      value: String(customer.id),
      label: customer.name,
    }))
  } else if (scope === 'agreement') {
    loading = contracts.isPending
    placeholder = 'Selecionar contrato'
    options = (contracts.data?.data ?? []).map((contract) => ({
      value: String(contract.id),
      label: contract.title || `Contrato #${contract.id}`,
    }))
  } else {
    loading = services.isPending
    placeholder = 'Selecionar serviço'
    options = (services.data?.data ?? []).map((service) => ({
      value: service.name,
      label: service.name,
    }))
  }

  const selectedLabel = options.find((option) => option.value === value)?.label

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className="w-full justify-between font-normal"
          />
        }
      >
        <span className="truncate">
          {selectedLabel ?? (loading ? 'Carregando…' : placeholder)}
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          className="ml-2 size-4 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar…" />
          <CommandList>
            <CommandEmpty>
              {loading ? 'Carregando…' : 'Nenhum registro encontrado.'}
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    className={cn(
                      'mr-2 size-4',
                      value === option.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
