import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { api } from '@/utils/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'

export const Route = createFileRoute('/dashboard/personnel/$id/audit')({
  head: () => ({
    meta: [{ title: 'Histórico | CalibraFacil' }],
  }),
  component: AuditTab,
})

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const actionLabels: Record<string, string> = {
  create: 'Competência criada',
  update: 'Dados atualizados',
  assign_training: 'Treinamento atribuído',
  start_training: 'Treinamento iniciado',
  complete_training: 'Treinamento concluído',
  approve: 'Competência aprovada',
  reject: 'Competência reprovada',
  suspend: 'Competência suspensa',
  renew: 'Competência renovada',
  expire: 'Competência expirada',
  delete: 'Competência removida',
}

function AuditTab() {
  const { id } = Route.useParams()

  const { data: logs, isLoading } = useQuery({
    queryKey: ['competence-audit', id],
    queryFn: async () => {
      const res = await api.api.competences[':id']['audit-log'].$get({
        param: { id },
      })
      if (!res.ok) throw new Error('Falha ao carregar histórico')
      return res.json() as Promise<
        Array<{
          id: number
          action: string
          changes: unknown
          performedBy: string
          performedByName: string
          performedAt: string
          reason: string | null
        }>
      >
    },
  })

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">Carregando...</p>
        </CardContent>
      </Card>
    )
  }

  const entries = logs ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico de Alterações</CardTitle>
        <CardDescription>
          Registro de auditoria - ISO 17025 Cláusula 8.4
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Nenhum registro</EmptyTitle>
              <EmptyDescription>
                O histórico de auditoria aparecerá aqui conforme ações forem
                realizadas.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-3">
            {entries.map((log) => (
              <div
                key={log.id}
                className="flex items-start justify-between border-b pb-3 last:border-b-0"
              >
                <div>
                  <p className="font-medium text-sm">
                    {actionLabels[log.action] ?? log.action}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    por {log.performedByName}
                  </p>
                  {log.reason && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {log.reason}
                    </p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDate(log.performedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
