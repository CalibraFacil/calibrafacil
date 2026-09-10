import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  PlusSignIcon,
  Search01Icon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  useCustomerAssetsData,
  useCustomerDetailData,
} from '@/features/customers/queries'
import type { CustomerAssetStatus } from '@/features/customers/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { assetRouteId } from '@/lib/route-identifiers'
import {
  ClientPanel,
  ClientPanelBody,
  TableFrame,
  Toolbar,
} from '@/features/customers/components/client-detail-ui'

const statusLabels: Record<CustomerAssetStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  MAINTENANCE: 'Manutenção',
  SCRAPPED: 'Descartado',
}

const statusVariants: Record<
  CustomerAssetStatus,
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

export function ClientEquipmentTab({ id }: { id: string }) {
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const limit = 20

  const { data: customer, isLoading: customerLoading } =
    useCustomerDetailData(id)

  const customerId = customer?.id

  const { data, isLoading, error } = useCustomerAssetsData({
    customerId,
    page,
    limit,
    search,
  })
  const pagination = data?.pagination

  return (
    <ClientPanel
      title="Instrumentos do Cliente"
      description="Consulte os instrumentos vinculados, seus identificadores e o próximo ciclo de calibração."
      icon={<HugeiconsIcon icon={Wrench01Icon} className="size-5" />}
      action={
        <Button
          render={
            <Link
              to="/dashboard/assets/new"
              search={customerId ? { customerId } : {}}
            />
          }
        >
          <HugeiconsIcon
            icon={PlusSignIcon}
            className="mr-2 size-4"
            aria-hidden="true"
          />
          Novo Ativo
        </Button>
      }
    >
      <ClientPanelBody>
        <Toolbar>
          <div className="relative max-w-sm">
            <HugeiconsIcon
              icon={Search01Icon}
              className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2"
            />
            <Input
              placeholder="Buscar por nome, tag, série..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="pl-9"
            />
          </div>
        </Toolbar>

        {(customerLoading || isLoading) && <EquipmentTableSkeleton />}

        {error && (
          <div className="py-8 text-center text-sm text-destructive">
            Erro ao carregar ativos. Tente novamente.
          </div>
        )}

        {!isLoading && !error && data?.data?.length === 0 && (
          <Empty className="rounded-none border-x-0 border-y border-solid border-border/70 py-10">
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
                    <Link
                      to="/dashboard/assets/new"
                      search={customerId ? { customerId } : {}}
                    />
                  }
                >
                  <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
                  Novo Ativo
                </Button>
              )}
            </EmptyContent>
          </Empty>
        )}

        {!isLoading && !error && data?.data && data.data.length > 0 && (
          <>
            <TableFrame>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tag</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Fabricante</TableHead>
                    <TableHead>N. Série</TableHead>
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
                          params: { id: assetRouteId(asset) },
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
                        <Badge variant={statusVariants[asset.status]}>
                          {statusLabels[asset.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {formatDate(asset.nextCalibrationDate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>

            {pagination && pagination.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <div className="text-muted-foreground text-sm">
                  Página {pagination.page} de {pagination.totalPages} (
                  {pagination.total} ativos)
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
                      setPage((p) => Math.min(pagination.totalPages, p + 1))
                    }
                    disabled={page === pagination.totalPages}
                  >
                    Próximo
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </ClientPanelBody>
    </ClientPanel>
  )
}

function EquipmentTableSkeleton() {
  return (
    <TableFrame>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tag</TableHead>
            <TableHead>Nome</TableHead>
            <TableHead>Fabricante</TableHead>
            <TableHead>N. Série</TableHead>
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
    </TableFrame>
  )
}
