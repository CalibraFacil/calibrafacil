import { queryOptions, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ColumnDef, ColumnFiltersState } from '@tanstack/react-table'

import { calibraApi } from '@/utils/api'
import { Money } from '@/features/finance/finance-display'
import {
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from '@/components/instrument-panel'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header'
import {
  FinanceDataTable,
  type FacetConfig,
} from '@/features/finance/components/finance-data-table'

type LeakageClass =
  | 'STUCK_READY_TO_BILL'
  | 'STUCK_SENT_TO_FINANCE'
  | 'STUCK_INVOICED'
  | 'LONG_OVERDUE'
  | 'BLOCKED_TOO_LONG'

const CLASS_ORDER: ReadonlyArray<LeakageClass> = [
  'LONG_OVERDUE',
  'STUCK_INVOICED',
  'STUCK_SENT_TO_FINANCE',
  'STUCK_READY_TO_BILL',
  'BLOCKED_TOO_LONG',
]

const CLASS_LABEL: Record<LeakageClass, string> = {
  STUCK_READY_TO_BILL: 'Pronto para faturar há muito tempo',
  STUCK_SENT_TO_FINANCE: 'Enviado ao financeiro sem fatura emitida',
  STUCK_INVOICED: 'Faturado sem recebimento',
  LONG_OVERDUE: 'Vencido há mais de 14 dias',
  BLOCKED_TOO_LONG: 'Bloqueado há mais de 7 dias',
}

const CLASS_TONE: Record<LeakageClass, SignalTone> = {
  STUCK_READY_TO_BILL: 'info',
  STUCK_SENT_TO_FINANCE: 'warning',
  STUCK_INVOICED: 'warning',
  LONG_OVERDUE: 'critical',
  BLOCKED_TOO_LONG: 'warning',
}

interface AlertItem {
  serviceOrderId: number
  /** Opaque id the OS link routes with. */
  serviceOrderPublicId: string
  serviceOrderNumber: string
  customer: { id: number; name: string }
  unit: { id: number; name: string }
  amountCents: number
  currency: string
  classes: LeakageClass[]
  ageInDays: number | null
}

interface RevenueLeakageEnvelope {
  summary: {
    classes: Record<LeakageClass, { count: number; totalCents: number }>
    totalAlerts: number
  }
  alerts: AlertItem[]
}

const LEAKAGE_FACETS: FacetConfig[] = [
  {
    columnId: 'classes',
    title: 'Tipo',
    options: CLASS_ORDER.map((value) => ({ value, label: CLASS_LABEL[value] })),
  },
]

const alertColumns: ColumnDef<AlertItem, unknown>[] = [
  {
    id: 'order',
    accessorFn: (row) => `${row.serviceOrderNumber} ${row.customer.name}`,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="OS / Cliente" />
    ),
    enableHiding: false,
    cell: ({ row }) => (
      <Link
        to="/dashboard/service-orders/$publicId"
        params={{ publicId: row.original.serviceOrderPublicId }}
        className="font-medium hover:underline"
      >
        {row.original.serviceOrderNumber} · {row.original.customer.name}
      </Link>
    ),
  },
  {
    id: 'classes',
    accessorFn: (row) => row.classes,
    header: 'Alertas',
    filterFn: 'arrIncludesSome',
    enableSorting: false,
    meta: { label: 'Alertas' },
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.classes.map((cls) => (
          <Badge
            key={cls}
            variant="outline"
            className={
              cls === 'LONG_OVERDUE'
                ? 'border-destructive/40 text-destructive'
                : undefined
            }
          >
            {CLASS_LABEL[cls]}
          </Badge>
        ))}
      </div>
    ),
  },
  {
    id: 'age',
    accessorFn: (row) => row.ageInDays ?? -1,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Idade" />
    ),
    meta: { label: 'Idade' },
    cell: ({ row }) =>
      row.original.ageInDays !== null ? (
        <span className="text-xs text-muted-foreground">
          Há {row.original.ageInDays} dias na etapa atual
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
  },
  {
    id: 'amount',
    accessorFn: (row) => row.amountCents,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Valor" />
    ),
    meta: { label: 'Valor' },
    cell: ({ row }) => (
      <div className="text-right">
        <Money
          cents={row.original.amountCents}
          currency={row.original.currency}
        />
      </div>
    ),
  },
]

function revenueLeakageQueryOptions() {
  return queryOptions<RevenueLeakageEnvelope>({
    queryKey: ['finance', 'revenue-leakage'],
    queryFn: () =>
      calibraApi.finance.getRevenueLeakage<RevenueLeakageEnvelope>(),
  })
}

export function RevenueLeakagePage({
  classFilter,
}: {
  classFilter?: string
} = {}) {
  const { data, isLoading, error } = useQuery(revenueLeakageQueryOptions())

  if (error) {
    return (
      <Panel className="flex items-center gap-3 p-5 text-sm text-destructive">
        <HugeiconsIcon icon={AlertCircleIcon} className="size-5" />
        Não foi possível carregar os alertas.
      </Panel>
    )
  }

  const alerts = data?.alerts ?? []
  const initialFilters: ColumnFiltersState = classFilter
    ? [{ id: 'classes', value: [classFilter] }]
    : []

  return (
    <StaggerGroup className="space-y-6">
      <StaggerItem>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {CLASS_ORDER.map((cls) => {
            const bucket = data?.summary.classes[cls]
            const count = bucket?.count ?? 0
            return (
              <Link
                key={cls}
                to="/dashboard/finance/revenue-leakage"
                search={{ class: cls }}
                className="group block rounded-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <SignalTile
                  tone={count > 0 ? CLASS_TONE[cls] : 'neutral'}
                  label={CLASS_LABEL[cls]}
                  value={count}
                />
              </Link>
            )
          })}
        </div>
      </StaggerItem>

      <StaggerItem>
        <Panel className="p-5 sm:p-6">
          <PanelHeader
            title="Alertas de vazamento"
            description="Ordens paradas em alguma etapa por mais tempo do que o esperado."
          />
          <div className="mt-4">
            <FinanceDataTable
              key={`leak:${classFilter ?? ''}`}
              columns={alertColumns}
              data={alerts}
              isLoading={isLoading}
              getRowId={(row) => String(row.serviceOrderId)}
              searchPlaceholder="Buscar por OS ou cliente"
              facets={LEAKAGE_FACETS}
              initialColumnFilters={initialFilters}
              initialSorting={[{ id: 'age', desc: true }]}
              emptyState="Nenhum alerta de vazamento no momento."
            />
          </div>
        </Panel>
      </StaggerItem>
    </StaggerGroup>
  )
}
