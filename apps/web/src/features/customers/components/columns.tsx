import { type ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { SyncStateBadge } from '@/components/sync-state-badge'
import type { CustomerListItem } from '@/features/customers/types'

export type Client = CustomerListItem

export const clientsColumns: ColumnDef<Client>[] = [
  {
    accessorKey: 'name',
    header: 'Nome',
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.original.name}</span>
          <SyncStateBadge syncState={row.original.syncState} />
        </div>
        {row.original.tradeName && (
          <span className="text-xs text-muted-foreground">
            {row.original.tradeName}
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'taxId',
    header: 'CNPJ/CPF',
    cell: ({ row }) => row.original.taxId || '-',
  },
  {
    accessorKey: 'email',
    header: 'Email',
    cell: ({ row }) => row.original.email || '-',
  },
  {
    accessorKey: 'groupName',
    header: 'Grupo',
    cell: ({ row }) =>
      row.original.groupName ? (
        <Badge variant="outline">{row.original.groupName}</Badge>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    accessorKey: 'authOrganizationId',
    header: 'Portal',
    cell: ({ row }) =>
      row.original.authOrganizationId ? (
        <Badge variant="secondary">Vinculado</Badge>
      ) : (
        <Badge variant="outline">Não vinculado</Badge>
      ),
  },
]
