import { createFileRoute } from '@tanstack/react-router'

import { ExecuteJobPage } from '@/features/jobs/execute-page'
import { parseSyncConflictReturnSearch } from '@/runtime/sync-conflict-return'

export const Route = createFileRoute('/dashboard/jobs/$id/execute')({
  validateSearch: parseSyncConflictReturnSearch,
  head: () => ({
    meta: [{ title: 'Executar Calibração | CalibraFacil' }],
  }),
  component: ExecuteJobRoute,
})

function ExecuteJobRoute() {
  const { id } = Route.useParams()
  const conflictReturn = Route.useSearch()

  return <ExecuteJobPage id={id} conflictReturn={conflictReturn} />
}
