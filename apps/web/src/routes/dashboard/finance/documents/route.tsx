import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/finance/documents')({
  component: FinanceDocumentsLayout,
})

function FinanceDocumentsLayout() {
  return <Outlet />
}
