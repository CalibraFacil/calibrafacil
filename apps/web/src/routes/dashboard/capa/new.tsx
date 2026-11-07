import { createFileRoute } from '@tanstack/react-router'

import { NewCAPAPage } from '@/features/quality/capa-new-page'
import { routeHead } from '@/app/router/route-registry'

export { NewCAPAPage } from '@/features/quality/capa-new-page'

export const Route = createFileRoute('/dashboard/capa/new')({
  head: () => routeHead('/dashboard/capa/new'),
  component: NewCAPAPage,
})
