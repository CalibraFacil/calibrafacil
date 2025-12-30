import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/')({
  head: () => ({
    meta: [
      {
        title: 'Dashboard | CalibraFácil',
        name: 'description',
        content: 'Painel de Controle',
      },
    ],
  }),
  component: DashboardIndex,
})

function DashboardIndex() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Painel de Controle
        </h1>
        <p className="text-muted-foreground">
          Olá, usuário! Bem-vindo ao seu painel de controle.
        </p>
      </div>
    </div>
  )
}
