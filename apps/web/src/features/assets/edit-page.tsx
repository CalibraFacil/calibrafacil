import { useNavigate } from '@tanstack/react-router'

import { useAssetDetailData } from '@/features/assets/queries'
import { AssetEditForm } from '@/features/assets/components/asset-edit-form'
import { Skeleton } from '@/components/ui/skeleton'
import { Panel } from '@/components/instrument-panel'
import { assetRouteId } from '@/lib/route-identifiers'
import {
  shouldReturnToSyncConflicts,
  SyncConflictReturnNotice,
  type SyncConflictReturnSearch,
} from '@/runtime/sync-conflict-return'

export function EditAssetPage({
  id,
  conflictReturn,
}: {
  id: string
  conflictReturn: SyncConflictReturnSearch
}) {
  const navigate = useNavigate()
  const { data: asset, isLoading, error: fetchError } = useAssetDetailData(id)

  if (isLoading) {
    return (
      <div className="space-y-6">
        {Array.from({ length: 2 }).map((_section, sectionIndex) => (
          <Panel key={sectionIndex} className="space-y-4 p-4 sm:p-5">
            <Skeleton className="h-5 w-40" />
            {Array.from({ length: 3 }).map((_field, fieldIndex) => (
              <div key={fieldIndex} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </Panel>
        ))}
      </div>
    )
  }

  if (fetchError || !asset) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          Erro ao carregar ativo. Tente novamente.
        </p>
      </Panel>
    )
  }

  return (
    <div className="space-y-6">
      <SyncConflictReturnNotice search={conflictReturn} />

      <div>
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {asset.tag}
        </p>
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Editar ativo
        </h1>
      </div>

      <AssetEditForm
        key={asset.id}
        asset={asset}
        assetId={id}
        onSaved={(updated) => {
          if (shouldReturnToSyncConflicts(conflictReturn)) {
            navigate({ to: '/dashboard/sync/conflicts' })
            return
          }
          navigate({
            to: '/dashboard/assets/$id',
            params: { id: assetRouteId({ tag: updated.tag }) },
          })
        }}
        onCancel={() =>
          navigate({ to: '/dashboard/assets/$id', params: { id } })
        }
      />
    </div>
  )
}
