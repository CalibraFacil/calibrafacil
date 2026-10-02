import { useQuery } from '@tanstack/react-query'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import type {
  DashboardUnitSummary,
  DashboardUnitsResponse,
} from '@calibra-facil/client-runtime'
import { calibraApi } from '@/utils/api'
import { isDesktopRuntime } from '@/runtime/desktop'

type ActiveOrganization = {
  id: string
  name: string
  slug: string
  members?: Array<{ role?: string | null }>
}

export type { DashboardUnitSummary, DashboardUnitsResponse }

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
  const isDesktop = isDesktopRuntime()
  const { data: cloudActiveOrg } = useActiveOrganization()
  const desktopSessionQuery = useQuery({
    queryKey: ['desktop-local-session'],
    enabled: isDesktop,
    queryFn: () => calibraApi.sync.getSession(),
    staleTime: 30_000,
  })
  const desktopSession = desktopSessionQuery.data?.data ?? null
  const desktopUnits = desktopSession?.activeUnits ?? []
  const desktopCanAccessAllUnits =
    desktopSession?.permissions.canAccessAllUnits ?? false
  const desktopActiveOrg: ActiveOrganization | undefined = desktopSession
    ? {
        id: desktopSession.organization.id,
        name: desktopSession.organization.id,
        slug: desktopSession.organization.id,
        members: [
          {
            role: desktopSession.permissions.role,
          },
        ],
      }
    : undefined
  const activeOrg = cloudActiveOrg ?? desktopActiveOrg
  // Every cloud laboratory can run several units; the desktop shell only
  // knows the units its local session was granted.
  const hasMultiUnit = isDesktop
    ? desktopUnits.length > 1 || desktopCanAccessAllUnits
    : true

  const unitsQuery = useQuery({
    queryKey: [
      'dashboard-units',
      activeOrg?.id ?? 'no-org',
      hasMultiUnit,
      isDesktop ? 'desktop' : 'cloud',
    ],
    enabled: Boolean(activeOrg?.id && hasMultiUnit),
    queryFn: async () => calibraApi.units.getDashboardUnits(),
  })

  const data = hasMultiUnit ? unitsQuery.data : null
  const isCheckingAccess = isDesktop ? desktopSessionQuery.isPending : false
  const canUseSingleUnitFallback = Boolean(activeOrg) && !hasMultiUnit
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
      : (data.activeUnitName ?? activeOrg?.slug ?? 'Nenhuma unidade')
    : (activeOrg?.slug ?? 'Nenhum selecionado')
  const selectedUnit = data
    ? data.selectedUnitScope === 'unit'
      ? (data.data.find((unit) => unit.id === data.activeUnitId) ?? null)
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
