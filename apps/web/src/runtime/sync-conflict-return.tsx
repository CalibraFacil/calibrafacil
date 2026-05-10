import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export type SyncConflictReturnSearch = {
  syncConflictId?: string
  returnTo?: '/dashboard/sync/conflicts'
}

export function parseSyncConflictReturnSearch(
  search: Record<string, unknown>,
): SyncConflictReturnSearch {
  return {
    syncConflictId:
      typeof search.syncConflictId === 'string'
        ? search.syncConflictId
        : undefined,
    returnTo:
      search.returnTo === '/dashboard/sync/conflicts'
        ? '/dashboard/sync/conflicts'
        : undefined,
  }
}

export function getSyncConflictReturnSearch(conflictId: string) {
  return {
    syncConflictId: conflictId,
    returnTo: '/dashboard/sync/conflicts',
  } satisfies SyncConflictReturnSearch
}

export function shouldReturnToSyncConflicts(search: SyncConflictReturnSearch) {
  return Boolean(search.syncConflictId && search.returnTo)
}

export function SyncConflictReturnNotice({
  search,
}: {
  search: SyncConflictReturnSearch
}) {
  if (!shouldReturnToSyncConflicts(search)) return null

  return (
    <Card className="border-amber-500/40 bg-amber-500/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Edição para conflito local</CardTitle>
        <CardDescription>
          Ajuste os campos necessários, salve e volte para tentar sincronizar a
          alteração local novamente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          render={<Link to="/dashboard/sync/conflicts" />}
        >
          Voltar aos conflitos
        </Button>
      </CardContent>
    </Card>
  )
}
