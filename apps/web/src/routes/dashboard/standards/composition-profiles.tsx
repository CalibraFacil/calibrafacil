import { createFileRoute } from '@tanstack/react-router'

import { StandardsCompositionProfilesPage } from '@/features/standards/composition-profiles-page'
import { loadCompositionProfilesCatalogData } from '@/features/standards/queries'

export const Route = createFileRoute(
  '/dashboard/standards/composition-profiles',
)({
  loader: ({ context }) =>
    loadCompositionProfilesCatalogData(context.queryClient),
  head: () => ({
    meta: [{ title: 'Perfis de Composição | CalibraFácil' }],
  }),
  component: StandardsCompositionProfilesPage,
})
