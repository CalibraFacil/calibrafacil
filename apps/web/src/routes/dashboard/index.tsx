import { createFileRoute } from '@tanstack/react-router'

import { routeHead } from '@/app/router/route-registry'
import { DashboardIndex } from '@/features/dashboard/page'
import { loadDashboardIndexData } from '@/features/dashboard/queries'

export const Route = createFileRoute('/dashboard/')({
  loader: ({ context }) => loadDashboardIndexData(context.queryClient),
  head: () =>
    routeHead('/dashboard', [
      {
        name: 'description',
        content: 'Painel de Controle - Visão geral do laboratório',
      },
    ]),
  component: DashboardIndex,
})
