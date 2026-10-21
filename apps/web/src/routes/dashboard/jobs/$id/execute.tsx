import { createFileRoute } from '@tanstack/react-router'

import { ExecuteJobPage } from '@/features/jobs/execute-page'
import { useExecutionDraftOwner } from '@/features/jobs/use-execution-draft-owner'
import { TanStackUnsavedChangesGate } from '@/lib/unsaved-changes-gate'
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
  const draftScope = useExecutionDraftOwner()

  // The router-owned navigation gate is injected so the feature stays free of
  // router coupling.
  return (
    <ExecuteJobPage
      id={id}
      conflictReturn={conflictReturn}
      draftScope={draftScope}
      UnsavedChangesGate={TanStackUnsavedChangesGate}
    />
  )
}
