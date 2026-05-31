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
      <div className="flex items-center gap-2">
        <span className="font-medium">{row.original.name}</span>
        <SyncStateBadge syncState={row.original.syncState} />
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
