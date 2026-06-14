import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/clients/groups/$groupId/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/clients/groups/$groupId/overview',
      params: { groupId: params.groupId },
    })
  },
  component: () => null,
})
