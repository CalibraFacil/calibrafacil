import { queryOptions, useQuery } from '@tanstack/react-query'
import { AlertCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ColumnDef } from '@tanstack/react-table'

import { calibraApi } from '@/utils/api'
import { Money } from '@/features/finance/finance-display'
import {
  Panel,
  PanelHeader,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header'
import { FinanceDataTable } from '@/features/finance/components/finance-data-table'

interface MarginRow {
  entityId: number
  entityName: string
  revenueCents: number
  outsourcedCostCents: number
  marginCents: number
  marginPercent: number | null
  serviceOrderCount: number
}

interface MarginEnvelope {
  byCustomer: MarginRow[]
  byService: MarginRow[]
}

const PERCENT_FORMAT = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})

function formatPercent(value: number | null) {
  if (value === null) return '—'
  return PERCENT_FORMAT.format(value / 100)
}

function marginTone(cents: number) {
  if (cents < 0) return 'critical' as const
  if (cents > 0) return 'ok' as const
  return 'neutral' as const
}

const marginColumns: ColumnDef<MarginRow, unknown>[] = [
  {
    accessorKey: 'entityName',
    id: 'entityName',
    header: 'Nome',
    enableHiding: false,
    cell: ({ row }) => (
      <span className="font-medium">{row.original.entityName}</span>
    ),
  },
  {
    accessorKey: 'revenueCents',
    id: 'revenueCents',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Receita" />
    ),
    meta: { label: 'Receita' },
    cell: ({ row }) => (
      <div className="text-right">
        <Money cents={row.original.revenueCents} />
      </div>
    ),
  },
  {
    accessorKey: 'outsourcedCostCents',
    id: 'outsourcedCostCents',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Custo" />
    ),
    meta: { label: 'Custo' },
    cell: ({ row }) => (
      <div className="text-right">
        <Money cents={row.original.outsourcedCostCents} muted />
      </div>
    ),
  },
  {
    accessorKey: 'marginCents',
    id: 'marginCents',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Margem" />
    ),
    meta: { label: 'Margem' },
    cell: ({ row }) => (
      <div className="text-right">
        <Money
          cents={row.original.marginCents}
          tone={marginTone(row.original.marginCents)}
        />
      </div>
    ),
  },
  {
    accessorKey: 'marginPercent',
    id: 'marginPercent',
    header: ({ column }) => <DataTableColumnHeader column={column} title="%" />,
    meta: { label: '%' },
    cell: ({ row }) => (
      <div className="text-right font-mono tabular-nums text-muted-foreground">
        {formatPercent(row.original.marginPercent)}
      </div>
    ),
  },
  {
    accessorKey: 'serviceOrderCount',
    id: 'serviceOrderCount',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="OS" />
    ),
    meta: { label: 'OS' },
    cell: ({ row }) => (
      <div className="text-right font-mono tabular-nums">
        {row.original.serviceOrderCount}
      </div>
    ),
  },
]

function marginDashboardsQueryOptions() {
  return queryOptions<MarginEnvelope>({
    queryKey: ['finance', 'margin-dashboards'],
    queryFn: () => calibraApi.finance.getMarginDashboards<MarginEnvelope>(),
  })
}

export function MarginDashboardsPage() {
  const { data, isLoading, error } = useQuery(marginDashboardsQueryOptions())

  if (error) {
    return (
      <Panel className="flex items-center gap-3 p-5 text-sm text-destructive">
        <HugeiconsIcon icon={AlertCircleIcon} className="size-5" />
        Não foi possível carregar o painel de margens.
      </Panel>
    )
  }

  return (
    <StaggerGroup className="space-y-6">
      <StaggerItem>
        <Panel className="p-5 sm:p-6">
          <PanelHeader
            eyebrow="Rentabilidade"
            title="Margem por cliente"
            description="Receita vs. custo terceirizado; margem efetiva quando conciliada."
          />
          <div className="mt-4">
            <FinanceDataTable
              columns={marginColumns}
              data={data?.byCustomer ?? []}
              isLoading={isLoading}
              getRowId={(row) => String(row.entityId)}
              searchPlaceholder="Buscar por cliente"
              initialSorting={[{ id: 'marginCents', desc: true }]}
              emptyState="Sem dados de margem ainda."
            />
          </div>
        </Panel>
      </StaggerItem>
    </StaggerGroup>
  )
}
