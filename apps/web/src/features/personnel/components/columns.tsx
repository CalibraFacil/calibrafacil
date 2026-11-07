import { type ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { MoreHorizontalIcon, ViewIcon } from '@hugeicons/core-free-icons'

import { Button } from '@calibra-facil/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@calibra-facil/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { CompetenceRow } from '@/features/personnel/types'
import { CompetenceStatusBadge } from '@/features/personnel/components/status-badges'
import { formatInstant } from '@calibra-facil/shared/format'

export const competenceColumns: ColumnDef<CompetenceRow>[] = [
  {
    accessorKey: 'userName',
    header: 'Técnico',
    cell: ({ row }) => (
      <Link
        to="/dashboard/personnel/$id"
        params={{ id: String(row.original.id) }}
        className="font-medium hover:underline"
      >
        {row.original.userName}
      </Link>
    ),
  },
  {
    accessorKey: 'assetTypeName',
    header: 'Tipo de Instrumento',
    cell: ({ row }) => (
      <span className="text-sm">{row.original.assetTypeName || 'Geral'}</span>
    ),
  },
  {
    accessorKey: 'scopeDescription',
    header: 'Escopo',
    cell: ({ row }) => (
      <span className="max-w-[250px] truncate block text-sm">
        {row.original.scopeDescription}
      </span>
    ),
  },
  {
    accessorKey: 'qualifiedAt',
    header: 'Qualificado em',
    cell: ({ row }) => (
      <span className="text-sm">
        {formatInstant(row.original.qualifiedAt, 'date')}
      </span>
    ),
  },
  {
    accessorKey: 'expiresAt',
    header: 'Expira em',
    cell: ({ row }) => {
      const expiresAt = row.original.expiresAt
      if (!expiresAt)
        return <span className="text-sm text-muted-foreground">-</span>
      const isExpiringSoon =
        new Date(expiresAt).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000 &&
        row.original.status === 'ACTIVE'
      return (
        <span
          className={cn(
            'text-sm',
            isExpiringSoon && 'text-destructive font-medium',
          )}
        >
          {formatInstant(expiresAt, 'date')}
        </span>
      )
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      return <CompetenceStatusBadge status={row.original.status} />
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Mais ações" />
          }
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            render={(props) => (
              <Link
                {...props}
                to="/dashboard/personnel/$id"
                params={{ id: String(row.original.id) }}
                className={cn(props.className, 'w-full flex items-center')}
              >
                <HugeiconsIcon icon={ViewIcon} className="mr-2 h-4 w-4" />
                Ver Detalhes
              </Link>
            )}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
]
