import { createFileRoute } from '@tanstack/react-router'

import { NewNCPage } from '@/features/quality/nc-new-page'

export { NewNCPage } from '@/features/quality/nc-new-page'

export const Route = createFileRoute('/dashboard/nc/new')({
  head: () => ({
    meta: [{ title: 'Registrar Não Conformidade | CalibraFacil' }],
  }),
  component: NewNCRoute,
})

function NewNCRoute() {
  return <NewNCPage />
}
