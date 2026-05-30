import { Outlet, createFileRoute } from '@tanstack/react-router'

// Layout retained only so the legacy child routes can redirect into Accounts.
export const Route = createFileRoute('/backoffice/customer-success')({
  component: () => <Outlet />,
})
