import { Link } from '@tanstack/react-router'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
} from 'nuqs'
import { type ColumnDef } from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ClipboardIcon,
  MoreHorizontalIcon,
  PlusSignIcon,
  ViewIcon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { SyncStateBadge } from '@/components/sync-state-badge'
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
import { useDashboardContextState } from '@/contexts/dashboard-context'
import {
  SERVICE_ORDERS_LIST_LIMIT,
  useServiceOrdersListData,
} from '@/features/service-orders/queries'
import {
  SERVICE_ORDER_STATUSES,
  type ServiceOrderListItem,
  type ServiceOrderStatus,
} from '@/features/service-orders/types'
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

function parseServiceOrderStatus(value: string | null): ServiceOrderStatus | '' {
  switch (value) {
    case 'opened':
    case 'awaiting_tech_evaluation':
    case 'under_evaluation':
    case 'awaiting_quote_approval':
    case 'quote_approved':
    case 'quote_rejected':
    case 'repair_in_progress':
    case 'awaiting_calibration':
    case 'calibration_in_progress':
    case 'awaiting_final_review':
    case 'ready_for_pickup':
    case 'delivered':
    case 'closed':
    case 'canceled':
    case 'warranty_return':
      return value
    default:
      return ''
  }
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
      const status = parseServiceOrderStatus(row.original.status) || 'opened'
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariants[status] ?? 'secondary'}>
            {row.original.statusLabel}
          </Badge>
          <SyncStateBadge syncState={row.original.syncState} />
        </div>
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

export function ServiceOrdersPage() {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useQueryState(
    'query',
    parseAsString.withDefault(''),
  )
  const [statusFilter, setStatusFilter] = useQueryState(
    'status',
    parseAsStringLiteral([...SERVICE_ORDER_STATUSES, '']).withDefault(''),
  )

  const { data, isLoading, error } = useServiceOrdersListData({
    activeOrganizationId,
    enabled: Boolean(activeOrganizationId) && !isContextSwitching,
    page,
    limit: SERVICE_ORDERS_LIST_LIMIT,
    search,
    statusFilter,
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
                setStatusFilter(parseServiceOrderStatus(value))
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
