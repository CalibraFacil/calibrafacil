import { useActiveOrganization } from '@calibra-facil/auth/client'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
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

function getTodayDateInputValue(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toISOStringFromDateInput(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString()
}

const WORKFLOW_STEPS: CompetenceStatus[] = [
  'REQUESTED',
  'TRAINING_ASSIGNED',
  'IN_TRAINING',
  'PENDING_EVALUATION',
  'ACTIVE',
]

type TrainingType = 'internal' | 'external' | 'ojt' | 'proficiency_test'

type TrainingRecordOption = {
  id: number
  userId: string
  competenceId: number | null
  title: string
  type: TrainingType
  status: string
  provider: string | null
  startDate: string
  endDate: string | null
  hoursCompleted: number | null
}

const TRAINING_TYPE_LABELS: Record<TrainingType, string> = {
  internal: 'Interno',
  external: 'Externo',
  ojt: 'Em Serviço',
  proficiency_test: 'Teste de Proficiência',
}

const TRAINING_STATUS_LABELS: Record<string, string> = {
  planned: 'Planejado',
  in_progress: 'Em Andamento',
  completed: 'Concluído',
  failed: 'Reprovado',
}

function CompetenceDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: activeOrg } = useActiveOrganization()
  const [evaluateDialogOpen, setEvaluateDialogOpen] = useState(false)
  const [renewDialogOpen, setRenewDialogOpen] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [cancelNotes, setCancelNotes] = useState('')

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

  const cancelMutation = useMutation({
    mutationFn: async (notes?: string) => {
      const res = await api.api.competences[':id'].cancel.$post({
        param: { id },
        json: { notes },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(
          (err as { error?: string }).error || 'Erro ao cancelar competência',
        )
      }
      return res.json()
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Competência cancelada')
      setCancelDialogOpen(false)
      setCancelNotes('')
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.competences[':id'].$delete({
        param: { id },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(
          (err as { error?: string }).error || 'Erro ao excluir competência',
        )
      }
      return res.json()
    },
    onSuccess: async () => {
      invalidateAll()
      toast.success('Competência excluída')
      setDeleteDialogOpen(false)
      await navigate({ to: '/dashboard/personnel' })
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
  const userRole =
    typeof activeOrg?.members?.[0]?.role === 'string'
      ? activeOrg.members[0].role
      : null
  const canDelete = userRole === 'owner' || userRole === 'admin'
  const isTerminalInactive =
    comp.status === 'SUSPENDED' ||
    comp.status === 'EXPIRED' ||
    comp.status === 'CANCELLED'
  const canCancel =
    comp.status === 'REQUESTED' ||
    comp.status === 'TRAINING_ASSIGNED' ||
    comp.status === 'IN_TRAINING' ||
    comp.status === 'PENDING_EVALUATION'

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
              return (
                <div key={step} className="flex items-center flex-1">
                  <div
                    className={`flex-1 h-2 rounded-full ${
                      isCompleted
                        ? 'bg-primary'
                        : isCurrent && !isTerminalInactive
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
          {isTerminalInactive && (
            <div className="mt-3">
              <Badge
                variant={statusBadge.variant}
                className={statusBadge.className}
              >
                {statusBadge.label}
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
              {canCancel && (
                <Dialog
                  open={cancelDialogOpen}
                  onOpenChange={(open) => {
                    setCancelDialogOpen(open)
                    if (!open) setCancelNotes('')
                  }}
                >
                  <DialogTrigger
                    render={<Button variant="outline">Cancelar</Button>}
                  />
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Cancelar Competência</DialogTitle>
                      <DialogDescription>
                        Cancele este fluxo quando a qualificação não deve mais
                        prosseguir. A competência permanecerá no histórico com
                        status &quot;Cancelada&quot;.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                      <Label htmlFor="cancel-notes">Motivo (opcional)</Label>
                      <Textarea
                        id="cancel-notes"
                        value={cancelNotes}
                        onChange={(e) => setCancelNotes(e.target.value)}
                        placeholder="Explique por que esta competência foi cancelada..."
                        rows={3}
                        disabled={cancelMutation.isPending}
                      />
                    </div>

                    <DialogFooter>
                      <DialogClose
                        render={
                          <Button
                            variant="outline"
                            disabled={cancelMutation.isPending}
                          />
                        }
                      >
                        Voltar
                      </DialogClose>
                      <Button
                        variant="destructive"
                        onClick={() =>
                          cancelMutation.mutate(cancelNotes || undefined)
                        }
                        disabled={cancelMutation.isPending}
                      >
                        {cancelMutation.isPending
                          ? 'Processando...'
                          : 'Confirmar Cancelamento'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

              {comp.status === 'REQUESTED' && (
                <AssignTrainingDialog
                  competenceId={id}
                  userId={comp.userId}
                  userName={comp.userName ?? 'Técnico'}
                  onAssigned={invalidateAll}
                />
              )}

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

              {canDelete && (
                <Dialog
                  open={deleteDialogOpen}
                  onOpenChange={setDeleteDialogOpen}
                >
                  <DialogTrigger
                    render={<Button variant="destructive">Excluir</Button>}
                  />
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Excluir Competência</DialogTitle>
                      <DialogDescription>
                        Esta ação remove a competência da visualização principal.
                        O registro será mantido como exclusão lógica para fins
                        internos.
                      </DialogDescription>
                    </DialogHeader>

                    <p className="text-sm text-muted-foreground">
                      Exclua apenas cadastros criados por engano ou que não
                      devam permanecer no histórico operacional.
                    </p>

                    <DialogFooter>
                      <DialogClose
                        render={
                          <Button
                            variant="outline"
                            disabled={deleteMutation.isPending}
                          />
                        }
                      >
                        Voltar
                      </DialogClose>
                      <Button
                        variant="destructive"
                        onClick={() => deleteMutation.mutate()}
                        disabled={deleteMutation.isPending}
                      >
                        {deleteMutation.isPending
                          ? 'Excluindo...'
                          : 'Confirmar Exclusão'}
                      </Button>
                    </DialogFooter>
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

function AssignTrainingDialog({
  competenceId,
  userId,
  userName,
  onAssigned,
}: {
  competenceId: string
  userId: string
  userName: string
  onAssigned: () => void
}) {
  const [open, setOpen] = useState(false)
  const [createMode, setCreateMode] = useState(false)
  const [selectedTrainingIds, setSelectedTrainingIds] = useState<number[]>([])
  const [title, setTitle] = useState('')
  const [type, setType] = useState<TrainingType>('internal')
  const [provider, setProvider] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState(getTodayDateInputValue())
  const [endDate, setEndDate] = useState('')
  const queryClient = useQueryClient()

  const resetForm = () => {
    setCreateMode(false)
    setSelectedTrainingIds([])
    setTitle('')
    setType('internal')
    setProvider('')
    setDescription('')
    setStartDate(getTodayDateInputValue())
    setEndDate('')
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['training-records', 'assignable', userId],
    queryFn: async () => {
      const res = await api.api['training-records'].$get({
        query: {
          page: '1',
          limit: '100',
          userId,
        },
      })
      if (!res.ok) throw new Error('Falha ao carregar treinamentos')
      return res.json() as Promise<{ data: Array<TrainingRecordOption> }>
    },
    enabled: open,
  })

  const availableTrainingRecords =
    data?.data.filter(
      (record) =>
        record.competenceId === null ||
        record.competenceId === Number(competenceId),
    ) ?? []

  const assignTrainingMutation = useMutation({
    mutationFn: async (trainingRecordIds: number[]) => {
      const res = await api.api.competences[':id']['assign-training'].$post({
        param: { id: competenceId },
        json: { trainingRecordIds },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(
          (err as { error?: string }).error || 'Erro ao atribuir treinamento',
        )
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-records'] })
      onAssigned()
      toast.success('Treinamento atribuído')
      setOpen(false)
      resetForm()
    },
    onError: (error) => toast.error(error.message),
  })

  const createTrainingMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api['training-records'].$post({
        json: {
          userId,
          title: title.trim(),
          type,
          provider: provider.trim() || undefined,
          description: description.trim() || undefined,
          startDate: toISOStringFromDateInput(startDate),
          endDate: endDate ? toISOStringFromDateInput(endDate) : undefined,
        },
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(
          (err as { error?: string }).error ||
            'Erro ao criar registro de treinamento',
        )
      }

      const created = (await res.json()) as { id: number }

      const assignRes = await api.api.competences[':id']['assign-training'].$post(
        {
          param: { id: competenceId },
          json: { trainingRecordIds: [created.id] },
        },
      )

      if (!assignRes.ok) {
        const err = await assignRes.json()
        throw new Error(
          (err as { error?: string }).error || 'Erro ao atribuir treinamento',
        )
      }

      return assignRes.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-records'] })
      onAssigned()
      toast.success('Treinamento atribuído')
      setOpen(false)
      resetForm()
    },
    onError: (error) => toast.error(error.message),
  })

  const isSubmitting =
    assignTrainingMutation.isPending || createTrainingMutation.isPending
  const showCreateForm =
    createMode || (!isLoading && !error && availableTrainingRecords.length === 0)

  const toggleTraining = (trainingId: number, checked: boolean) => {
    setSelectedTrainingIds((current) => {
      if (checked) {
        return current.includes(trainingId) ? current : [...current, trainingId]
      }
      return current.filter((id) => id !== trainingId)
    })
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) resetForm()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button>Atribuir Treinamento</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Atribuir Treinamento</DialogTitle>
          <DialogDescription>
            Vincule um treinamento existente ou crie um novo registro para
            avançar a competência de {userName} para o status &quot;Treinamento
            Atribuído&quot;.
          </DialogDescription>
        </DialogHeader>

        {!createMode && isLoading ? (
          <p className="text-sm text-muted-foreground">
            Carregando treinamentos...
          </p>
        ) : !createMode && error ? (
          <div className="space-y-4">
            <p className="text-sm text-red-500">{error.message}</p>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateMode(true)}
              >
                Criar novo treinamento
              </Button>
            </div>
          </div>
        ) : showCreateForm ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              createTrainingMutation.mutate()
            }}
          >
            {availableTrainingRecords.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                className="px-0"
                onClick={() => setCreateMode(false)}
                disabled={isSubmitting}
              >
                Selecionar treinamento existente
              </Button>
            )}

            <div className="space-y-2">
              <Label htmlFor="training-title">Título do treinamento</Label>
              <Input
                id="training-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Treinamento interno de calibração"
                disabled={isSubmitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={type}
                onValueChange={(value) => setType(value as TrainingType)}
              >
                <SelectTrigger>
                  <span>{TRAINING_TYPE_LABELS[type]}</span>
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.entries(TRAINING_TYPE_LABELS) as Array<
                      [TrainingType, string]
                    >
                  ).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="training-start-date">Data de início</Label>
                <Input
                  id="training-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="training-end-date">Data de término</Label>
                <Input
                  id="training-end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="training-provider">Provedor (opcional)</Label>
              <Input
                id="training-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="Ex.: SENAI, fabricante, treinamento interno"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="training-description">Descrição (opcional)</Label>
              <Textarea
                id="training-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva o conteúdo ou evidência do treinamento..."
                rows={3}
                disabled={isSubmitting}
              />
            </div>

            <DialogFooter>
              <DialogClose
                render={<Button variant="outline" disabled={isSubmitting} />}
              >
                Cancelar
              </DialogClose>
              <Button
                type="submit"
                disabled={!title.trim() || !startDate || isSubmitting}
              >
                {isSubmitting ? 'Processando...' : 'Criar e Atribuir'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
              {availableTrainingRecords.map((record) => {
                const checked = selectedTrainingIds.includes(record.id)
                return (
                  <label
                    key={record.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(nextChecked) =>
                        toggleTraining(record.id, nextChecked === true)
                      }
                      disabled={isSubmitting}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{record.title}</p>
                        <Badge variant="outline">
                          {TRAINING_STATUS_LABELS[record.status] ??
                            record.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {TRAINING_TYPE_LABELS[record.type]} • início{' '}
                        {formatDate(record.startDate)}
                        {record.endDate
                          ? ` • término ${formatDate(record.endDate)}`
                          : ''}
                      </p>
                      {record.provider && (
                        <p className="text-sm text-muted-foreground">
                          {record.provider}
                        </p>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2">
                <DialogClose
                  render={<Button variant="outline" disabled={isSubmitting} />}
                >
                  Cancelar
                </DialogClose>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateMode(true)}
                  disabled={isSubmitting}
                >
                  Novo treinamento
                </Button>
              </div>

              <Button
                type="button"
                disabled={selectedTrainingIds.length === 0 || isSubmitting}
                onClick={() =>
                  assignTrainingMutation.mutate(selectedTrainingIds)
                }
              >
                {isSubmitting ? 'Processando...' : 'Atribuir Selecionados'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
