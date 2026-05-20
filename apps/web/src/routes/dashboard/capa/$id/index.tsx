import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'

export const Route = createFileRoute('/dashboard/capa/$id/')({
  head: () => ({
    meta: [{ title: 'Detalhes CAPA | CalibraFácil' }],
  }),
  component: CAPADetailPage,
})

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

const sourceLabels: Record<string, string> = {
  internal_audit: 'Auditoria Interna',
  customer_complaint: 'Reclamação de Cliente',
  nc_detection: 'Detecção de NC',
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

const rcaMethodLabels: Record<string, string> = {
  '5_whys': '5 Porquês',
  fishbone: 'Diagrama de Ishikawa',
  pareto: 'Análise de Pareto',
  other: 'Outro',
}

type CAPADetail = {
  id: number
  capaNumber: string
  organizationId: string
  source: string
  sourceReference: string | null
  title: string
  description: string
  detectionDate: string | null
  type: string
  severity: string
  category: string
  rootCauseAnalysis: string | null
  rootCauseAnalysisMethod: string | null
  actionPlan: string | null
  preventiveMeasures: string | null
  responsibleId: string | null
  dueDate: string | null
  implementationEvidence: string | null
  implementedAt: string | null
  investigationCompletedAt: string | null
  verifiedAt: string | null
  verifiedBy: string | null
  verificationNotes: string | null
  effectivenessConfirmed: boolean | null
  status: string
  closedAt: string | null
  closedBy: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  responsibleName: string | null
  verifiedByName: string | null
  closedByName: string | null
  createdByName: string | null
  linkedNCs: Array<{
    id: number
    ncNumber: string
    type: string
    description: string
    status: string
    detectedAt: string
  }>
  ageDays: number
  isOverdue: boolean | null
}

type AuditLogEntry = {
  id: number
  capaId: number
  action: string
  changes: unknown
  performedBy: string
  performedAt: string
  ipAddress: string | null
  reason: string | null
  performedByName: string | null
}

function CAPADetailPage() {
  const { id } = Route.useParams()
  const queryClient = useQueryClient()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()

  const [implementationEvidence, setImplementationEvidence] = useState('')
  const [verificationNotes, setVerificationNotes] = useState('')
  const [effectivenessConfirmed, setEffectivenessConfirmed] = useState(false)
  const [closeReason, setCloseReason] = useState('')

  const { data: capa, isLoading } = useQuery({
    queryKey: ['capa', id],
    enabled: !cloudOnlyUnavailable,
    queryFn: async () => calibraApi.capas.get<CAPADetail>(id),
  })

  const { data: auditLog } = useQuery({
    queryKey: ['capa-audit-log', id],
    enabled: !cloudOnlyUnavailable,
    queryFn: async () =>
      calibraApi.capas.auditLog<{ data: AuditLogEntry[] }>(id),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['capa', id] })
    queryClient.invalidateQueries({ queryKey: ['capa-audit-log', id] })
    queryClient.invalidateQueries({ queryKey: ['capas'] })
    queryClient.invalidateQueries({ queryKey: ['capas-summary'] })
  }

  const implementMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.capas.implement(id, { implementationEvidence })
    },
    onSuccess: () => {
      toast.success('CAPA marcada como implementada')
      setImplementationEvidence('')
      invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  const verifyMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.capas.verify(id, {
        effectivenessConfirmed,
        verificationNotes,
      })
    },
    onSuccess: () => {
      toast.success('Verificação de eficácia registrada')
      setVerificationNotes('')
      setEffectivenessConfirmed(false)
      invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  const closeMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.capas.close(id, { reason: closeReason || undefined })
    },
    onSuccess: () => {
      toast.success('CAPA fechada com sucesso')
      setCloseReason('')
      invalidate()
    },
    onError: (e) => toast.error(e.message),
  })

  if (cloudOnlyUnavailable) {
    return <CloudOnlyOfflineState title="CAPA indisponível offline" />
  }

  if (isLoading) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        Carregando...
      </div>
    )
  }

  if (!capa) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        CAPA não encontrada
      </div>
    )
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('pt-BR')
  }

  const actionLabels: Record<string, string> = {
    create: 'Criação',
    update: 'Atualização',
    implement: 'Implementação',
    verify: 'Verificação',
    close: 'Fechamento',
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{capa.capaNumber}</h1>
            <Badge
              variant="outline"
              className={statusVariants[capa.status] ?? ''}
            >
              {statusLabels[capa.status] ?? capa.status}
            </Badge>
            {capa.isOverdue && <Badge variant="destructive">Atrasada</Badge>}
          </div>
          <p className="text-muted-foreground mt-1">{capa.title}</p>
        </div>
        <Button variant="outline" render={<Link to="/dashboard/capa" />}>
          Voltar
        </Button>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Description Card */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Descrição</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap">{capa.description}</p>
          </CardContent>
        </Card>

        {/* Classification */}
        <Card>
          <CardHeader>
            <CardTitle>Classificação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tipo</span>
              <span>
                {capa.type === 'corrective' ? 'Corretiva' : 'Preventiva'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Severidade</span>
              <Badge variant="outline">
                {severityLabels[capa.severity] ?? capa.severity}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Categoria</span>
              <span>{categoryLabels[capa.category] ?? capa.category}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Origem</span>
              <span>{sourceLabels[capa.source] ?? capa.source}</span>
            </div>
            {capa.sourceReference && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Referência</span>
                <span>{capa.sourceReference}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Dates & Responsibility */}
        <Card>
          <CardHeader>
            <CardTitle>Prazos e Responsabilidade</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Detecção</span>
              <span>{formatDate(capa.detectionDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Data Alvo</span>
              <span
                className={capa.isOverdue ? 'text-red-600 font-medium' : ''}
              >
                {formatDate(capa.dueDate)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Responsável</span>
              <span>{capa.responsibleName ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Idade</span>
              <span>{capa.ageDays} dias</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Criado por</span>
              <span>{capa.createdByName ?? '-'}</span>
            </div>
          </CardContent>
        </Card>

        {/* Root Cause Analysis */}
        {capa.rootCauseAnalysis && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Análise de Causa Raiz</CardTitle>
              {capa.rootCauseAnalysisMethod && (
                <CardDescription>
                  Metodo:{' '}
                  {rcaMethodLabels[capa.rootCauseAnalysisMethod] ??
                    capa.rootCauseAnalysisMethod}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap">{capa.rootCauseAnalysis}</p>
            </CardContent>
          </Card>
        )}

        {/* Action Plan */}
        {capa.actionPlan && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Plano de Ação</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="whitespace-pre-wrap">{capa.actionPlan}</p>
              {capa.preventiveMeasures && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-medium mb-2">Medidas Preventivas</h4>
                    <p className="whitespace-pre-wrap">
                      {capa.preventiveMeasures}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Implementation Evidence */}
        {capa.implementationEvidence && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Evidência de Implementação</CardTitle>
              <CardDescription>
                Implementado em {formatDate(capa.implementedAt)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap">
                {capa.implementationEvidence}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Verification */}
        {capa.verifiedAt && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Verificação de Eficácia</CardTitle>
              <CardDescription>
                Verificado em {formatDate(capa.verifiedAt)} por{' '}
                {capa.verifiedByName ?? '-'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">
                  Eficacia confirmada:
                </span>
                <Badge
                  variant="outline"
                  className={
                    capa.effectivenessConfirmed
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }
                >
                  {capa.effectivenessConfirmed ? 'Sim' : 'Nao'}
                </Badge>
              </div>
              {capa.verificationNotes && (
                <p className="whitespace-pre-wrap">{capa.verificationNotes}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Linked NCs */}
        {capa.linkedNCs && capa.linkedNCs.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Não Conformidades Vinculadas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {capa.linkedNCs.map((nc) => (
                  <div
                    key={nc.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <Link
                        to="/dashboard/nc/$id"
                        params={{ id: String(nc.id) }}
                        className="font-medium text-primary hover:underline"
                      >
                        {nc.ncNumber}
                      </Link>
                      <p className="text-sm text-muted-foreground truncate max-w-md">
                        {nc.description}
                      </p>
                    </div>
                    <Badge variant="outline">{nc.status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Workflow Actions */}
      {capa.status !== 'CLOSED' && (
        <Card>
          <CardHeader>
            <CardTitle>Ações do Fluxo de Trabalho</CardTitle>
            <CardDescription>
              {capa.status === 'OPEN' || capa.status === 'INVESTIGATION'
                ? 'Registre a evidência de implementação das ações corretivas'
                : capa.status === 'IMPLEMENTATION'
                  ? 'Verifique a eficácia das ações implementadas'
                  : 'Feche a CAPA após verificação de eficácia'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Implement action */}
            {(capa.status === 'OPEN' ||
              capa.status === 'INVESTIGATION' ||
              capa.status === 'IMPLEMENTATION') &&
              !capa.implementedAt && (
                <>
                  <div className="space-y-2">
                    <Label>Evidência de Implementação</Label>
                    <Textarea
                      value={implementationEvidence}
                      onChange={(e) =>
                        setImplementationEvidence(e.target.value)
                      }
                      placeholder="Descreva o que foi feito para implementar as ações corretivas, incluindo evidências..."
                      rows={4}
                    />
                  </div>
                  <Button
                    onClick={() => implementMutation.mutate()}
                    disabled={
                      implementMutation.isPending ||
                      implementationEvidence.length < 10
                    }
                  >
                    {implementMutation.isPending
                      ? 'Registrando...'
                      : 'Registrar Implementação'}
                  </Button>
                </>
              )}

            {/* Verify action */}
            {capa.status === 'IMPLEMENTATION' && (
              <>
                <Separator />
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={effectivenessConfirmed}
                      onCheckedChange={setEffectivenessConfirmed}
                    />
                    <Label>Eficacia das acoes confirmada</Label>
                  </div>
                  <div className="space-y-2">
                    <Label>Notas de Verificacao</Label>
                    <Textarea
                      value={verificationNotes}
                      onChange={(e) => setVerificationNotes(e.target.value)}
                      placeholder="Descreva como a eficácia foi verificada e os resultados observados..."
                      rows={4}
                    />
                  </div>
                  <Button
                    onClick={() => verifyMutation.mutate()}
                    disabled={
                      verifyMutation.isPending || verificationNotes.length < 10
                    }
                    variant="secondary"
                  >
                    {verifyMutation.isPending
                      ? 'Verificando...'
                      : 'Registrar Verificação de Eficácia'}
                  </Button>
                </div>
              </>
            )}

            {/* Close action */}
            {capa.status === 'VERIFICATION' && (
              <>
                <Separator />
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Motivo do Fechamento (opcional)</Label>
                    <Textarea
                      value={closeReason}
                      onChange={(e) => setCloseReason(e.target.value)}
                      placeholder="Observações finais sobre o fechamento da CAPA..."
                      rows={3}
                    />
                  </div>
                  <Button
                    onClick={() => closeMutation.mutate()}
                    disabled={closeMutation.isPending}
                    variant="default"
                  >
                    {closeMutation.isPending ? 'Fechando...' : 'Fechar CAPA'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Audit Log */}
      {auditLog && auditLog.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Historico de Auditoria</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {auditLog.data.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start justify-between rounded-lg border p-3"
                >
                  <div>
                    <span className="font-medium">
                      {actionLabels[log.action] ?? log.action}
                    </span>
                    <p className="text-sm text-muted-foreground">
                      por {log.performedByName ?? log.performedBy}
                    </p>
                    {log.reason && <p className="text-sm mt-1">{log.reason}</p>}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {new Date(log.performedAt).toLocaleString('pt-BR')}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
