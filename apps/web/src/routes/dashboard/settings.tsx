import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/settings')({
  head: () => ({
    meta: [
      {
        title: 'Configurações | CalibraFácil',
        name: 'description',
        content: 'Configurações da sua conta CalibraFácil',
      },
    ],
  }),
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/dashboard/settings"!</div>
}
