import { Outlet, createFileRoute } from '@tanstack/react-router'
import { AppSidebar } from '@/components/app-sidebar'

export const Route = createFileRoute('/dashboard')({
  component: DashboardLayout,
})

function DashboardLayout() {
  return (
    <AppSidebar>
      <Outlet />
    </AppSidebar>
  )
}
