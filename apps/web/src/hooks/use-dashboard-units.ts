import { useQuery } from '@tanstack/react-query'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import { api } from '@/utils/api'
import { usePlanAccess } from '@/hooks/use-plan-access'

type ActiveOrganization = NonNullable<
  ReturnType<typeof useActiveOrganization>['data']
>

export type DashboardUnitSummary = {
  id: number
  name: string
  slug: string
  role: string
}

export type DashboardUnitsResponse = {
  activeUnitId: number | null
  activeUnitName: string | null
  selectedUnitScope: 'all' | 'unit'
  canAccessAllUnits: boolean
  data: DashboardUnitSummary[]
}

export type DashboardScopedUnit = {
  id: number | string
  name: string
  slug: string
  role: string
}

function getCurrentOrganizationRole(activeOrg: ActiveOrganization | undefined) {
  return typeof activeOrg?.members?.[0]?.role === 'string'
    ? activeOrg.members[0].role
    : 'member'
}

export function useDashboardUnits() {
  const { data: activeOrg } = useActiveOrganization()
  const accessQuery = usePlanAccess()
  const hasMultiUnit =
    accessQuery.data?.entitlements.includes('multi_unit') ?? false

  const unitsQuery = useQuery({
    queryKey: ['dashboard-units', activeOrg?.id ?? 'no-org', hasMultiUnit],
    enabled: Boolean(activeOrg?.id && hasMultiUnit),
    queryFn: async () => {
      const response = await api.api.units.$get()
      if (response.status === 403) {
        return null
      }
      if (!response.ok) {
        throw new Error('Falha ao carregar unidades')
      }

      return (await response.json()) as DashboardUnitsResponse
    },
  })

  const data = hasMultiUnit ? unitsQuery.data : null
  const isCheckingAccess = Boolean(activeOrg?.id) && accessQuery.isPending
  const canUseSingleUnitFallback =
    Boolean(activeOrg) && !accessQuery.isPending && !hasMultiUnit
  const currentUnitValue = data
    ? data.selectedUnitScope === 'all'
      ? 'all'
      : data.activeUnitId
        ? String(data.activeUnitId)
        : ''
    : ''
  const currentUnitLabel = data
    ? data.selectedUnitScope === 'all'
      ? 'Todas as unidades'
      : data.activeUnitName ?? activeOrg?.slug ?? 'Nenhuma unidade'
    : activeOrg?.slug ?? 'Nenhum selecionado'
  const selectedUnit = data
    ? data.selectedUnitScope === 'unit'
      ? data.data.find((unit) => unit.id === data.activeUnitId) ?? null
      : null
    : canUseSingleUnitFallback && activeOrg
      ? {
          id: activeOrg.id,
          name: activeOrg.name,
          slug: activeOrg.slug,
          role: getCurrentOrganizationRole(activeOrg),
        }
      : null
  const isConsolidated = data?.selectedUnitScope === 'all'

  return {
    activeOrg,
    accessQuery,
    unitsQuery,
    hasMultiUnit,
    isCheckingAccess,
    data,
    currentUnitValue,
    currentUnitLabel,
    selectedUnit,
    isConsolidated,
  }
}
