import {
  Link,
  Outlet,
  createFileRoute,
  useParams,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft02Icon, Edit02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { api } from '@/utils/api'
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
      const res = await api.api.assets[':id'].$get({
        param: { id },
      })
      if (!res.ok) {
        throw new Error('Falha ao carregar ativo')
      }
      return res.json()
    },
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            render={<Link to="/dashboard/assets" />}
            className="mt-0.5"
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} className="size-5" />
          </Button>
          <div className="flex-1 min-w-0">
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
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {asset.name}
                  </h1>
                  <Badge variant={statusVariants[asset.status as AssetStatus]}>
                    {statusLabels[asset.status as AssetStatus]}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                  <span className="font-mono">{asset.tag}</span>
                  <span>-</span>
                  <Link
                    to="/dashboard/clients/$id"
                    params={{
                      id: clientRouteId({
                        name: asset.customerName,
                        taxId: asset.customerTaxId,
                      }),
                    }}
                    className="hover:underline"
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
          >
            <HugeiconsIcon icon={Edit02Icon} className="mr-2 size-4" />
            Editar
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
