import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertDiamondIcon,
  Building02Icon,
  CustomerSupportIcon,
  DashboardSquare01Icon,
  InboxIcon,
  Invoice02Icon,
  PlusSignIcon,
  TimeHalfPassIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { HealthDot, status } from '@/features/backoffice/console'
import { useCustomerSuccessOrganizations } from '@/features/backoffice/customer-success/hooks'
import { useBackofficeCommandPalette } from './context'

type IconType = Parameters<typeof HugeiconsIcon>[0]['icon']

const NAV_ITEMS: ReadonlyArray<{ title: string; url: string; icon: IconType }> =
  [
    { title: 'Comando', url: '/backoffice', icon: DashboardSquare01Icon },
    { title: 'Contas', url: '/backoffice/accounts', icon: Building02Icon },
    { title: 'Suporte', url: '/backoffice/support', icon: CustomerSupportIcon },
    {
      title: 'Receita',
      url: '/backoffice/commercial-checkouts',
      icon: Invoice02Icon,
    },
    { title: 'Equipe', url: '/backoffice/users', icon: UserGroupIcon },
  ]

export function BackofficeCommandPalette() {
  const { open, setOpen } = useBackofficeCommandPalette()
  const navigate = useNavigate()
  const [value, setValue] = React.useState('')
  const accountsQuery = useCustomerSuccessOrganizations(open)
  const accounts = accountsQuery.data?.data ?? []

  const close = () => {
    setOpen(false)
    setValue('')
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setValue('')
      }}
      title="Paleta de comandos"
      description="Navegue, execute ações e busque contas pelo teclado."
    >
      <Command>
        <CommandInput
          value={value}
          onValueChange={setValue}
          placeholder="Buscar contas, ações ou destinos…"
        />
        <CommandList>
          <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>

          <CommandGroup heading="Ir para">
            {NAV_ITEMS.map((item) => (
              <CommandItem
                key={item.url}
                value={`ir ${item.title}`}
                onSelect={() => {
                  navigate({ to: item.url })
                  close()
                }}
              >
                <HugeiconsIcon icon={item.icon} />
                <span>{item.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Ações rápidas">
            <CommandItem
              value="provisionar laboratório lab novo"
              onSelect={() => {
                navigate({
                  to: '/backoffice/accounts',
                  search: { filter: 'all', new: 'lab' },
                })
                close()
              }}
            >
              <HugeiconsIcon icon={PlusSignIcon} />
              <span>Provisionar laboratório</span>
            </CommandItem>
            <CommandItem
              value="contas críticas risco"
              onSelect={() => {
                navigate({
                  to: '/backoffice/accounts',
                  search: { filter: 'critical' },
                })
                close()
              }}
            >
              <HugeiconsIcon icon={AlertDiamondIcon} />
              <span>Ver contas críticas</span>
            </CommandItem>
            <CommandItem
              value="sla estourado breached suporte"
              onSelect={() => {
                navigate({
                  to: '/backoffice/support',
                  search: { filter: 'breached', view: 'list' },
                })
                close()
              }}
            >
              <HugeiconsIcon icon={TimeHalfPassIcon} />
              <span>Tickets fora do SLA</span>
            </CommandItem>
            <CommandItem
              value="sem responsável não atribuído suporte fila"
              onSelect={() => {
                navigate({
                  to: '/backoffice/support',
                  search: { filter: 'unassigned', view: 'list' },
                })
                close()
              }}
            >
              <HugeiconsIcon icon={InboxIcon} />
              <span>Tickets sem responsável</span>
            </CommandItem>
          </CommandGroup>

          {accounts.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Contas">
                {accounts.slice(0, 50).map((account) => {
                  const health = status.healthStatus(
                    account.operationalSummary.healthStatus,
                  )
                  return (
                    <CommandItem
                      key={account.id}
                      value={`conta ${account.name} ${account.slug}`}
                      onSelect={() => {
                        navigate({
                          to: '/backoffice/accounts/$id',
                          params: { id: account.id },
                        })
                        close()
                      }}
                    >
                      <HealthDot tone={health.tone} />
                      <span>{account.name}</span>
                      <span className="ml-auto font-mono text-xs text-muted-foreground">
                        {account.slug}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
        <CommandFooter>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> Selecionar
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd> Fechar
          </span>
        </CommandFooter>
      </Command>
    </CommandDialog>
  )
}
