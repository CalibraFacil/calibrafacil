import { type ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { SyncStateBadge } from '@/components/sync-state-badge'
import type { AssetListItem, AssetStatus } from '@/features/assets/types'

export type Asset = AssetListItem

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

export interface AssetsTableMeta {
  onCustomerClick?: (customerId: number) => void
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
      const meta = table.options.meta as AssetsTableMeta | undefined
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
    cell: ({ row }) => (
      <Badge variant={statusVariants[row.original.status as AssetStatus]}>
        {statusLabels[row.original.status as AssetStatus]}
      </Badge>
    ),
  },
  {
    accessorKey: 'nextCalibrationDate',
    header: 'Próx. Calibração',
    cell: ({ row }) => formatDate(row.original.nextCalibrationDate),
  },
]
