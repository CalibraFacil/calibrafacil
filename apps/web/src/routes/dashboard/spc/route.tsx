import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/spc')({
  component: SpcLayout,
})

function SpcLayout() {
  return <Outlet />
}
