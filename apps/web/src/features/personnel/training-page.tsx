import { useCompetenceDetailData } from '@/features/personnel/queries'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { getStatusBadge } from '@/features/personnel/components/columns'

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR')
}

const typeLabels: Record<string, string> = {
  internal: 'Interno',
  external: 'Externo',
  ojt: 'Em Serviço',
  proficiency_test: 'Teste de Proficiência',
}

const statusLabels: Record<string, string> = {
  planned: 'Planejado',
  in_progress: 'Em Andamento',
  completed: 'Concluído',
  failed: 'Reprovado',
}

const statusVariants: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  planned: 'outline',
  in_progress: 'secondary',
  completed: 'default',
  failed: 'destructive',
}

export function TrainingTab({ id }: { id: string }) {
  const { data: comp, isLoading } = useCompetenceDetailData(id)

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">Carregando...</p>
        </CardContent>
      </Card>
    )
  }

  const trainings = comp?.trainingRecords ?? []
  const competenceBadge = comp ? getStatusBadge(comp.status) : null

  if (trainings.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Registros de Treinamento</CardTitle>
          <CardDescription>
            Treinamentos vinculados a esta competência.
            {competenceBadge
              ? ` Competência atual: ${competenceBadge.label}.`
              : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Nenhum treinamento registrado</EmptyTitle>
              <EmptyDescription>
                Registros de treinamento podem ser adicionados e vinculados a
                esta competência.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registros de Treinamento</CardTitle>
        <CardDescription>
          {trainings.length} treinamento{trainings.length !== 1 ? 's' : ''}{' '}
          vinculado{trainings.length !== 1 ? 's' : ''}.
          {competenceBadge
            ? ` Competência atual: ${competenceBadge.label}.`
            : ''}
        </CardDescription>
        <p className="text-sm text-muted-foreground">
          O status da competência é independente do status dos treinamentos
          vinculados.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {trainings.map((tr) => (
          <div key={tr.id} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">{tr.title}</h4>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Badge variant={statusVariants[tr.status] ?? 'secondary'}>
                  Status do treinamento: {statusLabels[tr.status] ?? tr.status}
                </Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <Label className="text-muted-foreground text-xs">Tipo</Label>
                <p className="text-sm">{typeLabels[tr.type] ?? tr.type}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Início</Label>
                <p className="text-sm">{formatDate(tr.startDate)}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Término</Label>
                <p className="text-sm">{formatDate(tr.endDate)}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Horas</Label>
                <p className="text-sm">{tr.hoursCompleted ?? 0}h</p>
              </div>
            </div>
            {tr.provider && (
              <div>
                <Label className="text-muted-foreground text-xs">
                  Provedor
                </Label>
                <p className="text-sm">{tr.provider}</p>
              </div>
            )}
            {tr.score != null && (
              <div>
                <Label className="text-muted-foreground text-xs">Nota</Label>
                <p className="text-sm">
                  {tr.score}
                  {tr.passingScore != null
                    ? ` (mínimo: ${tr.passingScore})`
                    : ''}
                  {tr.passed != null && (
                    <Badge
                      variant={tr.passed ? 'default' : 'destructive'}
                      className="ml-2"
                    >
                      {tr.passed ? 'Aprovado' : 'Reprovado'}
                    </Badge>
                  )}
                </p>
              </div>
            )}
            {tr.description && (
              <div>
                <Label className="text-muted-foreground text-xs">
                  Descrição
                </Label>
                <p className="text-sm whitespace-pre-wrap">{tr.description}</p>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
