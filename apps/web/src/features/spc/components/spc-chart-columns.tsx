import { type ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'

import { SPC_CHART_TYPE_LABELS, type SpcChart } from '@/features/spc/types'
import { SpcStatusBadge } from '@/features/spc/components/spc-status-badge'

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('pt-BR')
}

export const spcChartColumns: ColumnDef<SpcChart>[] = [
  {
    accessorKey: 'standardName',
    header: 'Padrão',
    cell: ({ row }) => (
      <Link
        to="/dashboard/spc/$id"
        params={{ id: String(row.original.id) }}
        className="font-medium text-primary hover:underline"
      >
        {row.original.standardName ?? `Padrão #${row.original.standardId}`}
      </Link>
    ),
  },
  {
    accessorKey: 'parameter',
    header: 'Parâmetro',
    cell: ({ row }) => (
      <div className="max-w-[220px] truncate" title={row.original.parameter}>
        {row.original.parameter}
      </div>
    ),
  },
  {
    accessorKey: 'chartType',
    header: 'Tipo de carta',
    cell: ({ row }) => SPC_CHART_TYPE_LABELS[row.original.chartType],
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <SpcStatusBadge status={row.original.status} />,
  },
  {
    id: 'sampleSize',
    header: 'Amostras',
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">
        {row.original.lastEvaluation?.sampleSize ?? 0}
      </span>
    ),
  },
  {
    accessorKey: 'lastEvaluatedAt',
    header: 'Última avaliação',
    cell: ({ row }) => formatDateTime(row.original.lastEvaluatedAt),
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
