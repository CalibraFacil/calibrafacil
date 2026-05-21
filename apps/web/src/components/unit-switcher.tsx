import { useQueryClient } from '@tanstack/react-query'

import { useDashboardUnits } from '@/hooks/use-dashboard-units'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { setStoredDashboardActiveUnitIdForOrganization } from '@/features/dashboard/dashboard-scope-storage'

export function UnitSwitcher() {
  const queryClient = useQueryClient()
  const { activeOrg, currentUnitValue, data, hasMultiUnit, isCheckingAccess } =
    useDashboardUnits()

  if (!activeOrg?.id || isCheckingAccess || !hasMultiUnit) {
    return null
  }

  if (!data) {
    return null
  }

  if (data.data.length <= 1 && !data.canAccessAllUnits) {
    return null
  }

  const handleChange = async (value: string | null) => {
    if (!value) return

    setStoredDashboardActiveUnitIdForOrganization(activeOrg.id, value)

    await queryClient.invalidateQueries()
  }

  return (
    <Select value={currentUnitValue} onValueChange={handleChange}>
      <SelectTrigger className="w-[220px]">
        <SelectValue placeholder="Selecionar unidade" />
      </SelectTrigger>
      <SelectContent>
        {data.canAccessAllUnits ? (
          <SelectItem value="all">Todas as unidades</SelectItem>
        ) : null}
        {data.data.map((unit) => (
          <SelectItem key={unit.id} value={String(unit.id)}>
            {unit.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
