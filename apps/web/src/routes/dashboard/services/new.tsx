import { createFileRoute } from '@tanstack/react-router'

import { NewServicePage } from '@/features/services/new-page'
import { loadServiceFormOptions } from '@/features/services/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/services/new')({
  head: () => routeHead('/dashboard/services/new'),
  loader: ({ context }) => loadServiceFormOptions(context.queryClient),
  component: NewServicePage,
})
