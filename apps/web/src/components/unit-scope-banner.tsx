import { useQueryClient } from '@tanstack/react-query'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboardUnits } from '@/hooks/use-dashboard-units'
import { cn } from '@/lib/utils'

const DASHBOARD_UNIT_KEY_PREFIX = 'dashboard-active-unit:'

type GovernanceViewer = {
  viewer: {
    isGlobalManager: boolean
    canManageOrganizationUnits: boolean
    canManageAssignments: boolean
    canManageGlobalRoles: boolean
    canViewGovernance: boolean
    canAccessConsolidatedView: boolean
    managedUnitIds: number[]
  }
  scopeSummary: {
    isConsolidated: boolean
    activeUnitId: number | null
    activeUnitName: string | null
    accessibleUnitsCount: number
    managedUnitsCount: number
    effectiveRole: string
    effectiveRoleLabel: string
    label: string
    description: string
  }
}

type UnitScopeResponse = GovernanceViewer & {
  activeUnitId: number | null
  activeUnitName: string | null
  selectedUnitScope: 'all' | 'unit'
  canAccessAllUnits: boolean
  data: Array<{
    id: number
    name: string
    slug: string
    role: string
  }>
}

export function UnitScopeBanner() {
  const queryClient = useQueryClient()
  const { activeOrg, data, hasMultiUnit, isCheckingAccess, unitsQuery } =
    useDashboardUnits()
  const currentValue = data
    ? data.selectedUnitScope === 'all'
      ? 'all'
      : data.activeUnitId
        ? String(data.activeUnitId)
        : ''
    : ''

  if (!activeOrg?.id || isCheckingAccess || !hasMultiUnit) {
    return null
  }

  if (unitsQuery.isPending) {
    return <Skeleton className="h-28 w-full rounded-2xl" />
  }

  if (!data) {
    return null
  }

  const { scopeSummary, viewer } = data as UnitScopeResponse
  const shouldRender =
    data.data.length > 1 || viewer.canViewGovernance || data.canAccessAllUnits

  if (!shouldRender) {
    return null
  }

  const handleChange = async (value: string) => {
    window.localStorage.setItem(
      `${DASHBOARD_UNIT_KEY_PREFIX}${activeOrg.id}`,
      value,
    )

    await queryClient.invalidateQueries()
  }

  return (
    <section className="rounded-2xl border bg-card px-4 py-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{scopeSummary.label}</Badge>
            <Badge variant="outline">{scopeSummary.effectiveRoleLabel}</Badge>
            {viewer.canAccessConsolidatedView ? (
              <Badge variant="outline">Consolidado global</Badge>
            ) : null}
            {viewer.canManageAssignments ? (
              <Badge variant="outline">
                {scopeSummary.managedUnitsCount} unidade(s) sob gestão
              </Badge>
            ) : null}
          </div>

          <div>
            <p className="text-sm font-medium">
              Escopo operacional de {activeOrg.name}
            </p>
            <p className="text-sm text-muted-foreground">
              {scopeSummary.description}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 xl:max-w-[56rem] xl:justify-end">
          {data.canAccessAllUnits ? (
            <Button
              type="button"
              size="sm"
              variant={currentValue === 'all' ? 'default' : 'outline'}
              onClick={() => handleChange('all')}
              className={cn(
                'rounded-full',
                currentValue === 'all' && 'shadow-sm',
              )}
            >
              Todas as unidades
            </Button>
          ) : null}

          {data.data.map((unit) => {
            const isActive = currentValue === String(unit.id)
            const roleLabel =
              unit.role === 'unit_admin'
                ? 'Admin. da unidade'
                : unit.role === 'technician'
                  ? 'Técnico'
                  : 'Escopo operacional'

            return (
              <Button
                key={unit.id}
                type="button"
                size="sm"
                variant={isActive ? 'default' : 'outline'}
                onClick={() => handleChange(String(unit.id))}
                className={cn(
                  'rounded-full px-3 text-left',
                  isActive && 'shadow-sm',
                )}
              >
                <span className="flex items-center gap-2">
                  <span>{unit.name}</span>
                  <span
                    aria-hidden="true"
                    className="size-1 rounded-full bg-current/45"
                  />
                  <span className="text-xs font-normal opacity-80">
                    {roleLabel}
                  </span>
                </span>
              </Button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
