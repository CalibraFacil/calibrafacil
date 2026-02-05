import { type ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  MoreHorizontalIcon,
  ViewIcon,
} from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type NCType = 'work' | 'equipment' | 'documentation'
export type NCStatus = 'open' | 'under_review' | 'resolved'
export type NCDisposition = 'rework' | 'scrap' | 'use_as_is' | 'concession' | null

export interface NonConformanceRow {
  id: number
  ncNumber: string
  jobId: number | null
  type: NCType
  description: string
  detectedBy: string
  detectedByName: string | null
  detectedAt: string
  disposition: NCDisposition
  status: NCStatus
  capaId: number | null
  ageDays: number
  createdAt: string
}

function getStatusBadge(status: NCStatus) {
  switch (status) {
    case 'open':
      return { variant: 'destructive' as const, label: 'Aberta' }
    case 'under_review':
      return { variant: 'outline' as const, label: 'Em Analise', className: 'border-orange-500 text-orange-600' }
    case 'resolved':
      return { variant: 'default' as const, label: 'Resolvida' }
    default:
      return { variant: 'secondary' as const, label: status }
  }
}

function getTypeBadge(type: NCType) {
  switch (type) {
    case 'work':
      return { variant: 'outline' as const, label: 'Trabalho' }
    case 'equipment':
      return { variant: 'outline' as const, label: 'Equipamento' }
    case 'documentation':
      return { variant: 'outline' as const, label: 'Documentacao' }
    default:
      return { variant: 'secondary' as const, label: type }
  }
}

function getDispositionLabel(disposition: NCDisposition): string {
  if (!disposition) return '-'
  switch (disposition) {
    case 'rework':
      return 'Retrabalho'
    case 'scrap':
      return 'Sucata'
    case 'use_as_is':
      return 'Uso como esta'
    case 'concession':
      return 'Concessao'
    default:
      return disposition
  }
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('pt-BR')
}

export const ncColumns: ColumnDef<NonConformanceRow>[] = [
  {
    accessorKey: 'ncNumber',
    header: 'NC',
    cell: ({ row }) => (
      <Link
        to="/dashboard/nc/$id"
        params={{ id: String(row.original.id) }}
        className="font-mono font-medium hover:underline"
      >
        {row.original.ncNumber}
      </Link>
    ),
  },
  {
    accessorKey: 'type',
    header: 'Tipo',
    cell: ({ row }) => {
      const badge = getTypeBadge(row.original.type)
      return <Badge variant={badge.variant}>{badge.label}</Badge>
    },
  },
  {
    accessorKey: 'description',
    header: 'Descricao',
    cell: ({ row }) => (
      <span className="max-w-[300px] truncate block text-sm">
        {row.original.description}
      </span>
    ),
  },
  {
    accessorKey: 'detectedAt',
    header: 'Detectada em',
    cell: ({ row }) => (
      <div>
        <span className="text-sm">{formatDate(row.original.detectedAt)}</span>
        {row.original.detectedByName && (
          <p className="text-xs text-muted-foreground">
            por {row.original.detectedByName}
          </p>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'disposition',
    header: 'Disposicao',
    cell: ({ row }) => (
      <span className="text-sm">{getDispositionLabel(row.original.disposition)}</span>
    ),
  },
  {
    accessorKey: 'ageDays',
    header: 'Idade',
    cell: ({ row }) => {
      const days = row.original.ageDays
      const isOld = days > 30 && row.original.status !== 'resolved'
      return (
        <span className={cn('text-sm', isOld && 'text-destructive font-medium')}>
          {days}d
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
        <div className="flex items-center gap-2">
          <Badge
            variant={badge.variant}
            className={'className' in badge ? badge.className : undefined}
          >
            {badge.label}
          </Badge>
          {row.original.capaId && (
            <Badge variant="outline" className="border-blue-500 text-blue-600">
              CAPA
            </Badge>
          )}
        </div>
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
                to="/dashboard/nc/$id"
                params={{ id: String(row.original.id) }}
                className={cn(props.className, 'w-full flex items-center')}
              >
                <HugeiconsIcon icon={ViewIcon} className="mr-2 h-4 w-4" />
                Visualizar
              </Link>
            )}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
]
