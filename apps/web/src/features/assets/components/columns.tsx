import { type ColumnDef } from '@tanstack/react-table'
import { Badge } from '@calibra-facil/ui/badge'
import { ASSET_STATUS } from '@calibra-facil/schemas/machines'
import { StatusBadge } from '@calibra-facil/ui/status-badge'
import { SyncStateBadge } from '@/components/sync-state-badge'
import type { AssetListItem } from '@/features/assets/types'
import { formatCalendarDate } from '@calibra-facil/shared/format'

export type Asset = AssetListItem

// The next calibration is a calendar date (a Postgres date): show its day.
export interface AssetsTableMeta {
  onCustomerClick?: (customerId: number) => void
}

function getAssetsTableMeta(meta: unknown): AssetsTableMeta | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null

  const onCustomerClick = Object.fromEntries(
    Object.entries(meta),
  ).onCustomerClick
  if (typeof onCustomerClick !== 'function') return null

  return { onCustomerClick }
}

export const assetsColumns: ColumnDef<Asset>[] = [
  {
    accessorKey: 'tag',
    header: 'Tag',
    cell: ({ row }) => (
      <span className="font-mono font-medium">{row.original.tag}</span>
    ),
  },
  {
    accessorKey: 'assetTypeName',
    header: 'Tipo',
    cell: ({ row }) => (
      <Badge variant="secondary">{row.original.assetTypeName}</Badge>
    ),
  },
  {
    accessorKey: 'name',
    header: 'Nome',
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span>{row.original.name}</span>
        <SyncStateBadge syncState={row.original.syncState} />
      </div>
    ),
  },
  {
    accessorKey: 'manufacturer',
    header: 'Fabricante',
    cell: ({ row }) => row.original.manufacturer || '-',
  },
  {
    accessorKey: 'serialNumber',
    header: 'N. Série',
    cell: ({ row }) => (
      <span className="font-mono">{row.original.serialNumber}</span>
    ),
  },
  {
    accessorKey: 'customerName',
    header: 'Cliente',
    cell: ({ row, table }) => {
      const meta = getAssetsTableMeta(table.options.meta)
      return (
        <Badge
          variant="outline"
          className="cursor-pointer hover:bg-accent"
          onClick={(e) => {
            e.stopPropagation()
            meta?.onCustomerClick?.(row.original.customerId)
          }}
        >
          {row.original.customerName}
        </Badge>
      )
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = ASSET_STATUS.parse(row.original.status) ?? 'ACTIVE'
      return (
        <StatusBadge tone={ASSET_STATUS.tone(status)}>
          {ASSET_STATUS.label(status)}
        </StatusBadge>
      )
    },
  },
  {
    accessorKey: 'nextCalibrationDate',
    header: 'Próx. Calibração',
    cell: ({ row }) =>
      formatCalendarDate(row.original.nextCalibrationDate, 'date'),
  },
]
