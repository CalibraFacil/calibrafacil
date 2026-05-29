import { useQuery } from '@tanstack/react-query'

import { contaAzulCatalogQueryOptions } from '@/features/settings/queries'
import type { ContaAzulCatalogItem } from '@/features/settings/types'

/**
 * Bundles every Conta Azul reference-catalog query behind a single hook so the
 * card components stay declarative. Each entry is a TanStack query result.
 */
export function useContaAzulCatalogs({
  enabled,
  integrationId,
}: {
  enabled: boolean
  integrationId: string
}) {
  const id = integrationId

  return {
    accounts: useQuery(
      contaAzulCatalogQueryOptions({ id, catalog: 'accounts', enabled }),
    ),
    balances: useQuery(
      contaAzulCatalogQueryOptions({ id, catalog: 'balances', enabled }),
    ),
    categories: useQuery(
      contaAzulCatalogQueryOptions({ id, catalog: 'categories', enabled }),
    ),
    costCenters: useQuery(
      contaAzulCatalogQueryOptions({ id, catalog: 'cost-centers', enabled }),
    ),
    dreCategories: useQuery(
      contaAzulCatalogQueryOptions({ id, catalog: 'dre-categories', enabled }),
    ),
    productCategories: useQuery(
      contaAzulCatalogQueryOptions({
        id,
        catalog: 'product-categories',
        enabled,
      }),
    ),
    productCest: useQuery(
      contaAzulCatalogQueryOptions({ id, catalog: 'product-cest', enabled }),
    ),
    productEcommerceBrands: useQuery(
      contaAzulCatalogQueryOptions({
        id,
        catalog: 'product-ecommerce-brands',
        enabled,
      }),
    ),
    productEcommerceCategories: useQuery(
      contaAzulCatalogQueryOptions({
        id,
        catalog: 'product-ecommerce-categories',
        enabled,
      }),
    ),
    productNcm: useQuery(
      contaAzulCatalogQueryOptions({ id, catalog: 'product-ncm', enabled }),
    ),
    productUnits: useQuery(
      contaAzulCatalogQueryOptions({ id, catalog: 'product-units', enabled }),
    ),
    products: useQuery(
      contaAzulCatalogQueryOptions({ id, catalog: 'products', enabled }),
    ),
    sellers: useQuery(
      contaAzulCatalogQueryOptions({ id, catalog: 'sellers', enabled }),
    ),
    services: useQuery(
      contaAzulCatalogQueryOptions({ id, catalog: 'services', enabled }),
    ),
    transfers: useQuery(
      contaAzulCatalogQueryOptions({ id, catalog: 'transfers', enabled }),
    ),
  }
}

export type ContaAzulCatalogs = ReturnType<typeof useContaAzulCatalogs>

export type ContaAzulCatalogQuery = {
  data?: { items: ContaAzulCatalogItem[] }
  isError: boolean
  isLoading: boolean
}

export function formatCatalogItemLabel(item: ContaAzulCatalogItem) {
  const code = item.code ? `${item.code} · ` : ''
  const suffix =
    item.active === false ? ' · inativo' : item.type ? ` · ${item.type}` : ''

  return `${code}${item.name}${suffix}`
}

export function resolveCatalogValueLabel(
  value: string | null,
  items: ContaAzulCatalogItem[] | undefined,
) {
  if (!value) {
    return 'Não configurado'
  }

  const match = items?.find((item) => item.id === value)
  return match ? formatCatalogItemLabel(match) : value
}

export function formatCatalogQueryCount(query: ContaAzulCatalogQuery) {
  if (query.isError) return 'Falha'
  if (query.isLoading) return '—'
  return String(query.data?.items.length ?? 0)
}

/** "linked/total" style counter pair for two catalog queries. */
export function formatCatalogQueryPair(
  a: ContaAzulCatalogQuery,
  b: ContaAzulCatalogQuery,
) {
  if (a.isError || b.isError) return 'Falha'
  if (a.isLoading || b.isLoading) return '—'
  return `${a.data?.items.length ?? 0}/${b.data?.items.length ?? 0}`
}

export function getFiscalTaxonomyValue(
  metadata: Record<string, unknown> | null,
  key: string,
) {
  const value = metadata?.[key]
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

export function updateFiscalTaxonomyValue(
  metadata: Record<string, unknown> | null,
  key: string,
  value: string | null,
) {
  const next = { ...metadata }
  const normalizedValue = value?.trim()

  if (normalizedValue) {
    next[key] = normalizedValue
  } else {
    delete next[key]
  }

  return Object.keys(next).length > 0 ? next : null
}
