import { createFileRoute } from '@tanstack/react-router'

import { NewCAPAPage } from '@/features/quality/capa-new-page'

export { NewCAPAPage } from '@/features/quality/capa-new-page'

export const Route = createFileRoute('/dashboard/capa/new')({
  head: () => ({
    meta: [{ title: 'Nova CAPA | CalibraFacil' }],
  }),
  component: NewCAPAPage,
})
