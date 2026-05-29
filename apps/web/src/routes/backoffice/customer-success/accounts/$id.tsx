import { createFileRoute, redirect } from '@tanstack/react-router'

// Customer-success account workspace folded into the unified Account profile.
export const Route = createFileRoute(
  '/backoffice/customer-success/accounts/$id',
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/backoffice/accounts/$id',
      params: { id: params.id },
    })
  },
})
