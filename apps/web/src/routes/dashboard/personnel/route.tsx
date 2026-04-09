import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/personnel')({
  component: PersonnelLayout,
})

function PersonnelLayout() {
  return <Outlet />
}
