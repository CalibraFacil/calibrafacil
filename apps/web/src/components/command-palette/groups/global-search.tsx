import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ClipboardIcon,
  RulerIcon,
  UserIcon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'

import { useCommandPalette } from '../command-context'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { api } from '@/utils/api'
import {
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command'

type SearchMode = 'assets' | 'clients' | 'standards' | 'jobs' | null

// Derive search mode from active page
function getSearchModeFromPage(activePage: string): SearchMode {
  switch (activePage) {
    case 'search-assets':
      return 'assets'
    case 'search-clients':
      return 'clients'
    case 'search-standards':
      return 'standards'
    case 'search-jobs':
      return 'jobs'
    default:
      return null
  }
}

export function GlobalSearchGroup({ searchValue }: { searchValue: string }) {
  const navigate = useNavigate()
  const { setOpen, setPages, activePage } = useCommandPalette()
  const debouncedSearch = useDebouncedValue(searchValue, 300)

  // Derive search mode from active page
  const searchMode = getSearchModeFromPage(activePage)

  // Asset search
  const { data: assetResults, isLoading: assetsLoading } = useQuery({
    queryKey: ['command-search', 'assets', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch.trim()) return []
      const res = await api.api.assets.$get({
        query: { query: debouncedSearch, limit: '5', page: '1' },
      })
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json()
      return data.data
    },
    enabled: searchMode === 'assets' && debouncedSearch.trim().length > 0,
    staleTime: 30000,
  })

  // Client search
  const { data: clientResults, isLoading: clientsLoading } = useQuery({
    queryKey: ['command-search', 'clients', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch.trim()) return []
      const res = await api.api.customers.$get({
        query: { query: debouncedSearch, limit: '5', page: '1' },
      })
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json()
      return data.data
    },
    enabled: searchMode === 'clients' && debouncedSearch.trim().length > 0,
    staleTime: 30000,
  })

  // Standards search
  const { data: standardResults, isLoading: standardsLoading } = useQuery({
    queryKey: ['command-search', 'standards', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch.trim()) return []
      const res = await api.api.standards.$get({
        query: { query: debouncedSearch, limit: '5', page: '1' },
      })
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json()
      return data.data
    },
    enabled: searchMode === 'standards' && debouncedSearch.trim().length > 0,
    staleTime: 30000,
  })

  // Jobs search
  const { data: jobResults, isLoading: jobsLoading } = useQuery({
    queryKey: ['command-search', 'jobs', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch.trim()) return []
      const res = await api.api.jobs.$get({
        query: { query: debouncedSearch, limit: '5', page: '1' },
      })
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json()
      return data.data
    },
    enabled: searchMode === 'jobs' && debouncedSearch.trim().length > 0,
    staleTime: 30000,
  })

  // Asset results view
  if (searchMode === 'assets') {
    const isLoading = assetsLoading
    const results = assetResults ?? []
    return (
      <CommandGroup heading="Resultados - Ativos">
        {isLoading && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Buscando...
          </div>
        )}
        {!isLoading && results.length === 0 && debouncedSearch.trim() && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhum ativo encontrado para "{debouncedSearch}"
          </div>
        )}
        {results.map((asset) => (
          <CommandItem
            key={asset.id}
            onSelect={() => {
              navigate({
                to: '/dashboard/assets/$id',
                params: { id: String(asset.id) },
              })
              setOpen(false)
            }}
          >
            <HugeiconsIcon icon={Wrench01Icon} />
            <div className="flex flex-col">
              <span>{asset.assetTypeName || asset.tag || 'Ativo'}</span>
              <span className="text-xs text-muted-foreground">
                {asset.serialNumber || asset.tag} • {asset.customerName || 'Sem cliente'}
              </span>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    )
  }

  // Client results view
  if (searchMode === 'clients') {
    const isLoading = clientsLoading
    const results = clientResults ?? []
    return (
      <CommandGroup heading="Resultados - Clientes">
        {isLoading && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Buscando...
          </div>
        )}
        {!isLoading && results.length === 0 && debouncedSearch.trim() && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhum cliente encontrado para "{debouncedSearch}"
          </div>
        )}
        {results.map((client) => (
          <CommandItem
            key={client.id}
            onSelect={() => {
              navigate({
                to: '/dashboard/clients/$id',
                params: { id: String(client.id) },
              })
              setOpen(false)
            }}
          >
            <HugeiconsIcon icon={UserIcon} />
            <div className="flex flex-col">
              <span>{client.name}</span>
              <span className="text-xs text-muted-foreground">
                {client.email || client.taxId || 'Sem email'}
              </span>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    )
  }

  // Standards results view - navigate to list with search since detail page doesn't exist
  if (searchMode === 'standards') {
    const isLoading = standardsLoading
    const results = standardResults ?? []
    return (
      <CommandGroup heading="Resultados - Padrões">
        {isLoading && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Buscando...
          </div>
        )}
        {!isLoading && results.length === 0 && debouncedSearch.trim() && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhum padrão encontrado para "{debouncedSearch}"
          </div>
        )}
        {results.map((standard) => (
          <CommandItem
            key={standard.id}
            onSelect={() => {
              // Navigate to standards list - detail page coming soon
              navigate({ to: '/dashboard/standards' })
              setOpen(false)
            }}
          >
            <HugeiconsIcon icon={RulerIcon} />
            <div className="flex flex-col">
              <span>{standard.name}</span>
              <span className="text-xs text-muted-foreground">
                {standard.serialNumber} • {standard.manufacturer || 'Sem fabricante'}
              </span>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    )
  }

  // Jobs results view - navigate to list since detail page doesn't exist
  if (searchMode === 'jobs') {
    const isLoading = jobsLoading
    const results = jobResults ?? []
    return (
      <CommandGroup heading="Resultados - Ordens de Serviço">
        {isLoading && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Buscando...
          </div>
        )}
        {!isLoading && results.length === 0 && debouncedSearch.trim() && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma ordem encontrada para "{debouncedSearch}"
          </div>
        )}
        {results.map((job) => (
          <CommandItem
            key={job.id}
            onSelect={() => {
              // Navigate to jobs list - detail page coming soon
              navigate({ to: '/dashboard/jobs' })
              setOpen(false)
            }}
          >
            <HugeiconsIcon icon={ClipboardIcon} />
            <div className="flex flex-col">
              <span>{job.jobId || `OS-${job.id}`}</span>
              <span className="text-xs text-muted-foreground">
                {job.methodName || 'Sem método'} • {job.status}
              </span>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    )
  }

  // Default: show search options
  return (
    <CommandGroup heading="Busca Global">
      <CommandItem
        onSelect={() => {
          setPages((prev) => [...prev, 'search-assets'])
        }}
      >
        <HugeiconsIcon icon={Wrench01Icon} />
        <span>Buscar Ativo por ID/NS...</span>
        <CommandShortcut>⌘1</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          setPages((prev) => [...prev, 'search-clients'])
        }}
      >
        <HugeiconsIcon icon={UserIcon} />
        <span>Buscar Cliente...</span>
        <CommandShortcut>⌘2</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          setPages((prev) => [...prev, 'search-standards'])
        }}
      >
        <HugeiconsIcon icon={RulerIcon} />
        <span>Buscar Padrão...</span>
        <CommandShortcut>⌘3</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          setPages((prev) => [...prev, 'search-jobs'])
        }}
      >
        <HugeiconsIcon icon={ClipboardIcon} />
        <span>Buscar Ordem de Serviço...</span>
        <CommandShortcut>⌘4</CommandShortcut>
      </CommandItem>
    </CommandGroup>
  )
}
