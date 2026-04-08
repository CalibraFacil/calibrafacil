import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import { usePlanAccess } from '@/hooks/use-plan-access'
import { api } from '@/utils/api'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const DASHBOARD_UNIT_KEY_PREFIX = 'dashboard-active-unit:'

type UnitSummary = {
  id: number
  name: string
  slug: string
  role: string
}

type UnitsResponse = {
  activeUnitId: number | null
  activeUnitName: string | null
  selectedUnitScope: 'all' | 'unit'
  canAccessAllUnits: boolean
  data: UnitSummary[]
}

export function UnitSwitcher() {
  const queryClient = useQueryClient()
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

      return (await response.json()) as UnitsResponse
    },
  })

  const currentValue = useMemo(() => {
    if (!unitsQuery.data) return ''
    if (unitsQuery.data.selectedUnitScope === 'all') return 'all'
    return unitsQuery.data.activeUnitId ? String(unitsQuery.data.activeUnitId) : ''
  }, [unitsQuery.data])

  if (!activeOrg?.id || accessQuery.isPending || !hasMultiUnit) {
    return null
  }

  if (unitsQuery.isPending || !unitsQuery.data) {
    return null
  }

  if (
    unitsQuery.data.data.length <= 1 &&
    !unitsQuery.data.canAccessAllUnits
  ) {
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
    <Select value={currentValue} onValueChange={handleChange}>
      <SelectTrigger className="w-[220px]">
        <SelectValue placeholder="Selecionar unidade" />
      </SelectTrigger>
      <SelectContent>
        {unitsQuery.data.canAccessAllUnits ? (
          <SelectItem value="all">Todas as unidades</SelectItem>
        ) : null}
        {unitsQuery.data.data.map((unit) => (
          <SelectItem key={unit.id} value={String(unit.id)}>
            {unit.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
