import { createFileRoute, redirect } from '@tanstack/react-router'

// Organization detail folded into the unified Account profile.
export const Route = createFileRoute('/backoffice/organizations/$id')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/backoffice/accounts/$id',
      params: { id: params.id },
    })
  },
})
