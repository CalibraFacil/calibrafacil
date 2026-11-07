import { createFileRoute } from '@tanstack/react-router'

import { SyncConflictsPage } from '@/features/sync/conflicts-page'
import { routeHead } from '@/app/router/route-registry'

export { SyncConflictsPage } from '@/features/sync/conflicts-page'

export const Route = createFileRoute('/dashboard/sync/conflicts')({
  head: () => routeHead('/dashboard/sync/conflicts'),
  component: SyncConflictsPage,
})
