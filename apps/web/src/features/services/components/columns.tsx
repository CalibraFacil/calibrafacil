import { type ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  MoreHorizontalIcon,
  ViewIcon,
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
import type { ServiceListItem } from '@/features/services/types'
import { cn } from '@/lib/utils'
import { methodRouteId, serviceRouteId } from '@/lib/route-identifiers'

export type Service = ServiceListItem

export interface ServicesTableMeta {
  onDeactivate?: (id: number) => void
  onReactivate?: (id: number) => void
}

function formatPrice(priceInCents: number | null, currency: string): string {
  if (priceInCents === null) {
    return 'Sob consulta'
  }

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency || 'BRL',
  }).format(priceInCents / 100)
}

function formatTat(tat: number | null): string {
  if (tat === null) {
    return '-'
  }
  return `${tat} ${tat === 1 ? 'dia' : 'dias'}`
}

export const servicesColumns: ColumnDef<Service>[] = [
  {
    accessorKey: 'name',
    header: 'Nome',
    cell: ({ row }) => (
      <div>
        <Link
          to="/dashboard/services/$id"
          params={{ id: serviceRouteId(row.original) }}
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
    accessorKey: 'methodName',
    header: 'Método',
    cell: ({ row }) =>
      row.original.methodName ? (
        <Link
          to="/dashboard/methods/$id"
          params={{
            id: row.original.methodVersion
              ? methodRouteId({
                  name: row.original.methodName,
                  version: row.original.methodVersion,
                })
              : String(row.original.methodId),
          }}
          className="hover:underline text-primary"
        >
          {row.original.methodName}
        </Link>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    accessorKey: 'assetTypeName',
    header: 'Tipo de Instrumento',
    cell: ({ row }) =>
      row.original.assetTypeName || (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    accessorKey: 'price',
    header: 'Preço',
    cell: ({ row }) => (
      <span className="font-mono">
        {formatPrice(row.original.price, row.original.currency)}
      </span>
    ),
  },
  {
    accessorKey: 'tat',
    header: 'Prazo',
    cell: ({ row }) => formatTat(row.original.tat),
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
      const meta = table.options.meta as ServicesTableMeta | undefined

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
                  to="/dashboard/services/$id"
                  params={{ id: serviceRouteId(row.original) }}
                  className={cn(props.className, 'w-full flex items-center')}
                >
                  <HugeiconsIcon icon={ViewIcon} className="mr-2 h-4 w-4" />
                  Visualizar
                </Link>
              )}
            />
            <DropdownMenuItem
              render={(props) => (
                <Link
                  {...props}
                  to="/dashboard/services/$id/edit"
                  params={{ id: serviceRouteId(row.original) }}
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
