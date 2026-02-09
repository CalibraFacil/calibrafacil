import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { toast } from 'sonner'
import type { MethodData } from '@/components/method-builder'

import { api } from '@/utils/api'
import {
  AuditTimeline,
  buildAuditTimelineEvents,
  type AuditLogRecord,
} from '@/components/audit-timeline'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { RoleGate } from '@/components/permission-gate'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export const Route = createFileRoute('/dashboard/methods/$id/')({
  head: () => ({
    meta: [{ title: 'Detalhes do Método | CalibraFacil' }],
  }),
  component: MethodDetailPage,
})

const statusLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_APPROVAL: 'Em aprovação',
  TECHNICAL_REVIEWED: 'Revisão técnica',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Arquivado',
}

const statusVariants: Record<string, 'default' | 'secondary' | 'outline'> = {
  DRAFT: 'secondary',
  PENDING_APPROVAL: 'outline',
  TECHNICAL_REVIEWED: 'outline',
  PUBLISHED: 'default',
  ARCHIVED: 'outline',
}

function MethodDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const {
    data: method,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['methods', id],
    queryFn: async () => {
      const res = await api.api.methods[':id'].$get({
        param: { id },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar método')
      }

      return res.json() as Promise<
        MethodData & {
          assetTypeName?: string
          createdByName?: string
          createdAt: string
          technicalReviewedByName?: string | null
          approvedByName?: string | null
          publishedAt?: string
          archivedAt?: string
        }
      >
    },
  })

  // Fetch audit log for ISO 17025 compliance (Clause 8.4)
  const { data: auditLogData } = useQuery({
    queryKey: ['methods', id, 'audit'],
    queryFn: async () => {
      const res = await api.api.methods[':id'].audit.$get({
        param: { id },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar histórico')
      }

      return res.json() as Promise<{ data: AuditLogRecord[] }>
    },
  })

  const technicalReviewMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.methods[':id']['technical-review'].$post({
        param: { id },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao revisar tecnicamente',
        )
      }

      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['methods', id] })
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Revisão técnica registrada')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const qualityApproveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.methods[':id']['quality-approve'].$post({
        param: { id },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao aprovar qualidade',
        )
      }

      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['methods', id] })
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Método aprovado e publicado')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const returnToDraftMutation = useMutation({
    mutationFn: async (reason: string) => {
      const res = await api.api.methods[':id']['return-to-draft'].$post({
        param: { id },
        json: { reason },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao retornar para rascunho',
        )
      }

      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['methods', id] })
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Método retornou para rascunho')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500">
            Erro ao carregar método: {error.message}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardContent className="pt-6 space-y-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!method) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p>Método não encontrado</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/methods' })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>

        <div className="flex items-center gap-2">
          {method.status === 'DRAFT' && (
            <Button
              render={<Link to="/dashboard/methods/$id/edit" params={{ id }} />}
            >
              <HugeiconsIcon icon={Edit02Icon} className="mr-2 h-4 w-4" />
              Editar
            </Button>
          )}

          <RoleGate roles={['admin']}>
            {method.status === 'PENDING_APPROVAL' && (
              <Button
                onClick={() => technicalReviewMutation.mutate()}
                disabled={technicalReviewMutation.isPending}
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  className="mr-2 h-4 w-4"
                />
                {technicalReviewMutation.isPending
                  ? 'Revisando...'
                  : 'Revisar tecnicamente'}
              </Button>
            )}
          </RoleGate>

          <RoleGate roles={['owner']}>
            {method.status === 'TECHNICAL_REVIEWED' && (
              <Button
                onClick={() => qualityApproveMutation.mutate()}
                disabled={qualityApproveMutation.isPending}
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  className="mr-2 h-4 w-4"
                />
                {qualityApproveMutation.isPending
                  ? 'Aprovando...'
                  : 'Aprovar qualidade'}
              </Button>
            )}
          </RoleGate>

          <RoleGate roles={['admin', 'owner']}>
            {(method.status === 'PENDING_APPROVAL' ||
              method.status === 'TECHNICAL_REVIEWED') && (
              <Button
                variant="outline"
                onClick={() => {
                  if (
                    !window.confirm(
                      'Deseja retornar este método para rascunho?',
                    )
                  ) {
                    return
                  }
                  const reason = window.prompt(
                    'Informe o motivo para retornar ao rascunho',
                  )
                  if (!reason || reason.trim().length < 3) {
                    toast.error('Motivo obrigatório (mín. 3 caracteres)')
                    return
                  }
                  returnToDraftMutation.mutate(reason.trim())
                }}
                disabled={returnToDraftMutation.isPending}
              >
                <HugeiconsIcon icon={RefreshIcon} className="mr-2 h-4 w-4" />
                {returnToDraftMutation.isPending
                  ? 'Retornando...'
                  : 'Retornar para rascunho'}
              </Button>
            )}
          </RoleGate>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">{method.name}</CardTitle>
              <CardDescription>
                {method.description || 'Sem descrição'}
              </CardDescription>
            </div>
            <div className="text-right">
              <Badge variant={statusVariants[method.status]}>
                {statusLabels[method.status]}
              </Badge>
              <p className="text-sm text-muted-foreground mt-1">
                Versão {method.version}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Tipo de Instrumento
              </p>
              <p>{method.assetTypeName || '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Criado por
              </p>
              <p>{method.createdByName || '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Revisado tecnicamente por
              </p>
              <p>{method.technicalReviewedByName || '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Aprovado por (Qualidade)
              </p>
              <p>{method.approvedByName || '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Criado em
              </p>
              <p>
                {new Date(method.createdAt).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            {method.publishedAt && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Publicado em
                </p>
                <p>
                  {new Date(method.publishedAt).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            )}
          </div>

          {/* Data Fields */}
          <div>
            <h3 className="font-semibold mb-2">
              Campos de Entrada ({method.dataFields.length})
            </h3>
            {method.dataFields.length === 0 ? (
              <p className="text-muted-foreground">
                Nenhum campo de entrada definido
              </p>
            ) : (
              <div className="grid gap-2">
                {method.dataFields.map((field) => (
                  <div
                    key={field.key}
                    className="p-2 border rounded bg-muted/30"
                  >
                    <span className="font-medium">{field.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      ({field.key}: {field.type}
                      {field.unit && ` [${field.unit}]`})
                    </span>
                    {field.required && (
                      <span className="text-xs text-red-500 ml-1">*</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Formulas */}
          <div>
            <h3 className="font-semibold mb-2">
              Fórmulas ({method.formulas.length})
            </h3>
            {method.formulas.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma fórmula definida</p>
            ) : (
              <div className="grid gap-2">
                {method.formulas.map((formula) => (
                  <div
                    key={formula.outputKey}
                    className="p-2 border rounded bg-muted/30"
                  >
                    <span className="font-medium">
                      {formula.label || formula.outputKey}
                    </span>
                    <code className="text-xs bg-muted px-1 rounded ml-2">
                      {formula.expression}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Validations */}
          <div>
            <h3 className="font-semibold mb-2">
              Critérios de Aceitação ({method.validations.length})
            </h3>
            {method.validations.length === 0 ? (
              <p className="text-muted-foreground">Nenhum critério definido</p>
            ) : (
              <div className="grid gap-2">
                {method.validations.map((validation, idx) => (
                  <div key={idx} className="p-2 border rounded bg-muted/30">
                    <span
                      className={`text-xs px-1 rounded ${validation.severity === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}
                    >
                      {validation.severity === 'error' ? 'Erro' : 'Aviso'}
                    </span>
                    <code className="text-xs bg-muted px-1 rounded ml-2">
                      {validation.expression}
                    </code>
                    <p className="text-sm text-muted-foreground mt-1">
                      {validation.message}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Audit Log - ISO 17025 Clause 8.4 (Control of Records) */}
      {auditLogData?.data && auditLogData.data.length > 0 && (
        <AuditTimeline
          events={buildAuditTimelineEvents(auditLogData.data)}
          title="Histórico de Alterações (ISO 17025)"
        />
      )}
    </div>
  )
}
