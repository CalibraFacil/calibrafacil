import { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  organization,
  useActiveOrganization,
  useListOrganizations,
} from '@calibra-facil/auth/client'
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { setStoredDashboardOrganizationId } from '@/features/dashboard/dashboard-scope-storage'
import { useCommandPalette } from '../command-context'

export function OrganizationGroup() {
  const {
    data: organizations,
    isPending,
    error: loadError,
  } = useListOrganizations()
  const { data: activeOrganization } = useActiveOrganization()
  const { setOpen } = useCommandPalette()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const switching = useRef(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function switchOrganization(organizationId: string) {
    if (switching.current || organizationId === activeOrganization?.id) return
    switching.current = true
    setPendingId(organizationId)
    setError('')
    try {
      const result = await organization.setActive({ organizationId })
      if (result.error) throw new Error(result.error.message)
      setStoredDashboardOrganizationId(organizationId)
      // Discard cached data from the previous organization before loading the new scope.
      await queryClient.cancelQueries()
      queryClient.clear()
      await navigate({ to: '/dashboard' })
      setOpen(false)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível trocar de organização.',
      )
    } finally {
      switching.current = false
      setPendingId(null)
    }
  }

  if (isPending)
    return (
      <div role="status" className="p-6 text-center text-sm">
        Carregando organizações...
      </div>
    )
  if (loadError)
    return (
      <div role="alert" className="p-6 text-center text-sm">
        Não foi possível carregar as organizações. Feche e tente novamente.
      </div>
    )

  return (
    <>
      <div
        role="alert"
        className={error ? 'px-3 py-2 text-sm text-destructive' : 'sr-only'}
      >
        {error}
      </div>
      {pendingId && (
        <div role="status" className="px-3 py-2 text-sm text-muted-foreground">
          Trocando organização...
        </div>
      )}
      <CommandEmpty>Nenhuma organização encontrada.</CommandEmpty>
      <CommandGroup heading="Organizações">
        {organizations
          ?.filter((item) => item.type !== 'CLIENT')
          .map((item) => (
            <CommandItem
              key={item.id}
              value={item.id}
              keywords={[item.name, item.slug]}
              disabled={
                pendingId !== null || item.id === activeOrganization?.id
              }
              onSelect={() => void switchOrganization(item.id)}
            >
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {item.id === activeOrganization?.id && (
                <span className="text-xs text-muted-foreground">Atual</span>
              )}
            </CommandItem>
          ))}
      </CommandGroup>
    </>
  )
}
