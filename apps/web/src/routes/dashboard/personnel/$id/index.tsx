import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { type CompetenceStatus, getStatusBadge } from '../-components/columns'

export const Route = createFileRoute('/dashboard/personnel/$id/')({
  head: () => ({
    meta: [{ title: 'Detalhes da Competência | CalibraFacil' }],
  }),
  component: CompetenceDetailPage,
})

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const WORKFLOW_STEPS: CompetenceStatus[] = [
  'REQUESTED',
  'TRAINING_ASSIGNED',
  'IN_TRAINING',
  'PENDING_EVALUATION',
  'ACTIVE',
]

function CompetenceDetailPage() {
  const { id } = Route.useParams()
  const queryClient = useQueryClient()
  const [evaluateDialogOpen, setEvaluateDialogOpen] = useState(false)
  const [renewDialogOpen, setRenewDialogOpen] = useState(false)

  const {
    data: comp,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['competence', id],
    queryFn: async () => {
      const res = await api.api.competences[':id'].$get({ param: { id } })
      if (!res.ok) throw new Error('Falha ao carregar competência')
      return res.json() as Promise<{
        id: number
        organizationId: string
        userId: string
        userName: string | null
        userEmail: string | null
        assetTypeId: number | null
        assetTypeName: string | null
        scopeDescription: string
        status: CompetenceStatus
        qualifiedAt: string | null
        expiresAt: string | null
        certificateR2Key: string | null
        certificateFileName: string | null
        notes: string | null
        requestedBy: string
        requestedByName: string | null
        evaluatedBy: string | null
        evaluatedByName: string | null
        approvedBy: string | null
        approvedByName: string | null
        createdAt: string
        updatedAt: string
        trainingRecords: Array<{
          id: number
          title: string
          type: string
          status: string
          startDate: string
          endDate: string | null
        }>
      }>
    },
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['competence', id] })
    queryClient.invalidateQueries({ queryKey: ['competences'] })
    queryClient.invalidateQueries({ queryKey: ['competences-matrix'] })
  }

  // Workflow transition mutations
  const transitionMutation = useMutation({
    mutationFn: async ({
      action,
    }: {
      action: 'start-training' | 'complete-training' | 'suspend'
    }) => {
      const res = await api.api.competences[':id'][action].$post({
        param: { id },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error((err as { error?: string }).error || 'Erro na operação')
      }
      return res.json()
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Status atualizado')
    },
    onError: (error) => toast.error(error.message),
  })

  // Evaluate mutation
  const evaluateMutation = useMutation({
    mutationFn: async (data: {
      passed: boolean
      notes?: string
      qualifiedAt?: string
      expiresAt?: string
    }) => {
      const res = await api.api.competences[':id'].evaluate.$post({
        param: { id },
        json: data,
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error((err as { error?: string }).error || 'Erro na avaliação')
      }
      return res.json()
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Avaliação registrada')
      setEvaluateDialogOpen(false)
    },
    onError: (error) => toast.error(error.message),
  })

  // Renew mutation
  const renewMutation = useMutation({
    mutationFn: async (data: {
      passed: boolean
      notes?: string
      qualifiedAt?: string
      expiresAt?: string
    }) => {
      const res = await api.api.competences[':id'].renew.$post({
        param: { id },
        json: data,
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error((err as { error?: string }).error || 'Erro na renovação')
      }
      return res.json()
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Competência renovada')
      setRenewDialogOpen(false)
    },
    onError: (error) => toast.error(error.message),
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

  if (error || !comp) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500">
            {error?.message || 'Competência não encontrada'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const statusBadge = getStatusBadge(comp.status)
  const currentStepIndex = WORKFLOW_STEPS.indexOf(comp.status)

  return (
    <div className="space-y-6">
      {/* Workflow Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Progresso da Qualificação</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1">
            {WORKFLOW_STEPS.map((step, i) => {
              const isCompleted = currentStepIndex > i
              const isCurrent = comp.status === step
              const isInactive =
                comp.status === 'SUSPENDED' || comp.status === 'EXPIRED'
              return (
                <div key={step} className="flex items-center flex-1">
                  <div
                    className={`flex-1 h-2 rounded-full ${
                      isCompleted
                        ? 'bg-primary'
                        : isCurrent && !isInactive
                          ? 'bg-primary/50'
                          : 'bg-muted'
                    }`}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>Solicitada</span>
            <span>Treinamento</span>
            <span>Avaliação</span>
            <span>Ativa</span>
          </div>
          {(comp.status === 'SUSPENDED' || comp.status === 'EXPIRED') && (
            <div className="mt-3">
              <Badge variant="destructive">
                {comp.status === 'SUSPENDED' ? 'Suspensa' : 'Expirada'}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Details */}
        <Card>
          <CardHeader>
            <CardTitle>Detalhes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Técnico</Label>
                <p className="font-medium">{comp.userName ?? '-'}</p>
                {comp.userEmail && (
                  <p className="text-xs text-muted-foreground">
                    {comp.userEmail}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-muted-foreground">
                  Tipo de Instrumento
                </Label>
                <p className="font-medium">
                  {comp.assetTypeName ?? 'Escopo geral'}
                </p>
              </div>
              <div className="col-span-2">
                <Label className="text-muted-foreground">Escopo</Label>
                <p className="font-medium">{comp.scopeDescription}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Status</Label>
                <p>
                  <Badge
                    variant={statusBadge.variant}
                    className={statusBadge.className}
                  >
                    {statusBadge.label}
                  </Badge>
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Criado em</Label>
                <p className="font-medium">{formatDate(comp.createdAt)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Qualification Info */}
        <Card>
          <CardHeader>
            <CardTitle>Qualificação</CardTitle>
            <CardDescription>Dados da certificação e validade</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Qualificado em</Label>
                <p className="font-medium">{formatDate(comp.qualifiedAt)}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Expira em</Label>
                <p className="font-medium">{formatDate(comp.expiresAt)}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Solicitado por</Label>
                <p className="font-medium">{comp.requestedByName ?? '-'}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Avaliado por</Label>
                <p className="font-medium">{comp.evaluatedByName ?? '-'}</p>
              </div>
              {comp.approvedByName && (
                <div>
                  <Label className="text-muted-foreground">Aprovado por</Label>
                  <p className="font-medium">{comp.approvedByName}</p>
                </div>
              )}
            </div>
            {comp.notes && (
              <div>
                <Label className="text-muted-foreground">Observações</Label>
                <p className="mt-1 whitespace-pre-wrap text-sm">{comp.notes}</p>
              </div>
            )}

            {/* Workflow Actions */}
            <div className="flex flex-wrap gap-2 pt-4 border-t">
              {comp.status === 'TRAINING_ASSIGNED' && (
                <Button
                  onClick={() =>
                    transitionMutation.mutate({ action: 'start-training' })
                  }
                  disabled={transitionMutation.isPending}
                >
                  {transitionMutation.isPending
                    ? 'Processando...'
                    : 'Iniciar Treinamento'}
                </Button>
              )}

              {comp.status === 'IN_TRAINING' && (
                <Button
                  onClick={() =>
                    transitionMutation.mutate({ action: 'complete-training' })
                  }
                  disabled={transitionMutation.isPending}
                >
                  {transitionMutation.isPending
                    ? 'Processando...'
                    : 'Concluir Treinamento'}
                </Button>
              )}

              {comp.status === 'PENDING_EVALUATION' && (
                <Dialog
                  open={evaluateDialogOpen}
                  onOpenChange={setEvaluateDialogOpen}
                >
                  <DialogTrigger render={<Button>Avaliar</Button>} />
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Avaliar Competência</DialogTitle>
                      <DialogDescription>
                        Avalie se o técnico está qualificado para esta atividade.
                      </DialogDescription>
                    </DialogHeader>
                    <EvaluateForm
                      onSubmit={(data) => evaluateMutation.mutate(data)}
                      isLoading={evaluateMutation.isPending}
                    />
                  </DialogContent>
                </Dialog>
              )}

              {comp.status === 'ACTIVE' && (
                <Button
                  variant="outline"
                  onClick={() =>
                    transitionMutation.mutate({ action: 'suspend' })
                  }
                  disabled={transitionMutation.isPending}
                >
                  Suspender
                </Button>
              )}

              {(comp.status === 'EXPIRED' || comp.status === 'SUSPENDED') && (
                <Dialog
                  open={renewDialogOpen}
                  onOpenChange={setRenewDialogOpen}
                >
                  <DialogTrigger render={<Button>Renovar</Button>} />
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Renovar Competência</DialogTitle>
                      <DialogDescription>
                        Defina novas datas para reativar esta competência.
                      </DialogDescription>
                    </DialogHeader>
                    <EvaluateForm
                      onSubmit={(data) => renewMutation.mutate(data)}
                      isLoading={renewMutation.isPending}
                      isRenewal
                    />
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ============================================================================
// Evaluate / Renew Form
// ============================================================================

function EvaluateForm({
  onSubmit,
  isLoading,
  isRenewal = false,
}: {
  onSubmit: (data: {
    passed: boolean
    notes?: string
    qualifiedAt?: string
    expiresAt?: string
  }) => void
  isLoading: boolean
  isRenewal?: boolean
}) {
  const [notes, setNotes] = useState('')
  const [expiresAt, setExpiresAt] = useState('')

  return (
    <div className="space-y-4">
      {!isRenewal && (
        <p className="text-sm text-muted-foreground">
          Se reprovado, o técnico retornará ao status &quot;Treinamento
          Atribuído&quot; para nova capacitação.
        </p>
      )}

      <div className="space-y-2">
        <Label>Data de Expiração (opcional)</Label>
        <Input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Deixe vazio para competência sem expiração.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Observações (opcional)</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observações sobre a avaliação..."
          rows={3}
        />
      </div>

      <div className="flex gap-2">
        {!isRenewal && (
          <Button
            variant="outline"
            onClick={() =>
              onSubmit({
                passed: false,
                notes: notes || undefined,
              })
            }
            disabled={isLoading}
            className="flex-1"
          >
            {isLoading ? 'Processando...' : 'Reprovar'}
          </Button>
        )}
        <Button
          onClick={() =>
            onSubmit({
              passed: true,
              notes: notes || undefined,
              qualifiedAt: new Date().toISOString(),
              expiresAt: expiresAt
                ? new Date(expiresAt).toISOString()
                : undefined,
            })
          }
          disabled={isLoading}
          className="flex-1"
        >
          {isLoading
            ? 'Processando...'
            : isRenewal
              ? 'Renovar'
              : 'Aprovar'}
        </Button>
      </div>
    </div>
  )
}
