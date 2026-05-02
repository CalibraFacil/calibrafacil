import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { parseAsInteger, useQueryState } from 'nuqs'
import { type ColumnDef } from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ClipboardIcon,
  MoreHorizontalIcon,
  PlusSignIcon,
  ViewIcon,
} from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { DataTable } from '@/components/ui/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { usePathPrewarmIntent } from '@/lib/use-route-prewarm-intent'

export const Route = createFileRoute('/dashboard/service-orders/')({
  head: () => ({ meta: [{ title: 'Ordens de Serviço | CalibraFácil' }] }),
  component: ServiceOrdersPage,
})

type ServiceOrderListItem = {
  id: number
  serviceOrderNumber: string
  customerName: string
  assetName: string
  assetSerialNumber: string | null
  status: string
  statusLabel: string
  priority: string
  responsibleTechnicianName: string | null
  openedAt: string
  quotedAt: string | null
  approvedAt: string | null
  totalApprovedCents: number
  totalQuotedCents: number
  unitName: string
}

type ServiceOrderStatus =
  | 'opened'
  | 'awaiting_tech_evaluation'
  | 'under_evaluation'
  | 'awaiting_quote_approval'
  | 'quote_approved'
  | 'quote_rejected'
  | 'repair_in_progress'
  | 'awaiting_calibration'
  | 'calibration_in_progress'
  | 'awaiting_final_review'
  | 'ready_for_pickup'
  | 'delivered'
  | 'closed'
  | 'canceled'
  | 'warranty_return'

const statusLabels: Record<ServiceOrderStatus, string> = {
  opened: 'Aberta',
  awaiting_tech_evaluation: 'Aguardando avaliação',
  under_evaluation: 'Em avaliação',
  awaiting_quote_approval: 'Aguardando orçamento',
  quote_approved: 'Orçamento aprovado',
  quote_rejected: 'Orçamento recusado',
  repair_in_progress: 'Em reparo',
  awaiting_calibration: 'Aguardando calibração',
  calibration_in_progress: 'Calibração em andamento',
  awaiting_final_review: 'Aguardando revisão',
  ready_for_pickup: 'Aguardando retirada',
  delivered: 'Entregue',
  closed: 'Encerrada',
  canceled: 'Cancelada',
  warranty_return: 'Retorno em garantia',
}

const statusVariants: Record<
  ServiceOrderStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  opened: 'secondary',
  awaiting_tech_evaluation: 'outline',
  under_evaluation: 'default',
  awaiting_quote_approval: 'outline',
  quote_approved: 'default',
  quote_rejected: 'destructive',
  repair_in_progress: 'default',
  awaiting_calibration: 'outline',
  calibration_in_progress: 'default',
  awaiting_final_review: 'outline',
  ready_for_pickup: 'default',
  delivered: 'secondary',
  closed: 'secondary',
  canceled: 'destructive',
  warranty_return: 'outline',
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString('pt-BR') : '-'
}

function money(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

function serviceOrderPath(order: ServiceOrderListItem) {
  return `/dashboard/service-orders/${order.id}`
}

function ServiceOrderDetailLink({
  order,
  className,
  linkProps,
  children,
}: {
  order: ServiceOrderListItem
  className?: string
  linkProps?: ComponentPropsWithoutRef<'a'>
  children: ReactNode
}) {
  const prewarmIntentHandlers = usePathPrewarmIntent(serviceOrderPath(order))

  return (
    <Link
      {...linkProps}
      to="/dashboard/service-orders/$id"
      params={{ id: String(order.id) }}
      className={className}
      preload="intent"
      {...prewarmIntentHandlers}
    >
      {children}
    </Link>
  )
}

const serviceOrderColumns: ColumnDef<ServiceOrderListItem>[] = [
  {
    accessorKey: 'serviceOrderNumber',
    header: 'OS',
    cell: ({ row }) => (
      <ServiceOrderDetailLink
        order={row.original}
        className="font-mono font-medium hover:underline"
      >
        {row.original.serviceOrderNumber}
      </ServiceOrderDetailLink>
    ),
  },
  {
    accessorKey: 'customerName',
    header: 'Cliente',
    cell: ({ row }) => row.original.customerName || '-',
  },
  {
    accessorKey: 'assetName',
    header: 'Instrumento',
    cell: ({ row }) => (
      <div>
        <span className="font-medium">{row.original.assetName}</span>
        {row.original.assetSerialNumber && (
          <span className="block text-xs text-muted-foreground">
            Série: {row.original.assetSerialNumber}
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'responsibleTechnicianName',
    header: 'Técnico',
    cell: ({ row }) =>
      row.original.responsibleTechnicianName || (
        <span className="text-muted-foreground italic">Não atribuído</span>
      ),
  },
  {
    accessorKey: 'openedAt',
    header: 'Entrada',
    cell: ({ row }) => formatDate(row.original.openedAt),
  },
  {
    accessorKey: 'totalQuotedCents',
    header: 'Valor',
    cell: ({ row }) =>
      money(row.original.totalApprovedCents || row.original.totalQuotedCents),
  },
  {
    accessorKey: 'unitName',
    header: 'Unidade',
    cell: ({ row }) => row.original.unitName || '-',
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = row.original.status as ServiceOrderStatus
      return (
        <Badge variant={statusVariants[status] ?? 'secondary'}>
          {row.original.statusLabel}
        </Badge>
      )
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
          <HugeiconsIcon icon={MoreHorizontalIcon} className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            render={(props) => (
              <ServiceOrderDetailLink
                order={row.original}
                linkProps={props}
                className={cn(props.className, 'w-full flex items-center')}
              >
                <HugeiconsIcon icon={ViewIcon} className="mr-2 h-4 w-4" />
                Ver detalhes
              </ServiceOrderDetailLink>
            )}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
]

function ServiceOrdersPage() {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ServiceOrderStatus | ''>('')
  const limit = 20

  const { data, isLoading, error } = useQuery({
    queryKey: ['service-orders', page, search, statusFilter],
    queryFn: async () => {
      const response = await api.api['service-orders'].$get({
        query: {
          query: search || undefined,
          status: statusFilter || undefined,
          page: String(page),
          limit: String(limit),
        },
      })
      if (!response.ok) throw new Error('Erro ao carregar ordens de serviço')
      return response.json() as Promise<{
        data: ServiceOrderListItem[]
        pagination: {
          page: number
          limit: number
          total: number
          totalPages: number
        }
      }>
    },
  })

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault()
    setPage(1)
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500">
            Erro ao carregar ordens de serviço: {error.message}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Ordens de Serviço</CardTitle>
            <CardDescription>
              Recebimento, avaliação, orçamento, execução e entrega de
              instrumentos
            </CardDescription>
          </div>
          <Button
            render={
              <Link to="/dashboard/service-orders/new">
                <HugeiconsIcon icon={PlusSignIcon} className="mr-2 h-4 w-4" />
                Nova OS
              </Link>
            }
          />
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex gap-4 mb-6">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por OS, cliente, instrumento ou série"
              className="max-w-xs"
            />
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value as ServiceOrderStatus | '')
                setPage(1)
              }}
            >
              <SelectTrigger className="w-56">
                <span>
                  {statusFilter ? statusLabels[statusFilter] : 'Todos'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos</SelectItem>
                {Object.entries(statusLabels).map(([status, label]) => (
                  <SelectItem key={status} value={status}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" variant="secondary">
              Buscar
            </Button>
          </form>

          {!isLoading && data?.data.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={ClipboardIcon} />
                </EmptyMedia>
                <EmptyTitle>Nenhuma ordem de serviço encontrada</EmptyTitle>
                <EmptyDescription>
                  {search || statusFilter
                    ? 'Nenhuma OS encontrada para os filtros aplicados.'
                    : 'As ordens de serviço abertas no recebimento aparecerão aqui.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {search || statusFilter ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch('')
                      setStatusFilter('')
                      setPage(1)
                    }}
                  >
                    Limpar filtros
                  </Button>
                ) : (
                  <Button render={<Link to="/dashboard/service-orders/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Nova OS
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          ) : (
            <DataTable
              columns={serviceOrderColumns}
              data={data?.data ?? []}
              isLoading={isLoading}
              pagination={data?.pagination}
              onPageChange={setPage}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
