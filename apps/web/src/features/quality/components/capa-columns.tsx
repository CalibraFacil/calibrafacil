import { type ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import type { CapaRow } from '@/features/quality/types'

const statusLabels: Record<string, string> = {
  OPEN: 'Aberta',
  INVESTIGATION: 'Investigação',
  IMPLEMENTATION: 'Implementação',
  VERIFICATION: 'Verificação',
  CLOSED: 'Fechada',
}

const statusVariants: Record<string, string> = {
  OPEN: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  INVESTIGATION:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  IMPLEMENTATION:
    'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  VERIFICATION:
    'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  CLOSED: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
}

const severityLabels: Record<string, string> = {
  minor: 'Menor',
  major: 'Maior',
  critical: 'Crítica',
}

const severityVariants: Record<string, string> = {
  minor: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  major:
    'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

const sourceLabels: Record<string, string> = {
  internal_audit: 'Auditoria Interna',
  customer_complaint: 'Reclamação Cliente',
  nc_detection: 'Detecção NC',
  external_audit: 'Auditoria Externa',
  management_review: 'Revisão Gerencial',
}

const categoryLabels: Record<string, string> = {
  method: 'Método',
  equipment: 'Equipamento',
  personnel: 'Pessoal',
  procedure: 'Procedimento',
  environment: 'Ambiente',
  other: 'Outro',
}

export const capaColumns: ColumnDef<CapaRow>[] = [
  {
    accessorKey: 'capaNumber',
    header: 'CAPA',
    cell: ({ row }) => (
      <Link
        to="/dashboard/capa/$id"
        params={{ id: String(row.original.id) }}
        className="font-medium text-primary hover:underline"
      >
        {row.original.capaNumber}
      </Link>
    ),
  },
  {
    accessorKey: 'title',
    header: 'Título',
    cell: ({ row }) => (
      <div className="max-w-[200px] truncate" title={row.original.title}>
        {row.original.title}
      </div>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge
        variant="outline"
        className={statusVariants[row.original.status] ?? ''}
      >
        {statusLabels[row.original.status] ?? row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: 'severity',
    header: 'Severidade',
    cell: ({ row }) => (
      <Badge
        variant="outline"
        className={severityVariants[row.original.severity] ?? ''}
      >
        {severityLabels[row.original.severity] ?? row.original.severity}
      </Badge>
    ),
  },
  {
    accessorKey: 'category',
    header: 'Categoria',
    cell: ({ row }) =>
      categoryLabels[row.original.category] ?? row.original.category,
  },
  {
    accessorKey: 'source',
    header: 'Origem',
    cell: ({ row }) => sourceLabels[row.original.source] ?? row.original.source,
  },
  {
    accessorKey: 'responsibleName',
    header: 'Responsável',
    cell: ({ row }) => row.original.responsibleName ?? '-',
  },
  {
    accessorKey: 'dueDate',
    header: 'Prazo',
    cell: ({ row }) => {
      if (!row.original.dueDate) return '-'
      const date = new Date(row.original.dueDate)
      const formatted = date.toLocaleDateString('pt-BR')
      if (row.original.isOverdue) {
        return <span className="text-red-600 font-medium">{formatted}</span>
      }
      return formatted
    },
  },
  {
    accessorKey: 'ageDays',
    header: 'Idade',
    cell: ({ row }) => `${row.original.ageDays}d`,
  },
]
