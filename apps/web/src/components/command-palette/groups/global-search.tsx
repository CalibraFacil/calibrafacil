import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ClipboardIcon,
  RulerIcon,
  UserIcon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'

import { useCommandPalette } from '../command-context'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import {
  getSearchModeFromPage,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN_LENGTH,
  useCommandSearchAssetsData,
  useCommandSearchClientsData,
  useCommandSearchJobsData,
  useCommandSearchStandardsData,
} from '@/features/command-palette/global-search'
import { CommandGroup, CommandItem } from '@/components/ui/command'
import {
  assetRouteId,
  clientRouteId,
  jobRouteId,
  standardRouteId,
} from '@/lib/route-identifiers'

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

  const {
    data: assetResults,
    isLoading: assetsLoading,
    isFetching: assetsFetching,
    isError: assetsError,
  } = useCommandSearchAssetsData({
    query: debouncedSearch,
    enabled: searchMode === 'assets' && hasMinimumQuery,
  })

  const {
    data: clientResults,
    isLoading: clientsLoading,
    isFetching: clientsFetching,
    isError: clientsError,
  } = useCommandSearchClientsData({
    query: debouncedSearch,
    enabled: searchMode === 'clients' && hasMinimumQuery,
  })

  const {
    data: standardResults,
    isLoading: standardsLoading,
    isFetching: standardsFetching,
    isError: standardsError,
  } = useCommandSearchStandardsData({
    query: debouncedSearch,
    enabled: searchMode === 'standards' && hasMinimumQuery,
  })

  const {
    data: jobResults,
    isLoading: jobsLoading,
    isFetching: jobsFetching,
    isError: jobsError,
  } = useCommandSearchJobsData({
    query: debouncedSearch,
    enabled: searchMode === 'jobs' && hasMinimumQuery,
  })

  // Asset results view
  if (searchMode === 'assets') {
    const isLoading = assetsLoading
    const isFetching = assetsFetching
    const isError = assetsError
    const results = assetResults ?? []
    const showMinLengthHint = !hasMinimumQuery
    const showSearchingState =
      hasMinimumQuery && (isWaitingDebounce || isLoading || isFetching)
    const showEmptyState =
      hasMinimumQuery &&
      !isError &&
      !isLoading &&
      !isFetching &&
      !isWaitingDebounce &&
      results.length === 0

    return (
      <CommandGroup heading="Resultados - Ativos">
        {showMinLengthHint && (
          <div
            role="status"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Digite pelo menos 2 caracteres para buscar.
          </div>
        )}
        {showSearchingState && (
          <div
            role="status"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Buscando...
          </div>
        )}
        {hasMinimumQuery && isError && !showSearchingState && (
          <div
            role="alert"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Não foi possível buscar. Tente novamente.
          </div>
        )}
        {showEmptyState && (
          <div
            role="status"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Nenhum ativo encontrado para "{trimmedSearchValue}"
          </div>
        )}
        {hasMinimumQuery &&
          !showSearchingState &&
          !isError &&
          results.map((asset) => (
            <CommandItem
              key={asset.id}
              value={String(asset.id)}
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
    const isError = clientsError
    const results = clientResults ?? []
    const showMinLengthHint = !hasMinimumQuery
    const showSearchingState =
      hasMinimumQuery && (isWaitingDebounce || isLoading || isFetching)
    const showEmptyState =
      hasMinimumQuery &&
      !isError &&
      !isLoading &&
      !isFetching &&
      !isWaitingDebounce &&
      results.length === 0

    return (
      <CommandGroup heading="Resultados - Clientes">
        {showMinLengthHint && (
          <div
            role="status"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Digite pelo menos 2 caracteres para buscar.
          </div>
        )}
        {showSearchingState && (
          <div
            role="status"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Buscando...
          </div>
        )}
        {hasMinimumQuery && isError && !showSearchingState && (
          <div
            role="alert"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Não foi possível buscar. Tente novamente.
          </div>
        )}
        {showEmptyState && (
          <div
            role="status"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Nenhum cliente encontrado para "{trimmedSearchValue}"
          </div>
        )}
        {hasMinimumQuery &&
          !showSearchingState &&
          !isError &&
          results.map((client) => (
            <CommandItem
              key={client.id}
              value={String(client.id)}
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

  // Standard results
  if (searchMode === 'standards') {
    const isLoading = standardsLoading
    const isFetching = standardsFetching
    const isError = standardsError
    const results = standardResults ?? []
    const showMinLengthHint = !hasMinimumQuery
    const showSearchingState =
      hasMinimumQuery && (isWaitingDebounce || isLoading || isFetching)
    const showEmptyState =
      hasMinimumQuery &&
      !isError &&
      !isLoading &&
      !isFetching &&
      !isWaitingDebounce &&
      results.length === 0

    return (
      <CommandGroup heading="Resultados - Padrões">
        {showMinLengthHint && (
          <div
            role="status"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Digite pelo menos 2 caracteres para buscar.
          </div>
        )}
        {showSearchingState && (
          <div
            role="status"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Buscando...
          </div>
        )}
        {hasMinimumQuery && isError && !showSearchingState && (
          <div
            role="alert"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Não foi possível buscar. Tente novamente.
          </div>
        )}
        {showEmptyState && (
          <div
            role="status"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Nenhum padrão encontrado para "{trimmedSearchValue}"
          </div>
        )}
        {hasMinimumQuery &&
          !showSearchingState &&
          !isError &&
          results.map((standard) => (
            <CommandItem
              key={standard.id}
              value={String(standard.id)}
              onSelect={() => {
                navigate({
                  to: '/dashboard/standards/$id',
                  params: { id: standardRouteId(standard) },
                })
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

  // Calibration results
  if (searchMode === 'jobs') {
    const isLoading = jobsLoading
    const isFetching = jobsFetching
    const isError = jobsError
    const results = jobResults ?? []
    const showMinLengthHint = !hasMinimumQuery
    const showSearchingState =
      hasMinimumQuery && (isWaitingDebounce || isLoading || isFetching)
    const showEmptyState =
      hasMinimumQuery &&
      !isError &&
      !isLoading &&
      !isFetching &&
      !isWaitingDebounce &&
      results.length === 0

    return (
      <CommandGroup heading="Resultados - Calibrações">
        {showMinLengthHint && (
          <div
            role="status"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Digite pelo menos 2 caracteres para buscar.
          </div>
        )}
        {showSearchingState && (
          <div
            role="status"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Buscando...
          </div>
        )}
        {hasMinimumQuery && isError && !showSearchingState && (
          <div
            role="alert"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Não foi possível buscar. Tente novamente.
          </div>
        )}
        {showEmptyState && (
          <div
            role="status"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            Nenhuma calibração encontrada para "{trimmedSearchValue}"
          </div>
        )}
        {hasMinimumQuery &&
          !showSearchingState &&
          !isError &&
          results.map((job) => (
            <CommandItem
              key={job.id}
              value={String(job.id)}
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
                <span>{job.jobId || `CAL-${job.id}`}</span>
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
      </CommandItem>

      <CommandItem
        onSelect={() => {
          onSearchModeSelect?.()
          setPages((prev) => [...prev, 'search-clients'])
        }}
      >
        <HugeiconsIcon icon={UserIcon} />
        <span>Buscar Cliente...</span>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          onSearchModeSelect?.()
          setPages((prev) => [...prev, 'search-standards'])
        }}
      >
        <HugeiconsIcon icon={RulerIcon} />
        <span>Buscar Padrão...</span>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          onSearchModeSelect?.()
          setPages((prev) => [...prev, 'search-jobs'])
        }}
      >
        <HugeiconsIcon icon={ClipboardIcon} />
        <span>Buscar Calibração...</span>
      </CommandItem>
    </CommandGroup>
  )
}
