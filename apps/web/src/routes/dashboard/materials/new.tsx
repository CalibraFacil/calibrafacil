import { createFileRoute } from '@tanstack/react-router'

import { NewMaterialPage } from '@/features/materials/new-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/materials/new')({
  head: () => routeHead('/dashboard/materials/new'),
  component: NewMaterialPage,
})
