import { type ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { MoreHorizontalIcon, ViewIcon } from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type {
  CompetenceRow,
  CompetenceStatus,
} from '@/features/personnel/types'

const statusConfig: Record<
  CompetenceStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
    className?: string
  }
> = {
  REQUESTED: {
    label: 'Solicitada',
    variant: 'outline',
    className: 'border-blue-500 text-blue-600',
  },
  TRAINING_ASSIGNED: {
    label: 'Treinamento Atribuído',
    variant: 'outline',
    className: 'border-amber-500 text-amber-600',
  },
  IN_TRAINING: {
    label: 'Em Treinamento',
    variant: 'outline',
    className: 'border-yellow-500 text-yellow-600',
  },
  PENDING_EVALUATION: {
    label: 'Aguardando Avaliação',
    variant: 'outline',
    className: 'border-purple-500 text-purple-600',
  },
  ACTIVE: { label: 'Ativa', variant: 'default' },
  SUSPENDED: { label: 'Suspensa', variant: 'destructive' },
  EXPIRED: { label: 'Expirada', variant: 'destructive' },
  CANCELLED: { label: 'Cancelada', variant: 'secondary' },
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR')
}

export function getStatusBadge(status: CompetenceStatus) {
  return (
    statusConfig[status] ?? { label: status, variant: 'secondary' as const }
  )
}

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
      <span className="text-sm">{formatDate(row.original.qualifiedAt)}</span>
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
          {formatDate(expiresAt)}
        </span>
      )
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const badge = getStatusBadge(row.original.status)
      return (
        <Badge variant={badge.variant} className={badge.className}>
          {badge.label}
        </Badge>
      )
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
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
