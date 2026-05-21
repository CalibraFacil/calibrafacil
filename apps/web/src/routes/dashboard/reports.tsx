import { createFileRoute } from '@tanstack/react-router'

import { ConsolidatedReportsPage } from '@/features/reports/page'

export const Route = createFileRoute('/dashboard/reports')({
  head: () => ({
    meta: [{ title: 'Relatórios Consolidados | CalibraFácil' }],
  }),
  component: ConsolidatedReportsPage,
})
