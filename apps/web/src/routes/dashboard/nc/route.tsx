import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/nc')({
  component: NonConformanceLayout,
})

function NonConformanceLayout() {
  return <Outlet />
}
