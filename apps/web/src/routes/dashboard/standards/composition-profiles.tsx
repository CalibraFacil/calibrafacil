import { createFileRoute } from '@tanstack/react-router'

import { StandardsCompositionProfilesPage } from '@/features/standards/composition-profiles-page'
import { loadCompositionProfilesCatalogData } from '@/features/standards/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute(
  '/dashboard/standards/composition-profiles',
)({
  loader: ({ context }) =>
    loadCompositionProfilesCatalogData(context.queryClient),
  head: () => routeHead('/dashboard/standards/composition-profiles'),
  component: StandardsCompositionProfilesPage,
})
