import { type ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'

import { Badge } from '@/components/ui/badge'
import {
  PT_ACTIVITY_TYPE_LABELS,
  PT_STATUS_BADGE_CLASSES,
  PT_STATUS_LABELS,
  type PtRound,
} from '@/features/proficiency-tests/types'

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

export const ptColumns: ColumnDef<PtRound>[] = [
  {
    accessorKey: 'ptRound',
    header: 'Rodada',
    cell: ({ row }) => (
      <Link
        to="/dashboard/proficiency-tests/$id"
        params={{ id: String(row.original.id) }}
        className="font-medium text-primary hover:underline"
      >
        {row.original.ptRound}
      </Link>
    ),
  },
  {
    accessorKey: 'provider',
    header: 'Provedor',
    cell: ({ row }) => (
      <div className="max-w-[200px] truncate" title={row.original.provider}>
        {row.original.provider}
      </div>
    ),
  },
  {
    accessorKey: 'scopePart',
    header: 'Escopo',
    cell: ({ row }) => (
      <div className="max-w-[220px] truncate" title={row.original.scopePart}>
        {row.original.scopePart}
      </div>
    ),
  },
  {
    accessorKey: 'activityType',
    header: 'Atividade',
    cell: ({ row }) =>
      row.original.activityType === 'proficiency_test'
        ? 'EP'
        : PT_ACTIVITY_TYPE_LABELS[row.original.activityType],
  },
  {
    accessorKey: 'participationDate',
    header: 'Participação',
    cell: ({ row }) => formatDate(row.original.participationDate),
  },
  {
    accessorKey: 'overallStatus',
    header: 'Resultado',
    cell: ({ row }) => (
      <Badge
        variant="outline"
        className={PT_STATUS_BADGE_CLASSES[row.original.overallStatus]}
      >
        {PT_STATUS_LABELS[row.original.overallStatus]}
      </Badge>
    ),
  },
  {
    accessorKey: 'capaId',
    header: 'CAPA',
    cell: ({ row }) =>
      row.original.capaId ? (
        <Link
          to="/dashboard/capa/$id"
          params={{ id: String(row.original.capaId) }}
          className="font-medium text-primary hover:underline"
        >
          CAPA #{row.original.capaId}
        </Link>
      ) : (
        '-'
      ),
  },
]
