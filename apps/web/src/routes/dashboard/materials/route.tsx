import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/materials')({
  component: MaterialsLayout,
})

function MaterialsLayout() {
  return <Outlet />
}
