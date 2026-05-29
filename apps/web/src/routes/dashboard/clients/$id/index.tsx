import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/clients/$id/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/clients/$id/overview',
      params: { id: params.id },
    })
  },
  component: () => null,
})
