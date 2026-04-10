import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/finance/contracts')({
  component: FinanceContractsLayout,
})

function FinanceContractsLayout() {
  return <Outlet />
}
