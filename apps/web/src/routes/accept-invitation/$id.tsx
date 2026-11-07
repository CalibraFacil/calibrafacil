import { createFileRoute } from '@tanstack/react-router'
import { AcceptInvitationPage } from '@/features/public/accept-invitation-page'

export const Route = createFileRoute('/accept-invitation/$id')({
  head: () => ({
    meta: [
      {
        title: 'Convite para Organização | CalibraFácil',
        name: 'description',
        content: 'Aceitar convite para participar de uma organização',
      },
    ],
  }),
  component: AcceptInvitationRoute,
})

function AcceptInvitationRoute() {
  const { id } = Route.useParams()

  return <AcceptInvitationPage id={id} />
}
