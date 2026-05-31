import { Link } from '@tanstack/react-router'
import { CloudIcon, SentIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { toast } from 'sonner'
import type { ColumnDef, ColumnFiltersState } from '@tanstack/react-table'

import {
  BillingDocumentStatusBadge,
  ExportStatusBadge,
} from '@/components/finance-status-badges'
import { formatFinanceDate, formatFinanceMoney } from '@/lib/finance-formatters'
import { Money, exportStatusToneOf } from '@/features/finance/finance-display'
import {
  InfoHint,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header'
import {
  FinanceDataTable,
  type FacetConfig,
} from '@/features/finance/components/finance-data-table'
import { useFinanceErpData } from '@/features/finance/queries'
import { useExportErpDocumentMutation } from '@/features/finance/mutations'
import type { ErpExportsResponse } from '@/features/finance/types'

type ErpRow = ErpExportsResponse['data'][number]

const PENDING_STATES = new Set(['NOT_EXPORTED', 'PENDING'])

const EXPORT_FACETS: FacetConfig[] = [
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

function makeErpColumns({
  onExport,
  hasIntegration,
  exporting,
}: {
  onExport: (id: number) => void
  hasIntegration: boolean
  exporting: boolean
}): ColumnDef<ErpRow, unknown>[] {
  return [
    {
      accessorKey: 'documentNumber',
      id: 'documentNumber',
      header: 'Documento',
      enableHiding: false,
      cell: ({ row }) => (
        <div>
          {row.original.documentNumber ?? `Documento #${row.original.id}`}
          <div className="text-xs text-muted-foreground">
            emissão {formatFinanceDate(row.original.issueDate)}
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
      cell: ({ row }) => {
        const isFailed = row.original.exportStatus === 'FAILED'
        return (
          <div>
            <ExportStatusBadge status={row.original.exportStatus} />
            <div className="text-xs text-muted-foreground">
              {isFailed
                ? 'falha no último envio — reenviar'
                : row.original.exportedAt
                  ? `enviado em ${formatFinanceDate(row.original.exportedAt)}`
                  : 'ainda não enviado'}
            </div>
          </div>
        )
      },
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
            currency={row.original.currency}
            tone={exportStatusToneOf(row.original.exportStatus)}
          />
        </div>
      ),
    },
    {
      id: 'action',
      header: '',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const isFailed = row.original.exportStatus === 'FAILED'
        return (
          <div className="text-right">
            <Button
              variant={isFailed ? 'default' : 'outline'}
              size="sm"
              disabled={exporting || !hasIntegration}
              title={
                hasIntegration ? undefined : 'Requer integração financeira ativa'
              }
              onClick={() => onExport(row.original.id)}
            >
              {row.original.exportStatus === 'EXPORTED' ? 'Reenviar' : 'Exportar'}
            </Button>
          </div>
        )
      },
    },
  ]
}

const ERP_TILE_LINK_CLASS =
  'group block rounded-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

export function FinanceErpPage({ exportFilter }: { exportFilter?: string }) {
  const exportsQuery = useFinanceErpData()
  const exportMutation = useExportErpDocumentMutation()

  const billing = exportsQuery.data?.billing
  const hasIntegration = billing?.hasFinancialIntegrations ?? false
  const rows = exportsQuery.data?.data ?? []

  const pending = rows.filter((row) => PENDING_STATES.has(row.exportStatus))
  const exported = rows.filter((row) => row.exportStatus === 'EXPORTED')
  const failed = rows.filter((row) => row.exportStatus === 'FAILED')
  const pendingCents = pending.reduce((sum, row) => sum + row.totalCents, 0)
  const retryableIds = [...failed, ...pending].map((row) => row.id)
  const exportFilters: ColumnFiltersState = exportFilter
    ? [{ id: 'exportStatus', value: [exportFilter] }]
    : []

  async function exportMany(ids: number[], clear?: () => void) {
    if (ids.length === 0) return
    const results = await Promise.allSettled(
      ids.map((id) => exportMutation.mutateAsync(id)),
    )
    const ok = results.filter((result) => result.status === 'fulfilled').length
    if (ok > 0) toast.success(`Exportados para o ERP: ${ok} de ${ids.length}`)
    clear?.()
  }

  const columns = makeErpColumns({
    hasIntegration,
    exporting: exportMutation.isPending,
    onExport: (id) =>
      exportMutation.mutate(id, {
        onSuccess: () => toast.success('Exportação ERP concluída'),
      }),
  })

  return (
    <StaggerGroup className="space-y-6">
      <StaggerItem>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            to="/dashboard/finance/erp"
            search={{ export: 'NOT_EXPORTED' }}
            className={ERP_TILE_LINK_CLASS}
          >
            <SignalTile
              icon={SentIcon}
              label="A exportar"
              value={formatFinanceMoney(pendingCents)}
              hint={`${pending.length} doc`}
              tone={pending.length > 0 ? 'info' : 'neutral'}
            />
          </Link>
          <Link
            to="/dashboard/finance/erp"
            search={{ export: 'EXPORTED' }}
            className={ERP_TILE_LINK_CLASS}
          >
            <SignalTile label="Exportados" value={exported.length} tone="ok" />
          </Link>
          <Link
            to="/dashboard/finance/erp"
            search={{ export: 'FAILED' }}
            className={ERP_TILE_LINK_CLASS}
          >
            <SignalTile
              label="Falhas"
              value={failed.length}
              tone={failed.length > 0 ? 'critical' : 'neutral'}
            />
          </Link>
        </div>
      </StaggerItem>

      <StaggerItem>
        <Panel className="p-5 sm:p-6">
          <PanelHeader
            eyebrow="Integração ERP"
            title={
              <span className="inline-flex items-center gap-1.5">
                Fila de exportação
                {!hasIntegration ? (
                  <InfoHint>
                    O reenvio para o ERP exige uma integração financeira ativa
                    no plano {billing?.planName ?? 'atual'}.
                  </InfoHint>
                ) : null}
              </span>
            }
            description="Documentos emitidos enviados à integração financeira."
            action={
              hasIntegration && retryableIds.length > 0 ? (
                <Button
                  size="sm"
                  disabled={exportMutation.isPending}
                  onClick={() => void exportMany(retryableIds)}
                >
                  <HugeiconsIcon icon={CloudIcon} className="mr-2 size-4" />
                  Reenviar pendentes ({retryableIds.length})
                </Button>
              ) : null
            }
          />
          <div className="mt-4">
            <FinanceDataTable
              key={`erp:${exportFilter ?? ''}`}
              columns={columns}
              data={rows}
              isLoading={exportsQuery.isPending}
              getRowId={(row) => String(row.id)}
              searchPlaceholder="Buscar por cliente ou número"
              facets={EXPORT_FACETS}
              initialColumnFilters={exportFilters}
              enableRowSelection={hasIntegration}
              emptyState="Nada na fila de exportação."
              bulkActions={(selected, clear) => {
                const ids = selected
                  .filter((row) => row.exportStatus !== 'EXPORTED')
                  .map((row) => row.id)
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={ids.length === 0 || exportMutation.isPending}
                    onClick={() => void exportMany(ids, clear)}
                  >
                    <HugeiconsIcon icon={SentIcon} className="mr-2 size-4" />
                    Exportar ({ids.length})
                  </Button>
                )
              }}
            />
          </div>
        </Panel>
      </StaggerItem>
    </StaggerGroup>
  )
}
