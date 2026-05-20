import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import { calibraApi } from '@/utils/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/dashboard/customer-success')({
  head: () => ({
    meta: [{ title: 'Customer Success | CalibraFácil' }],
  }),
  component: CustomerSuccessPage,
})

type OnboardingStatus =
  | 'NOT_STARTED'
  | 'DISCOVERY'
  | 'CONFIGURATION'
  | 'TRAINING'
  | 'LIVE'
  | 'BLOCKED'

type MigrationStatus =
  | 'NOT_REQUIRED'
  | 'PLANNING'
  | 'IN_PROGRESS'
  | 'VALIDATION'
  | 'COMPLETED'
  | 'BLOCKED'

type GoLiveStatus = 'NOT_SCHEDULED' | 'SCHEDULED' | 'AT_RISK' | 'LIVE'

type SupportPolicy = {
  supportMode: 'standard' | 'priority' | 'dedicated'
  hasPrioritySupport: boolean
  targetFirstResponseBusinessHours: number
  targetResolutionLabel: string
  includesAssistedOnboarding: boolean
  includesAssistedMigration: boolean
}

type WorkflowState = 'INACTIVE' | 'ACTIVE' | 'BLOCKED' | 'AT_RISK' | 'COMPLETED'
type SupportWorkflowState = 'IDLE' | 'ACTIVE' | 'AT_RISK' | 'ESCALATED'
type AccountOwnershipStatus = 'UNASSIGNED' | 'ASSIGNED' | 'AT_RISK'
type WorkflowWarningCode =
  | 'ACTIVE_BLOCKERS'
  | 'GO_LIVE_AT_RISK'
  | 'ONBOARDING_NOT_INCLUDED_IN_PLAN'
  | 'MIGRATION_NOT_INCLUDED_IN_PLAN'
  | 'NEXT_ACTION_DUE_SOON'
  | 'NEXT_ACTION_OVERDUE'
  | 'SLA_DUE_SOON'
  | 'SLA_BREACHED'
  | 'ESCALATION_REQUIRED'
type WorkflowViolationCode = 'MISSING_INTERNAL_OWNER' | 'MISSING_NEXT_ACTION'

type WorkflowIssue<TCode extends string> = {
  code: TCode
  message: string
}

type WorkflowPolicy = {
  supportMode: SupportPolicy['supportMode']
  effectiveSlaTier: 'PLAN_DEFAULT' | 'PRIORITY' | 'DEDICATED'
  prioritySupport: boolean
  targetFirstResponseBusinessHours: number
  dueSoonThresholdBusinessHours: number
  includesAssistedOnboarding: boolean
  includesAssistedMigration: boolean
  requiresInternalOwnerForActiveWorkflows: boolean
  requiresNextActionForActiveWorkflows: boolean
}

type WorkflowSummary = {
  accountOwnershipStatus: AccountOwnershipStatus
  onboardingState: WorkflowState
  migrationState: WorkflowState
  supportState: SupportWorkflowState
  goLiveState: WorkflowState
  hasActiveDeliveryWorkflows: boolean
  hasActiveSupportWorkflow: boolean
  hasActiveWorkflows: boolean
  warnings: WorkflowIssue<WorkflowWarningCode>[]
  violations: WorkflowIssue<WorkflowViolationCode>[]
  policy: WorkflowPolicy
}

type SuccessProfileResponse = {
  profile: {
    id: number
    organizationId: string
    accountOwnerName: string | null
    accountOwnerEmail: string | null
    supportContactEmail: string | null
    onboardingStatus: OnboardingStatus
    migrationStatus: MigrationStatus
    goLiveStatus: GoLiveStatus
    goLiveTargetDate: string | null
    goLiveActualDate: string | null
    publicStatusNote: string | null
    internalNotes: string | null
  }
  publicSummary: {
    healthStatus: 'HEALTHY' | 'ATTENTION' | 'CRITICAL'
    onboardingStatus: OnboardingStatus
    migrationStatus: MigrationStatus
    goLiveStatus: GoLiveStatus
    nextActionStatus: 'NONE' | 'PENDING' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED'
    hasActiveBlockers: boolean
  }
  supportPolicy: SupportPolicy
  plan: {
    id: string
    name: string
    status: string
  }
  workflow: WorkflowSummary
  workflowWarnings: WorkflowIssue<WorkflowWarningCode>[]
  workflowViolations: WorkflowIssue<WorkflowViolationCode>[]
  policy: WorkflowPolicy
}

type SupportRequest = {
  id: number
  category: string
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_CUSTOMER' | 'RESOLVED' | 'CLOSED'
  subject: string
  description: string
  publicResponse: string | null
  slaTargetAt: string | null
  firstResponseAt: string | null
  resolvedAt: string | null
  slaStatus: 'ON_TRACK' | 'DUE_SOON' | 'BREACHED' | 'RESOLVED'
  timeToSlaMs: number | null
  prioritySupport: boolean
  createdAt: string
  requestedByUser: {
    id: string
    name: string
    email: string
  } | null
  assignedToUser: {
    id: string
    name: string
    email: string
  } | null
  events: Array<{
    id?: number
    kind: string
    message: string
    publicVisible: boolean
    createdAt: string
    actorUser: {
      id: string
      name: string
      email: string
    } | null
  }>
}

type SupportRequestsResponse = {
  data: SupportRequest[]
}

const onboardingSteps: Record<OnboardingStatus, number> = {
  NOT_STARTED: 0,
  DISCOVERY: 20,
  CONFIGURATION: 45,
  TRAINING: 75,
  LIVE: 100,
  BLOCKED: 50,
}

const migrationSteps: Record<MigrationStatus, number> = {
  NOT_REQUIRED: 0,
  PLANNING: 20,
  IN_PROGRESS: 55,
  VALIDATION: 80,
  COMPLETED: 100,
  BLOCKED: 50,
}

const onboardingLabels: Record<OnboardingStatus, string> = {
  NOT_STARTED: 'Não iniciado',
  DISCOVERY: 'Discovery',
  CONFIGURATION: 'Configuração',
  TRAINING: 'Treinamento',
  LIVE: 'Em produção',
  BLOCKED: 'Bloqueado',
}

const migrationLabels: Record<MigrationStatus, string> = {
  NOT_REQUIRED: 'Não necessário',
  PLANNING: 'Planejamento',
  IN_PROGRESS: 'Em andamento',
  VALIDATION: 'Validação',
  COMPLETED: 'Concluído',
  BLOCKED: 'Bloqueado',
}

const goLiveLabels: Record<GoLiveStatus, string> = {
  NOT_SCHEDULED: 'Sem data',
  SCHEDULED: 'Agendado',
  AT_RISK: 'Em risco',
  LIVE: 'Em produção',
}

const healthLabels: Record<
  SuccessProfileResponse['publicSummary']['healthStatus'],
  string
> = {
  HEALTHY: 'Saudável',
  ATTENTION: 'Atenção',
  CRITICAL: 'Crítico',
}

const nextActionLabels: Record<
  SuccessProfileResponse['publicSummary']['nextActionStatus'],
  string
> = {
  NONE: 'Sem próximo passo público',
  PENDING: 'Próximo passo em andamento',
  DUE_SOON: 'Próximo passo em vencimento',
  OVERDUE: 'Próximo passo atrasado',
  COMPLETED: 'Último passo concluído',
}

const workflowStateLabels: Record<WorkflowState, string> = {
  INACTIVE: 'Inativo',
  ACTIVE: 'Ativo',
  BLOCKED: 'Bloqueado',
  AT_RISK: 'Em risco',
  COMPLETED: 'Concluído',
}

const supportWorkflowStateLabels: Record<SupportWorkflowState, string> = {
  IDLE: 'Sem fila ativa',
  ACTIVE: 'Em operação',
  AT_RISK: 'Exige atenção',
  ESCALATED: 'Escalado',
}

const ownershipStatusLabels: Record<AccountOwnershipStatus, string> = {
  UNASSIGNED: 'Sem owner interno',
  ASSIGNED: 'Owner definido',
  AT_RISK: 'Sem owner em workflow ativo',
}

const slaStatusLabels: Record<SupportRequest['slaStatus'], string> = {
  ON_TRACK: 'Dentro do SLA',
  DUE_SOON: 'SLA vencendo',
  BREACHED: 'SLA violado',
  RESOLVED: 'Resolvido',
}

const requestStatusLabels: Record<SupportRequest['status'], string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Em andamento',
  WAITING_ON_CUSTOMER: 'Aguardando laboratório',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
}

const priorityLabels: Record<SupportRequest['priority'], string> = {
  LOW: 'Baixa',
  NORMAL: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

function formatDate(value: string | null) {
  if (!value) return 'Não definido'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatRelativeSla(value: number | null) {
  if (value === null) return 'Sem SLA definido'

  const absoluteHours = Math.round(Math.abs(value) / (60 * 60 * 1000))
  if (value <= 0) return `${absoluteHours}h em atraso`
  if (absoluteHours < 24) return `${absoluteHours}h restantes`
  return `${Math.round(absoluteHours / 24)}d restantes`
}

function getWorkflowBadgeVariant(
  status: WorkflowState | SupportWorkflowState | AccountOwnershipStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'BLOCKED':
    case 'ESCALATED':
    case 'AT_RISK':
      return 'destructive'
    case 'ACTIVE':
      return 'default'
    case 'COMPLETED':
    case 'ASSIGNED':
      return 'secondary'
    default:
      return 'outline'
  }
}

function CustomerSuccessPage() {
  const queryClient = useQueryClient()
  const { data: activeOrg } = useActiveOrganization()
  const [draft, setDraft] = useState({
    category: 'GENERAL',
    priority: 'NORMAL',
    subject: '',
    description: '',
  })

  const profileQuery = useQuery({
    queryKey: ['customer-success', 'profile'],
    queryFn: async () =>
      calibraApi.customerSuccess.getProfile<SuccessProfileResponse>(),
  })

  const requestsQuery = useQuery({
    queryKey: ['customer-success', 'requests'],
    queryFn: async () =>
      calibraApi.customerSuccess.listRequests<SupportRequestsResponse>(),
  })

  const createRequestMutation = useMutation({
    mutationFn: async () =>
      calibraApi.customerSuccess.createRequest({
        category: draft.category as
          | 'GENERAL'
          | 'TRAINING'
          | 'MIGRATION'
          | 'INTEGRATION'
          | 'BILLING'
          | 'INCIDENT',
        priority: draft.priority as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT',
        subject: draft.subject,
        description: draft.description,
      }),
    onSuccess: async () => {
      toast.success('Solicitação criada')
      setDraft({
        category: 'GENERAL',
        priority: 'NORMAL',
        subject: '',
        description: '',
      })
      await queryClient.invalidateQueries({
        queryKey: ['customer-success', 'requests'],
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao abrir solicitação',
      )
    },
  })

  if (profileQuery.isLoading || requestsQuery.isLoading) {
    return <CustomerSuccessSkeleton />
  }

  if (profileQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Customer Success</CardTitle>
          <CardDescription>
            {profileQuery.error instanceof Error
              ? profileQuery.error.message
              : 'Falha ao carregar a área de Customer Success'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const payload = profileQuery.data
  if (!payload) {
    return <CustomerSuccessSkeleton />
  }

  const supportRequests = requestsQuery.data?.data ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Customer Success
          </h1>
          <p className="text-muted-foreground">
            Acompanhe onboarding, migração e solicitações operacionais do seu
            laboratório.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Plano e SLA</CardTitle>
            <CardDescription>
              Política de suporte derivada do seu plano atual.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge>{payload.plan.name}</Badge>
              <Badge variant="outline">
                {payload.supportPolicy.supportMode === 'dedicated'
                  ? 'Atendimento dedicado'
                  : payload.supportPolicy.supportMode === 'priority'
                    ? 'Suporte prioritário'
                    : 'Suporte padrão'}
              </Badge>
              {payload.supportPolicy.hasPrioritySupport ? (
                <Badge>Priority support</Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Primeira resposta alvo em até{' '}
              <strong>
                {payload.supportPolicy.targetFirstResponseBusinessHours}h úteis
              </strong>
              . Resolução: {payload.supportPolicy.targetResolutionLabel}.
            </p>
            <Separator />
            <div className="space-y-1 text-sm">
              <p>
                <strong>SLA efetivo:</strong>{' '}
                {payload.policy.effectiveSlaTier === 'DEDICATED'
                  ? 'Dedicado'
                  : payload.policy.effectiveSlaTier === 'PRIORITY'
                    ? 'Prioritário'
                    : 'Padrão do plano'}
              </p>
              <p>
                <strong>Onboarding assistido:</strong>{' '}
                {payload.supportPolicy.includesAssistedOnboarding
                  ? 'Sim'
                  : 'Não'}
              </p>
              <p>
                <strong>Migração assistida:</strong>{' '}
                {payload.supportPolicy.includesAssistedMigration
                  ? 'Sim'
                  : 'Não'}
              </p>
              <p>
                <strong>Owner interno exigido em workflow ativo:</strong>{' '}
                {payload.policy.requiresInternalOwnerForActiveWorkflows
                  ? 'Sim'
                  : 'Não'}
              </p>
              <p>
                <strong>Limiar de alerta de SLA:</strong>{' '}
                {payload.policy.dueSoonThresholdBusinessHours}h úteis
              </p>
              <p>
                <strong>Próxima ação exigida em workflow ativo:</strong>{' '}
                {payload.policy.requiresNextActionForActiveWorkflows
                  ? 'Sim'
                  : 'Não'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contato da Conta</CardTitle>
            <CardDescription>
              Referência atual para relacionamento operacional.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <strong>Organização:</strong> {activeOrg?.name ?? 'Laboratório'}
            </p>
            <p>
              <strong>Account owner:</strong>{' '}
              {payload.profile.accountOwnerName ?? 'A definir'}
            </p>
            <p>
              <strong>Email do owner:</strong>{' '}
              {payload.profile.accountOwnerEmail ?? 'A definir'}
            </p>
            <p>
              <strong>Contato de suporte:</strong>{' '}
              {payload.profile.supportContactEmail ?? 'A definir'}
            </p>
            {!payload.profile.accountOwnerName &&
            !payload.profile.accountOwnerEmail &&
            !payload.profile.supportContactEmail ? (
              <>
                <Separator />
                <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
                  Esses campos são geridos pela equipe da plataforma no
                  backoffice. Quando ainda não houver owner ou contato
                  operacional definidos, esta área exibirá{' '}
                  <strong>A definir</strong>.
                </div>
              </>
            ) : null}
            {payload.profile.publicStatusNote ? (
              <>
                <Separator />
                <p className="text-muted-foreground">
                  {payload.profile.publicStatusNote}
                </p>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Postura da Conta</CardTitle>
            <CardDescription>
              Resumo público do momento operacional do laboratório.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {healthLabels[payload.publicSummary.healthStatus]}
              </Badge>
              <Badge variant="outline">
                {nextActionLabels[payload.publicSummary.nextActionStatus]}
              </Badge>
              <Badge
                variant={getWorkflowBadgeVariant(
                  payload.workflow.accountOwnershipStatus,
                )}
              >
                {ownershipStatusLabels[payload.workflow.accountOwnershipStatus]}
              </Badge>
              {payload.publicSummary.hasActiveBlockers ? (
                <Badge>Existem dependências ativas</Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Onboarding:{' '}
              {onboardingLabels[payload.publicSummary.onboardingStatus]} ·
              Migração: {migrationLabels[payload.publicSummary.migrationStatus]}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={getWorkflowBadgeVariant(
                  payload.workflow.onboardingState,
                )}
              >
                Onboarding{' '}
                {workflowStateLabels[payload.workflow.onboardingState]}
              </Badge>
              <Badge
                variant={getWorkflowBadgeVariant(
                  payload.workflow.migrationState,
                )}
              >
                Migração {workflowStateLabels[payload.workflow.migrationState]}
              </Badge>
              <Badge
                variant={getWorkflowBadgeVariant(payload.workflow.supportState)}
              >
                Suporte{' '}
                {supportWorkflowStateLabels[payload.workflow.supportState]}
              </Badge>
            </div>
            {payload.workflowViolations.length > 0 ? (
              <div className="rounded-lg border border-dashed border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p className="font-medium text-destructive">Ações requeridas</p>
                <div className="mt-2 space-y-1 text-muted-foreground">
                  {payload.workflowViolations.map((issue) => (
                    <p key={issue.code}>{issue.message}</p>
                  ))}
                </div>
              </div>
            ) : null}
            {payload.workflowWarnings.length > 0 ? (
              <div className="rounded-lg border border-dashed p-3 text-sm">
                <p className="font-medium">Alertas operacionais</p>
                <div className="mt-2 space-y-1 text-muted-foreground">
                  {payload.workflowWarnings.slice(0, 3).map((issue) => (
                    <p key={issue.code}>{issue.message}</p>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Datas de Go-live</CardTitle>
            <CardDescription>
              Marco planejado e data real de entrada em produção.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {goLiveLabels[payload.profile.goLiveStatus]}
              </Badge>
              <Badge
                variant={getWorkflowBadgeVariant(payload.workflow.goLiveState)}
              >
                {workflowStateLabels[payload.workflow.goLiveState]}
              </Badge>
            </div>
            <p>
              <strong>Meta:</strong>{' '}
              {formatDate(payload.profile.goLiveTargetDate)}
            </p>
            <p>
              <strong>Real:</strong>{' '}
              {formatDate(payload.profile.goLiveActualDate)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Onboarding Assistido</CardTitle>
            <CardDescription>
              Pipeline simples de ativação por organização.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>{onboardingLabels[payload.profile.onboardingStatus]}</span>
              <Badge variant="outline">
                {onboardingSteps[payload.profile.onboardingStatus]}%
              </Badge>
            </div>
            <Progress
              value={onboardingSteps[payload.profile.onboardingStatus]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Migração Assistida</CardTitle>
            <CardDescription>
              Acompanhamento do estado da migração por organização.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>{migrationLabels[payload.profile.migrationStatus]}</span>
              <Badge variant="outline">
                {migrationSteps[payload.profile.migrationStatus]}%
              </Badge>
            </div>
            <Progress value={migrationSteps[payload.profile.migrationStatus]} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Solicitações Operacionais</CardTitle>
            <CardDescription>
              Pedidos simples de suporte, treinamento, migração e integrações.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {supportRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma solicitação aberta até o momento.
              </p>
            ) : (
              supportRequests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-lg border p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{request.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        #{request.id} • {request.category}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {requestStatusLabels[request.status]}
                      </Badge>
                      <Badge>{priorityLabels[request.priority]}</Badge>
                      <Badge variant="outline">
                        {slaStatusLabels[request.slaStatus]}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {request.description}
                  </p>
                  <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
                    <span>
                      SLA alvo: {formatDate(request.slaTargetAt)} ·{' '}
                      {formatRelativeSla(request.timeToSlaMs)}
                    </span>
                    <span>
                      Primeira resposta: {formatDate(request.firstResponseAt)}
                    </span>
                    <span>
                      Resolvido: {formatDate(request.resolvedAt)}
                      {request.prioritySupport ? ' · Priority support' : ''}
                    </span>
                  </div>
                  {request.events.length > 0 ? (
                    <div className="space-y-2 border-t pt-3">
                      {request.events.map((event, index) => (
                        <div
                          key={`${request.id}-${index}-${event.createdAt}`}
                          className="text-sm"
                        >
                          <p>{event.message}</p>
                          <p className="text-xs text-muted-foreground">
                            {event.actorUser?.name ?? 'Sistema'} •{' '}
                            {formatDate(event.createdAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Abrir Solicitação</CardTitle>
            <CardDescription>
              Use esta área para pedidos operacionais simples.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                createRequestMutation.mutate()
              }}
            >
              <FieldGroup>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Categoria</FieldLabel>
                    <NativeSelect
                      value={draft.category}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          category: event.target.value,
                        }))
                      }
                    >
                      <NativeSelectOption value="GENERAL">
                        Geral
                      </NativeSelectOption>
                      <NativeSelectOption value="TRAINING">
                        Treinamento
                      </NativeSelectOption>
                      <NativeSelectOption value="MIGRATION">
                        Migração
                      </NativeSelectOption>
                      <NativeSelectOption value="INTEGRATION">
                        Integração
                      </NativeSelectOption>
                      <NativeSelectOption value="BILLING">
                        Faturamento
                      </NativeSelectOption>
                      <NativeSelectOption value="INCIDENT">
                        Incidente
                      </NativeSelectOption>
                    </NativeSelect>
                  </Field>

                  <Field>
                    <FieldLabel>Prioridade</FieldLabel>
                    <NativeSelect
                      value={draft.priority}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          priority: event.target.value,
                        }))
                      }
                    >
                      <NativeSelectOption value="LOW">Baixa</NativeSelectOption>
                      <NativeSelectOption value="NORMAL">
                        Normal
                      </NativeSelectOption>
                      <NativeSelectOption value="HIGH">Alta</NativeSelectOption>
                      <NativeSelectOption value="URGENT">
                        Urgente
                      </NativeSelectOption>
                    </NativeSelect>
                  </Field>
                </div>

                <Field>
                  <FieldLabel>Assunto</FieldLabel>
                  <Input
                    value={draft.subject}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        subject: event.target.value,
                      }))
                    }
                    placeholder="Ex.: Onboarding do time técnico"
                  />
                </Field>

                <Field>
                  <FieldLabel>Descrição</FieldLabel>
                  <Textarea
                    rows={6}
                    value={draft.description}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Descreva o pedido operacional com contexto suficiente."
                  />
                  <FieldDescription>
                    Não é um help desk completo; use para pedidos operacionais,
                    migração e alinhamentos de onboarding.
                  </FieldDescription>
                </Field>
              </FieldGroup>

              <Button
                type="submit"
                disabled={createRequestMutation.isPending}
                className="w-full"
              >
                {createRequestMutation.isPending
                  ? 'Enviando...'
                  : 'Abrir solicitação'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function CustomerSuccessSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-72" />
      <div className="grid gap-6 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-48 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  )
}
