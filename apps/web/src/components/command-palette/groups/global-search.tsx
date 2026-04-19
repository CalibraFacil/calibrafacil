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
import {
  assetRouteId,
  clientRouteId,
  jobRouteId,
} from '@/lib/route-identifiers'

type SearchMode = 'assets' | 'clients' | 'standards' | 'jobs' | null

type AssetSearchResult = {
  id: number
  tag: string
  serialNumber: string
  assetTypeName: string
  customerName: string
  customerTaxId: string | null
}

type ClientSearchResult = {
  id: number
  name: string
  email: string | null
  taxId: string | null
}

type StandardSearchResult = {
  id: number
  name: string
  serialNumber: string
  manufacturer: string | null
}

type JobSearchResult = {
  id: number
  jobId: string
  status: string
}

const SEARCH_DEBOUNCE_MS = 150
const SEARCH_MIN_LENGTH = 2
const SEARCH_RESULT_LIMIT = '5'

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

export function GlobalSearchGroup({
  searchValue,
  onSearchModeSelect,
}: {
  searchValue: string
  onSearchModeSelect?: () => void
}) {
  const navigate = useNavigate()
  const { setOpen, setPages, activePage } = useCommandPalette()
  const trimmedSearchValue = searchValue.trim()
  const debouncedSearch = useDebouncedValue(
    trimmedSearchValue,
    SEARCH_DEBOUNCE_MS,
  )
  const hasMinimumQuery = trimmedSearchValue.length >= SEARCH_MIN_LENGTH
  const isWaitingDebounce =
    hasMinimumQuery && debouncedSearch !== trimmedSearchValue

  // Derive search mode from active page
  const searchMode = getSearchModeFromPage(activePage)

  // Asset search
  const {
    data: assetResults,
    isLoading: assetsLoading,
    isFetching: assetsFetching,
  } = useQuery<Array<AssetSearchResult>>({
    queryKey: ['command-search', 'assets', debouncedSearch],
    queryFn: async () => {
      if (debouncedSearch.length < SEARCH_MIN_LENGTH) return []
      const res = await api.api.assets.search.$get({
        query: { query: debouncedSearch, limit: SEARCH_RESULT_LIMIT },
      })
      if (!res.ok) throw new Error('Search failed')
      return await res.json()
    },
    enabled: searchMode === 'assets' && hasMinimumQuery,
    staleTime: 30000,
    placeholderData: (previousData) => previousData,
  })

  // Client search
  const {
    data: clientResults,
    isLoading: clientsLoading,
    isFetching: clientsFetching,
  } = useQuery<Array<ClientSearchResult>>({
    queryKey: ['command-search', 'clients', debouncedSearch],
    queryFn: async () => {
      if (debouncedSearch.length < SEARCH_MIN_LENGTH) return []
      const res = await api.api.customers.search.$get({
        query: { query: debouncedSearch, limit: SEARCH_RESULT_LIMIT },
      })
      if (!res.ok) throw new Error('Search failed')
      return await res.json()
    },
    enabled: searchMode === 'clients' && hasMinimumQuery,
    staleTime: 30000,
    placeholderData: (previousData) => previousData,
  })

  // Standards search
  const {
    data: standardResults,
    isLoading: standardsLoading,
    isFetching: standardsFetching,
  } = useQuery<Array<StandardSearchResult>>({
    queryKey: ['command-search', 'standards', debouncedSearch],
    queryFn: async () => {
      if (debouncedSearch.length < SEARCH_MIN_LENGTH) return []
      const res = await api.api.standards.search.$get({
        query: { query: debouncedSearch, limit: SEARCH_RESULT_LIMIT },
      })
      if (res.ok) {
        return await res.json()
      }

      // Backward-compatible fallback for environments where /standards/search
      // is not deployed yet.
      if (res.status !== 404) {
        throw new Error('Search failed')
      }

      const fallbackRes = await api.api.standards.$get({
        query: {
          query: debouncedSearch,
          limit: SEARCH_RESULT_LIMIT,
          page: '1',
        },
      })

      if (!fallbackRes.ok) {
        throw new Error('Search failed')
      }

      const fallbackData = await fallbackRes.json()
      return fallbackData.data.map((standard) => ({
        id: standard.id,
        name: standard.name,
        serialNumber: standard.serialNumber,
        manufacturer: standard.manufacturer,
      }))
    },
    enabled: searchMode === 'standards' && hasMinimumQuery,
    staleTime: 30000,
    placeholderData: (previousData) => previousData,
  })

  // Jobs search
  const {
    data: jobResults,
    isLoading: jobsLoading,
    isFetching: jobsFetching,
  } = useQuery<Array<JobSearchResult>>({
    queryKey: ['command-search', 'jobs', debouncedSearch],
    queryFn: async () => {
      if (debouncedSearch.length < SEARCH_MIN_LENGTH) return []
      const res = await api.api.jobs.search.$get({
        query: { query: debouncedSearch, limit: SEARCH_RESULT_LIMIT },
      })
      if (!res.ok) throw new Error('Search failed')
      return await res.json()
    },
    enabled: searchMode === 'jobs' && hasMinimumQuery,
    staleTime: 30000,
    placeholderData: (previousData) => previousData,
  })

  // Asset results view
  if (searchMode === 'assets') {
    const isLoading = assetsLoading
    const isFetching = assetsFetching
    const results = assetResults ?? []
    const showMinLengthHint = trimmedSearchValue.length > 0 && !hasMinimumQuery
    const showSearchingState =
      hasMinimumQuery &&
      results.length === 0 &&
      (isWaitingDebounce || isLoading || isFetching)
    const showEmptyState =
      hasMinimumQuery &&
      !isLoading &&
      !isFetching &&
      !isWaitingDebounce &&
      results.length === 0

    return (
      <CommandGroup heading="Resultados - Ativos">
        {showMinLengthHint && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Digite pelo menos 2 caracteres para buscar.
          </div>
        )}
        {showSearchingState && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Buscando...
          </div>
        )}
        {showEmptyState && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhum ativo encontrado para "{trimmedSearchValue}"
          </div>
        )}
        {hasMinimumQuery &&
          results.map((asset) => (
            <CommandItem
              key={asset.id}
              onSelect={() => {
                navigate({
                  to: '/dashboard/assets/$id',
                  params: { id: assetRouteId(asset) },
                })
                setOpen(false)
              }}
            >
              <HugeiconsIcon icon={Wrench01Icon} />
              <div className="flex flex-col">
                <span>{asset.assetTypeName || asset.tag || 'Ativo'}</span>
                <span className="text-xs text-muted-foreground">
                  {asset.serialNumber || asset.tag} •{' '}
                  {asset.customerName || 'Sem cliente'}
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
    const isFetching = clientsFetching
    const results = clientResults ?? []
    const showMinLengthHint = trimmedSearchValue.length > 0 && !hasMinimumQuery
    const showSearchingState =
      hasMinimumQuery &&
      results.length === 0 &&
      (isWaitingDebounce || isLoading || isFetching)
    const showEmptyState =
      hasMinimumQuery &&
      !isLoading &&
      !isFetching &&
      !isWaitingDebounce &&
      results.length === 0

    return (
      <CommandGroup heading="Resultados - Clientes">
        {showMinLengthHint && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Digite pelo menos 2 caracteres para buscar.
          </div>
        )}
        {showSearchingState && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Buscando...
          </div>
        )}
        {showEmptyState && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhum cliente encontrado para "{trimmedSearchValue}"
          </div>
        )}
        {hasMinimumQuery &&
          results.map((client) => (
            <CommandItem
              key={client.id}
              onSelect={() => {
                navigate({
                  to: '/dashboard/clients/$id',
                  params: { id: clientRouteId(client) },
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
    const isFetching = standardsFetching
    const results = standardResults ?? []
    const showMinLengthHint = trimmedSearchValue.length > 0 && !hasMinimumQuery
    const showSearchingState =
      hasMinimumQuery &&
      results.length === 0 &&
      (isWaitingDebounce || isLoading || isFetching)
    const showEmptyState =
      hasMinimumQuery &&
      !isLoading &&
      !isFetching &&
      !isWaitingDebounce &&
      results.length === 0

    return (
      <CommandGroup heading="Resultados - Padrões">
        {showMinLengthHint && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Digite pelo menos 2 caracteres para buscar.
          </div>
        )}
        {showSearchingState && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Buscando...
          </div>
        )}
        {showEmptyState && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhum padrão encontrado para "{trimmedSearchValue}"
          </div>
        )}
        {hasMinimumQuery &&
          results.map((standard) => (
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
                  {standard.serialNumber} •{' '}
                  {standard.manufacturer || 'Sem fabricante'}
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
    const isFetching = jobsFetching
    const results = jobResults ?? []
    const showMinLengthHint = trimmedSearchValue.length > 0 && !hasMinimumQuery
    const showSearchingState =
      hasMinimumQuery &&
      results.length === 0 &&
      (isWaitingDebounce || isLoading || isFetching)
    const showEmptyState =
      hasMinimumQuery &&
      !isLoading &&
      !isFetching &&
      !isWaitingDebounce &&
      results.length === 0

    return (
      <CommandGroup heading="Resultados - Ordens de Serviço">
        {showMinLengthHint && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Digite pelo menos 2 caracteres para buscar.
          </div>
        )}
        {showSearchingState && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Buscando...
          </div>
        )}
        {showEmptyState && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma ordem encontrada para "{trimmedSearchValue}"
          </div>
        )}
        {hasMinimumQuery &&
          results.map((job) => (
            <CommandItem
              key={job.id}
              onSelect={() => {
                navigate({
                  to: '/dashboard/jobs/$id',
                  params: { id: jobRouteId(job) },
                })
                setOpen(false)
              }}
            >
              <HugeiconsIcon icon={ClipboardIcon} />
              <div className="flex flex-col">
                <span>{job.jobId || `OS-${job.id}`}</span>
                <span className="text-xs text-muted-foreground">
                  Status: {job.status}
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
          onSearchModeSelect?.()
          setPages((prev) => [...prev, 'search-assets'])
        }}
      >
        <HugeiconsIcon icon={Wrench01Icon} />
        <span>Buscar Ativo por ID/NS...</span>
        <CommandShortcut>⌘1</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          onSearchModeSelect?.()
          setPages((prev) => [...prev, 'search-clients'])
        }}
      >
        <HugeiconsIcon icon={UserIcon} />
        <span>Buscar Cliente...</span>
        <CommandShortcut>⌘2</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          onSearchModeSelect?.()
          setPages((prev) => [...prev, 'search-standards'])
        }}
      >
        <HugeiconsIcon icon={RulerIcon} />
        <span>Buscar Padrão...</span>
        <CommandShortcut>⌘3</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          onSearchModeSelect?.()
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
