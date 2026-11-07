import { createFileRoute } from '@tanstack/react-router'

import { NewStandardPage } from '@/features/standards/new-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/standards/new')({
  head: () => routeHead('/dashboard/standards/new'),
  component: NewStandardPage,
})
