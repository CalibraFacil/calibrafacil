import { createFileRoute } from '@tanstack/react-router'

import { loadBackofficeIndexData } from '@/features/backoffice/queries'
import { BackofficeCommandCenter } from '@/features/backoffice/command-center/page'

export const Route = createFileRoute('/backoffice/')({
  head: () => ({
    meta: [{ title: 'Comando | Backoffice | CalibraFácil' }],
  }),
  loader: ({ context }) => loadBackofficeIndexData(context.queryClient),
  component: BackofficeCommandCenter,
})
