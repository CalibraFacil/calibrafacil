import { type ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  MoreHorizontalIcon,
} from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { MaterialListItem } from '@/features/materials/types'
import { cn } from '@/lib/utils'
import { formatFinanceMoney } from '@/lib/finance-formatters'

export type Material = MaterialListItem

export interface MaterialsTableMeta {
  onDeactivate?: (id: number) => void
  onReactivate?: (id: number) => void
}

function formatMaterialMoney(valueInCents: number | null): string {
  if (valueInCents === null) {
    return 'Sob consulta'
  }

  return formatFinanceMoney(valueInCents, 'BRL')
}

export const materialsColumns: ColumnDef<Material>[] = [
  {
    accessorKey: 'name',
    header: 'Nome',
    cell: ({ row }) => (
      <div>
        <Link
          to="/dashboard/materials/$id/edit"
          params={{ id: String(row.original.id) }}
          className="font-medium hover:underline"
        >
          {row.original.name}
        </Link>
        {row.original.description && (
          <p className="text-sm text-muted-foreground truncate max-w-xs">
            {row.original.description}
          </p>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'sku',
    header: 'Código (SKU)',
    cell: ({ row }) =>
      row.original.sku || <span className="text-muted-foreground">-</span>,
  },
  {
    accessorKey: 'unit',
    header: 'Unidade',
    cell: ({ row }) => row.original.unit,
  },
  {
    accessorKey: 'unitCostCents',
    header: 'Custo',
    cell: ({ row }) => (
      <span className="font-mono">
        {formatMaterialMoney(row.original.unitCostCents)}
      </span>
    ),
  },
  {
    accessorKey: 'unitPriceCents',
    header: 'Preço',
    cell: ({ row }) => (
      <span className="font-mono">
        {formatMaterialMoney(row.original.unitPriceCents)}
      </span>
    ),
  },
  {
    accessorKey: 'controlsStock',
    header: 'Controla estoque',
    cell: ({ row }) => (
      <Badge variant={row.original.controlsStock ? 'default' : 'secondary'}>
        {row.original.controlsStock ? 'Sim' : 'Não'}
      </Badge>
    ),
  },
  {
    accessorKey: 'isActive',
    header: 'Status',
    cell: ({ row }) => (
      <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
        {row.original.isActive ? 'Ativo' : 'Inativo'}
      </Badge>
    ),
  },
  {
    id: 'actions',
    cell: ({ row, table }) => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- TanStack table meta is supplied by this table instance.
      const meta = table.options.meta as MaterialsTableMeta | undefined

      return (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
            <HugeiconsIcon icon={MoreHorizontalIcon} className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              render={(props) => (
                <Link
                  {...props}
                  to="/dashboard/materials/$id/edit"
                  params={{ id: String(row.original.id) }}
                  className={cn(props.className, 'w-full flex items-center')}
                >
                  <HugeiconsIcon icon={Edit02Icon} className="mr-2 h-4 w-4" />
                  Editar
                </Link>
              )}
            />
            <DropdownMenuSeparator />
            {row.original.isActive ? (
              <DropdownMenuItem
                onClick={() => meta?.onDeactivate?.(row.original.id)}
                className="text-destructive"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="mr-2 h-4 w-4" />
                Desativar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => meta?.onReactivate?.(row.original.id)}
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  className="mr-2 h-4 w-4"
                />
                Reativar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  },
]
