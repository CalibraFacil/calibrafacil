import {
  Link,
  Outlet,
  createFileRoute,
  useParams,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft02Icon, Edit02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { calibraApi } from '@/utils/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { clientRouteId } from '@/lib/route-identifiers'

export const Route = createFileRoute('/dashboard/assets/$id')({
  component: AssetDetailLayout,
})

type AssetStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | 'SCRAPPED'

const statusLabels: Record<AssetStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  MAINTENANCE: 'Em Manutenção',
  SCRAPPED: 'Descartado',
}

const statusVariants: Record<
  AssetStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  ACTIVE: 'default',
  INACTIVE: 'secondary',
  MAINTENANCE: 'outline',
  SCRAPPED: 'destructive',
}

function AssetDetailLayout() {
  const { id } = useParams({ from: '/dashboard/assets/$id' })

  const {
    data: asset,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['asset', id],
    queryFn: async () => {
      return calibraApi.assets.get(id)
    },
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:space-y-0">
        <div className="flex items-start gap-3 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            render={<Link to="/dashboard/assets" />}
            className="mt-0.5 active:scale-[0.96]"
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
            ) : error ? (
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-destructive">
                  Ativo nao encontrado
                </h1>
              </div>
            ) : asset ? (
              <div className="space-y-3">
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <h1 className="text-balance text-2xl font-semibold tracking-tight">
                    {asset.name}
                  </h1>
                  <Badge variant={statusVariants[asset.status as AssetStatus]}>
                    {statusLabels[asset.status as AssetStatus]}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                  <span className="font-mono tabular-nums">{asset.tag}</span>
                  <span>-</span>
                  <Link
                    to="/dashboard/clients/$id"
                    params={{
                      id: clientRouteId({
                        name: asset.customerName,
                        taxId: asset.customerTaxId,
                      }),
                    }}
                    className="text-pretty hover:underline"
                  >
                    {asset.customerName}
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {asset && (
          <Button
            variant="outline"
            render={<Link to="/dashboard/assets/$id/edit" params={{ id }} />}
            className="hidden active:scale-[0.96] sm:inline-flex"
          >
            <HugeiconsIcon icon={Edit02Icon} className="mr-2 size-4" />
            Editar
          </Button>
        )}
      </div>

      {asset && (
        <Button
          variant="outline"
          render={<Link to="/dashboard/assets/$id/edit" params={{ id }} />}
          className="w-full active:scale-[0.96] sm:hidden"
        >
          <HugeiconsIcon icon={Edit02Icon} className="mr-2 size-4" />
          Editar ativo
        </Button>
      )}

      {/* Content */}
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
