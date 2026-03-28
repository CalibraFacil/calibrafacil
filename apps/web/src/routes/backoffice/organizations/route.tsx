import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/backoffice/organizations')({
  component: OrganizationsLayout,
})

function OrganizationsLayout() {
  return <Outlet />
}
