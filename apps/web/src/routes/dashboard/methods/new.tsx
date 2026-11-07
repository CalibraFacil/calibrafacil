import { createFileRoute } from '@tanstack/react-router'

import { NewMethodPage } from '@/features/methods/new-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/methods/new')({
  head: () => routeHead('/dashboard/methods/new'),
  component: NewMethodPage,
})
