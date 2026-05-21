import { createFileRoute } from '@tanstack/react-router'

import { DashboardLayout } from '@/features/dashboard/dashboard-shell'
import { dashboardBeforeLoad } from '@/features/dashboard/dashboard-session'

export { useDashboardContextState } from '@/contexts/dashboard-context'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: dashboardBeforeLoad,
  component: DashboardLayout,
})
