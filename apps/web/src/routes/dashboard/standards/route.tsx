import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/standards')({
  component: StandardsLayout,
})

function StandardsLayout() {
  return <Outlet />
}
