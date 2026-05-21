import { createFileRoute } from '@tanstack/react-router'

import { DashboardIndex } from '@/features/dashboard/page'
import { loadDashboardIndexData } from '@/features/dashboard/queries'

export const Route = createFileRoute('/dashboard/')({
  loader: ({ context }) => loadDashboardIndexData(context.queryClient),
  head: () => ({
    meta: [
      {
        title: 'Dashboard | CalibraFácil',
        name: 'description',
        content: 'Painel de Controle - Visão geral do laboratório',
      },
    ],
  }),
  component: DashboardIndex,
})
