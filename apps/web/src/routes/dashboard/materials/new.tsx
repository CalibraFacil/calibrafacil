import { createFileRoute } from '@tanstack/react-router'

import { NewMaterialPage } from '@/features/materials/new-page'

export const Route = createFileRoute('/dashboard/materials/new')({
  head: () => ({
    meta: [{ title: 'Novo Material | CalibraFácil' }],
  }),
  component: NewMaterialPage,
})
