import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/methods')({
  component: MethodsLayout,
})

function MethodsLayout() {
  return <Outlet />
}
