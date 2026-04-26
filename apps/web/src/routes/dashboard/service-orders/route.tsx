import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/service-orders')({
  component: ServiceOrdersLayout,
})

function ServiceOrdersLayout() {
  return <Outlet />
}
