import { createFileRoute } from '@tanstack/react-router'

import { NewNCPage } from '@/features/quality/nc-new-page'
import { routeHead } from '@/app/router/route-registry'

export { NewNCPage } from '@/features/quality/nc-new-page'

export const Route = createFileRoute('/dashboard/nc/new')({
  head: () => routeHead('/dashboard/nc/new'),
  component: NewNCRoute,
})

function NewNCRoute() {
  return <NewNCPage />
}
