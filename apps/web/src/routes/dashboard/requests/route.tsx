import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/requests')({
  component: RequestsLayout,
})

function RequestsLayout() {
  return <Outlet />
}
