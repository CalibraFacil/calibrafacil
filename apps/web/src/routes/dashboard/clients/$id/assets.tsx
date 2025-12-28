import {
  Link,
  createFileRoute,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  PlusSignIcon,
  Search01Icon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

export const Route = createFileRoute('/dashboard/clients/$id/assets')({
  component: ClientEquipmentTab,
})

type AssetStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | 'SCRAPPED'

const statusLabels: Record<AssetStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  MAINTENANCE: 'Manutenção',
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

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-'
  const d = new Date(date)
  return d.toLocaleDateString('pt-BR')
}

function ClientEquipmentTab() {
  const navigate = useNavigate()
  const { id } = useParams({ from: '/dashboard/clients/$id/assets' })
  const customerId = parseInt(id, 10)

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const limit = 20

  const { data, isLoading, error } = useQuery({
    queryKey: ['assets', 'customer', customerId, page, limit, search],
    queryFn: async () => {
      const res = await api.api.assets.$get({
        query: {
          page: String(page),
          limit: String(limit),
          customerId: String(customerId),
          query: search || undefined,
        },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar ativos')
      }

      return res.json()
    },
    enabled: !isNaN(customerId),
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Ativos</CardTitle>
            <CardDescription>Ativos cadastrados deste cliente.</CardDescription>
          </div>
          <Button
            render={<Link to="/dashboard/assets/new" search={{ customerId }} />}
          >
            <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
            Novo Ativo
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-sm">
            <HugeiconsIcon
              icon={Search01Icon}
              className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2"
            />
            <Input
              placeholder="Buscar por nome, tag, serie..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="pl-9"
            />
          </div>
        </div>

        {/* Loading state */}
        {isLoading && <EquipmentTableSkeleton />}

        {/* Error state */}
        {error && (
          <div className="text-destructive py-8 text-center">
            Erro ao carregar ativos. Tente novamente.
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && data?.data?.length === 0 && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Wrench01Icon} />
              </EmptyMedia>
              <EmptyTitle>Nenhum ativo encontrado</EmptyTitle>
              <EmptyDescription>
                {search
                  ? 'Nenhum ativo corresponde à sua busca.'
                  : 'Este cliente ainda não possui ativos cadastrados.'}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {!search && (
                <Button
                  render={
                    <Link to="/dashboard/assets/new" search={{ customerId }} />
                  }
                >
                  <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
                  Novo Ativo
                </Button>
              )}
            </EmptyContent>
          </Empty>
        )}

        {/* Data table */}
        {!isLoading && !error && data?.data && data.data.length > 0 && (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tag</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Fabricante</TableHead>
                    <TableHead>N. Serie</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Prox. Calibração</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((asset) => (
                    <TableRow
                      key={asset.id}
                      className="cursor-pointer"
                      onClick={() =>
                        navigate({
                          to: '/dashboard/assets/$id',
                          params: { id: String(asset.id) },
                        })
                      }
                    >
                      <TableCell className="font-mono font-medium">
                        {asset.tag}
                      </TableCell>
                      <TableCell>{asset.name}</TableCell>
                      <TableCell>{asset.manufacturer || '-'}</TableCell>
                      <TableCell className="font-mono">
                        {asset.serialNumber}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={statusVariants[asset.status as AssetStatus]}
                        >
                          {statusLabels[asset.status as AssetStatus]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {formatDate(asset.nextCalibrationDate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {data.pagination.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <div className="text-muted-foreground text-sm">
                  Pagina {data.pagination.page} de {data.pagination.totalPages}{' '}
                  ({data.pagination.total} ativos)
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPage((p) =>
                        Math.min(data.pagination.totalPages, p + 1),
                      )
                    }
                    disabled={page === data.pagination.totalPages}
                  >
                    Proximo
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function EquipmentTableSkeleton() {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tag</TableHead>
            <TableHead>Nome</TableHead>
            <TableHead>Fabricante</TableHead>
            <TableHead>N. Serie</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Prox. Calibração</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
