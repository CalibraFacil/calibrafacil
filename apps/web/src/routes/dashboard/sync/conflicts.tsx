import { createFileRoute } from '@tanstack/react-router'

import { SyncConflictsPage } from '@/features/sync/conflicts-page'

export { SyncConflictsPage } from '@/features/sync/conflicts-page'

export const Route = createFileRoute('/dashboard/sync/conflicts')({
  head: () => ({
    meta: [{ title: 'Conflitos de sincronização | CalibraFácil' }],
  }),
  component: SyncConflictsPage,
})
