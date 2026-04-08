import { createContext, useContext } from 'react'

export type DashboardContextState = {
  isContextSwitching: boolean
  activeOrganizationId: string | null
}

export const DashboardContextStateContext =
  createContext<DashboardContextState>({
    isContextSwitching: false,
    activeOrganizationId: null,
  })

export function useDashboardContextState() {
  return useContext(DashboardContextStateContext)
}
