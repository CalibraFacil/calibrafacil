import { createFileRoute } from '@tanstack/react-router'

import { NewAssetPage } from '@/features/assets/new-page'
import { loadNewAssetData } from '@/features/assets/queries'

export const Route = createFileRoute('/dashboard/assets/new')({
  loader: ({ context }) => loadNewAssetData(context.queryClient),
  head: () => ({
    meta: [{ title: 'Novo Ativo | CalibraFácil' }],
  }),
  component: NewAssetPage,
})
