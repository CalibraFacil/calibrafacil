import { createFileRoute } from '@tanstack/react-router'

import { NewAssetPage } from '@/features/assets/new-page'
import { loadNewAssetData } from '@/features/assets/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/assets/new')({
  loader: ({ context }) => loadNewAssetData(context.queryClient),
  head: () => routeHead('/dashboard/assets/new'),
  component: NewAssetPage,
})
