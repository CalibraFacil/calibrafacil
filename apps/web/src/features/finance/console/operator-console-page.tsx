import { Link, useNavigate } from '@tanstack/react-router'
import { AlertCircleIcon, Invoice02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ColumnDef } from '@tanstack/react-table'
import { getBillingDocumentStatusLabel } from '@calibra-facil/shared'

import {
  BillingDocumentStatusBadge,
  ExportStatusBadge,
} from '@/components/finance-status-badges'
import { formatFinanceDate } from '@/lib/finance-formatters'
import {
  Money,
  billingDocumentToneOf,
} from '@/features/finance/finance-display'
import {
  BlueprintField,
  BlueprintGrid,
  Panel,
  PanelHeader,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from '@/components/instrument-panel'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header'
import {
  FinanceDataTable,
  type FacetConfig,
} from '@/features/finance/components/finance-data-table'
import { useFinanceOverviewData } from '@/features/finance/queries'
import { ConsoleVitals } from '@/features/finance/console/console-vitals'
import type { FinanceOverviewResponse } from '@/features/finance/types'

type RecentDocument = FinanceOverviewResponse['recentDocuments'][number]

const AGING_BUCKETS: Array<{ key: string; label: string; tone: SignalTone }> = [
  { key: '0_30', label: '0–30 dias', tone: 'neutral' },
  { key: '31_60', label: '31–60 dias', tone: 'warning' },
  { key: '61_90', label: '61–90 dias', tone: 'warning' },
  { key: '90_plus', label: 'Acima de 90 dias', tone: 'critical' },
]

const RECENT_FACETS: FacetConfig[] = [
  {
    columnId: 'status',
    title: 'Status',
    options: (['DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID'] as const).map(
      (value) => ({ value, label: getBillingDocumentStatusLabel(value) }),
    ),
  },
  {
    columnId: 'exportStatus',
    title: 'Exportação',
    options: [
      { value: 'NOT_EXPORTED', label: 'Não exportado' },
      { value: 'PENDING', label: 'Pendente' },
      { value: 'EXPORTED', label: 'Exportado' },
      { value: 'FAILED', label: 'Falhou' },
    ],
  },
]

const recentDocumentColumns: ColumnDef<RecentDocument, unknown>[] = [
  {
    accessorKey: 'documentNumber',
    id: 'documentNumber',
    header: 'Documento',
    enableHiding: false,
    cell: ({ row }) => (
      <div>
        <Link
          to="/dashboard/finance/documents/$id"
          params={{ id: row.original.publicId }}
          className="font-medium hover:underline"
        >
          {row.original.documentNumber ?? `Rascunho #${row.original.id}`}
        </Link>
        <div className="text-xs text-muted-foreground">
          {row.original.unitName}
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'customerName',
    id: 'customerName',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Cliente" />
    ),
    meta: { label: 'Cliente' },
  },
  {
    accessorKey: 'status',
    id: 'status',
    header: 'Status',
    filterFn: 'arrIncludesSome',
    meta: { label: 'Status' },
    cell: ({ row }) => (
      <BillingDocumentStatusBadge status={row.original.status} />
    ),
  },
  {
    accessorKey: 'exportStatus',
    id: 'exportStatus',
    header: 'Exportação',
    filterFn: 'arrIncludesSome',
    meta: { label: 'Exportação' },
    cell: ({ row }) => <ExportStatusBadge status={row.original.exportStatus} />,
  },
  {
    accessorKey: 'dueDate',
    id: 'dueDate',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Vencimento" />
    ),
    meta: { label: 'Vencimento' },
    cell: ({ row }) => formatFinanceDate(row.original.dueDate),
  },
  {
    accessorKey: 'totalCents',
    id: 'totalCents',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Valor" />
    ),
    meta: { label: 'Valor' },
    cell: ({ row }) => (
      <div className="text-right">
        <Money
          cents={row.original.totalCents}
          tone={billingDocumentToneOf(row.original.status)}
        />
      </div>
    ),
  },
]

export function FinanceOperatorConsolePage() {
  const navigate = useNavigate()
  const overviewQuery = useFinanceOverviewData()

  if (overviewQuery.isError) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={AlertCircleIcon} />
          </EmptyMedia>
          <EmptyTitle>Falha ao carregar o painel financeiro</EmptyTitle>
          <EmptyDescription>
            Tente novamente para consultar a operação financeira.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const data = overviewQuery.data
  const recentDocuments = data?.recentDocuments ?? []

  return (
    <StaggerGroup className="space-y-6">
      <StaggerItem>
        <ConsoleVitals data={data} />
      </StaggerItem>

      <StaggerItem>
        <Panel className="p-5 sm:p-6">
          <PanelHeader
            title="Envelhecimento"
            description="Saldo vencido distribuído por faixa de atraso."
          />
          <div className="mt-4">
            {overviewQuery.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <BlueprintGrid className="grid-cols-2 lg:grid-cols-4">
                {AGING_BUCKETS.map((bucket) => {
                  const value = data?.aging[bucket.key] ?? 0
                  const tone: SignalTone = value > 0 ? bucket.tone : 'neutral'
                  return (
                    <BlueprintField key={bucket.key} label={bucket.label} mono>
                      <Money cents={value} tone={tone} muted={value === 0} />
                    </BlueprintField>
                  )
                })}
              </BlueprintGrid>
            )}
          </div>
        </Panel>
      </StaggerItem>

      <StaggerItem>
        <Panel className="p-5 sm:p-6">
          <PanelHeader
            title="Documentos recentes"
            description="Últimas cobranças emitidas ou em preparação."
            action={
              <Button
                variant="outline"
                size="sm"
                render={<Link to="/dashboard/finance/receivables" />}
              >
                <HugeiconsIcon icon={Invoice02Icon} className="mr-2 size-4" />
                Ver recebíveis
              </Button>
            }
          />
          <div className="mt-4">
            <FinanceDataTable
              columns={recentDocumentColumns}
              data={recentDocuments}
              isLoading={overviewQuery.isPending}
              getRowId={(row) => String(row.id)}
              searchPlaceholder="Buscar por cliente ou número"
              facets={RECENT_FACETS}
              initialSorting={[{ id: 'dueDate', desc: true }]}
              pageSize={8}
              onRowClick={(row) =>
                navigate({
                  to: '/dashboard/finance/documents/$id',
                  params: { id: row.publicId },
                })
              }
              emptyState="Nenhum documento ainda."
            />
          </div>
        </Panel>
      </StaggerItem>
    </StaggerGroup>
  )
}
