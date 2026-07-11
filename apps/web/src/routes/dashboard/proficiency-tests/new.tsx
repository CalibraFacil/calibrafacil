import { createFileRoute } from '@tanstack/react-router'

import { NewProficiencyTestPage } from '@/features/proficiency-tests/new-page'

export const Route = createFileRoute('/dashboard/proficiency-tests/new')({
  head: () => ({
    meta: [{ title: 'Novo Ensaio de Proficiência | CalibraFacil' }],
  }),
  component: NewProficiencyTestPage,
})
