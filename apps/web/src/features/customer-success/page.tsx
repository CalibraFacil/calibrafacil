import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  Mail01Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import { calibraApi } from '@/utils/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  ACTION_BUTTON_CLASS,
  BlueprintOverlay,
  Panel,
  PanelHeader,
} from '@/components/instrument-panel'
import { cn } from '@/lib/utils'
import {
  useCustomerSuccessProfileData,
  useCustomerSuccessRequestsData,
} from '@/features/customer-success/queries'
import type {
  MigrationStatus,
  OnboardingStatus,
  SuccessProfileResponse,
  SupportRequest,
} from '@/features/customer-success/types'

type SupportRequestCategory =
  | 'GENERAL'
  | 'TRAINING'
  | 'MIGRATION'
  | 'INTEGRATION'
  | 'BILLING'
  | 'INCIDENT'

type SupportRequestPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

function toSupportRequestCategory(value: string): SupportRequestCategory {
  switch (value) {
    case 'TRAINING':
    case 'MIGRATION':
    case 'INTEGRATION':
    case 'BILLING':
    case 'INCIDENT':
      return value
    default:
      return 'GENERAL'
  }
}

function toSupportRequestPriority(value: string): SupportRequestPriority {
  switch (value) {
    case 'LOW':
    case 'HIGH':
    case 'URGENT':
      return value
    default:
      return 'NORMAL'
  }
}

const ONBOARDING_STEPS: ReadonlyArray<{
  status: OnboardingStatus
  label: string
}> = [
  { status: 'DISCOVERY', label: 'Discovery' },
  { status: 'CONFIGURATION', label: 'Configuração' },
  { status: 'TRAINING', label: 'Treinamento' },
  { status: 'LIVE', label: 'No ar' },
]

const ONBOARDING_INDEX: Record<OnboardingStatus, number> = {
  NOT_STARTED: -1,
  DISCOVERY: 0,
  CONFIGURATION: 1,
  TRAINING: 2,
  LIVE: 3,
  BLOCKED: -1,
}

const migrationSteps: Record<MigrationStatus, number> = {
  NOT_REQUIRED: 0,
  PLANNING: 20,
  IN_PROGRESS: 55,
  VALIDATION: 80,
  COMPLETED: 100,
  BLOCKED: 50,
}

const migrationLabels: Record<MigrationStatus, string> = {
  NOT_REQUIRED: 'Não necessária',
  PLANNING: 'Planejamento',
  IN_PROGRESS: 'Em andamento',
  VALIDATION: 'Validação',
  COMPLETED: 'Concluída',
  BLOCKED: 'Em pausa',
}

type HealthStatus = SuccessProfileResponse['publicSummary']['healthStatus']

const HEALTH: Record<
  HealthStatus,
  { label: string; dot: string; headline: string; note: string }
> = {
  HEALTHY: {
    label: 'Tudo em ordem',
    dot: 'bg-emerald-500',
    headline: 'Tudo em ordem por aqui.',
    note: 'Sua conta está saudável e no rumo certo.',
  },
  ATTENTION: {
    label: 'Atenção',
    dot: 'bg-amber-500',
    headline: 'Alguns pontos para alinhar.',
    note: 'Há detalhes em aberto — vamos resolver junto com você.',
  },
  CRITICAL: {
    label: 'Prioridade',
    dot: 'bg-destructive',
    headline: 'Estamos cuidando disso com você.',
    note: 'Há itens importantes em aberto. Pode contar com a gente.',
  },
}

const requestStatusLabels: Record<SupportRequest['status'], string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Em andamento',
  WAITING_ON_CUSTOMER: 'Aguardando você',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
}

const priorityLabels: Record<SupportRequest['priority'], string> = {
  LOW: 'Baixa',
  NORMAL: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

const slaStatusLabels: Record<SupportRequest['slaStatus'], string> = {
  ON_TRACK: 'Dentro do prazo',
  DUE_SOON: 'Prazo se aproximando',
  BREACHED: 'Prazo estourado',
  RESOLVED: 'Resolvido',
}

function requestStatusVariant(
  status: SupportRequest['status'],
): 'default' | 'secondary' | 'outline' {
  switch (status) {
    case 'IN_PROGRESS':
      return 'default'
    case 'RESOLVED':
    case 'CLOSED':
      return 'secondary'
    default:
      return 'outline'
  }
}

function formatDate(value: string | null) {
  if (!value) return 'Não definido'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatDay(value: string | null) {
  if (!value) return null
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(
    new Date(value),
  )
}

function formatRelativeSla(value: number | null) {
  if (value === null) return 'Sem prazo definido'

  const absoluteHours = Math.round(Math.abs(value) / (60 * 60 * 1000))
  if (value <= 0) return `${absoluteHours}h em atraso`
  if (absoluteHours < 24) return `${absoluteHours}h restantes`
  return `${Math.round(absoluteHours / 24)}d restantes`
}

function initialsOf(name: string | null | undefined) {
  if (!name) return 'CS'
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const initials = parts.map((part) => part[0]?.toUpperCase() ?? '').join('')
  return initials || 'CS'
}

function supportModeLabel(
  mode: SuccessProfileResponse['supportPolicy']['supportMode'],
) {
  return mode === 'dedicated'
    ? 'Atendimento dedicado'
    : mode === 'priority'
      ? 'Suporte prioritário'
      : 'Suporte padrão'
}

export function CustomerSuccessPage() {
  const queryClient = useQueryClient()
  const { data: activeOrg } = useActiveOrganization()
  const [requestDialogOpen, setRequestDialogOpen] = useState(false)
  const [draft, setDraft] = useState<{
    category: SupportRequestCategory
    priority: SupportRequestPriority
    subject: string
    description: string
  }>({
    category: 'GENERAL',
    priority: 'NORMAL',
    subject: '',
    description: '',
  })

  const profileQuery = useCustomerSuccessProfileData()
  const requestsQuery = useCustomerSuccessRequestsData()

  const createRequestMutation = useMutation({
    mutationFn: async () =>
      calibraApi.customerSuccess.createRequest({
        category: draft.category,
        priority: draft.priority,
        subject: draft.subject,
        description: draft.description,
      }),
    onSuccess: async () => {
      toast.success('Solicitação enviada — já estamos a caminho.')
      setDraft({
        category: 'GENERAL',
        priority: 'NORMAL',
        subject: '',
        description: '',
      })
      setRequestDialogOpen(false)
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
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : 'Falha ao carregar a área de Customer Success'}
        </p>
      </Panel>
    )
  }

  const payload = profileQuery.data
  if (!payload) {
    return <CustomerSuccessSkeleton />
  }

  const supportRequests = requestsQuery.data?.data ?? []
  const health = HEALTH[payload.publicSummary.healthStatus]
  // "Seu contato na CalibraFácil" is the internal owner (the CalibraFácil CS
  // manager), not the account owner (which is the lab's own contact).
  const ownerName = payload.profile.internalOwnerName
  const ownerEmail = payload.profile.internalOwnerEmail
  const onboardingStatus = payload.profile.onboardingStatus
  const onboardingIndex = ONBOARDING_INDEX[onboardingStatus]
  const isLive = onboardingStatus === 'LIVE'
  const isBlocked = onboardingStatus === 'BLOCKED'
  const migrationRequired = payload.profile.migrationStatus !== 'NOT_REQUIRED'
  const goLiveDay =
    formatDay(payload.profile.goLiveActualDate) ??
    formatDay(payload.profile.goLiveTargetDate)
  const goLiveLine = isLive
    ? goLiveDay
      ? `No ar desde ${goLiveDay}`
      : 'No ar'
    : goLiveDay
      ? `Previsto para ${goLiveDay}`
      : 'Data a definir com o seu contato'

  return (
    <div className="space-y-5">
      {/* The relationship */}
      <Panel className="relative overflow-hidden p-6 sm:p-8">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className={cn('size-2 rounded-full', health.dot)} />
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Customer Success · {health.label}
              </p>
            </div>
            <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              {health.headline}
            </h1>
            <p className="mt-2 text-pretty text-base text-muted-foreground">
              {payload.profile.publicStatusNote ?? health.note}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{payload.plan.name}</Badge>
              <Badge variant="secondary">
                {supportModeLabel(payload.supportPolicy.supportMode)}
              </Badge>
            </div>
          </div>

          {/* Your human contact */}
          <div className="w-full shrink-0 rounded-2xl bg-background/70 p-4 ring-1 ring-foreground/10 backdrop-blur lg:w-72">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Seu contato na CalibraFácil
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary">
                {initialsOf(ownerName)}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {ownerName ?? 'Equipe de Sucesso'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {ownerName ? 'Gerente de sucesso' : 'CalibraFácil'}
                </p>
              </div>
            </div>
            {ownerEmail && (
              <Button
                variant="outline"
                size="sm"
                className={`${ACTION_BUTTON_CLASS} mt-3 w-full`}
                render={<a href={`mailto:${ownerEmail}`} />}
              >
                <HugeiconsIcon icon={Mail01Icon} className="mr-2 size-4" />
                Falar com seu contato
              </Button>
            )}
          </div>
        </div>
      </Panel>

      {/* The journey */}
      <Panel className="p-6">
        <PanelHeader
          eyebrow="Sua jornada"
          title="Caminho até o go-live"
          description={goLiveLine}
        />

        {isBlocked && (
          <div className="mt-4 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300">
            Sua ativação está em pausa no momento — vamos destravar isso junto
            com você.
          </div>
        )}

        <ol className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-1">
          {ONBOARDING_STEPS.map((step, index) => {
            const done = isLive || index < onboardingIndex
            const current = !isLive && index === onboardingIndex
            return (
              <li
                key={step.status}
                className="flex flex-1 items-center gap-2 sm:flex-col sm:items-start"
              >
                <div className="flex w-full items-center gap-2">
                  <span
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors',
                      done
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : current
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {done ? (
                      <HugeiconsIcon
                        icon={CheckmarkCircle02Icon}
                        className="size-4"
                      />
                    ) : (
                      index + 1
                    )}
                  </span>
                  {index < ONBOARDING_STEPS.length - 1 && (
                    <span
                      className={cn(
                        'hidden h-px flex-1 sm:block',
                        done ? 'bg-emerald-500/40' : 'bg-border',
                      )}
                    />
                  )}
                </div>
                <div className="min-w-0 sm:mt-2">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      !done && !current && 'text-muted-foreground',
                    )}
                  >
                    {step.label}
                  </p>
                  {current && (
                    <p className="text-xs text-primary">Etapa atual</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>

        {migrationRequired && (
          <div className="mt-6 max-w-md space-y-1.5 border-t pt-5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">
                Migração de dados ·{' '}
                {migrationLabels[payload.profile.migrationStatus]}
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {migrationSteps[payload.profile.migrationStatus]}%
              </span>
            </div>
            <Progress value={migrationSteps[payload.profile.migrationStatus]} />
          </div>
        )}
      </Panel>

      {/* Getting help */}
      <Panel className="p-6">
        <PanelHeader
          eyebrow="Suporte"
          title="Precisa de ajuda?"
          description={`Primeira resposta em até ${payload.supportPolicy.targetFirstResponseBusinessHours}h úteis · ${payload.supportPolicy.targetResolutionLabel}.`}
          action={
            <Dialog
              open={requestDialogOpen}
              onOpenChange={setRequestDialogOpen}
            >
              <DialogTrigger
                render={
                  <Button className={ACTION_BUTTON_CLASS}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Abrir solicitação
                  </Button>
                }
              />
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Abrir solicitação</DialogTitle>
                  <DialogDescription>
                    Conte o que você precisa — onboarding, treinamento,
                    migração, integrações ou um incidente.
                  </DialogDescription>
                </DialogHeader>
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    createRequestMutation.mutate()
                  }}
                >
                  <FieldGroup>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel>Categoria</FieldLabel>
                        <NativeSelect
                          value={draft.category}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              category: toSupportRequestCategory(
                                event.target.value,
                              ),
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
                              priority: toSupportRequestPriority(
                                event.target.value,
                              ),
                            }))
                          }
                        >
                          <NativeSelectOption value="LOW">
                            Baixa
                          </NativeSelectOption>
                          <NativeSelectOption value="NORMAL">
                            Normal
                          </NativeSelectOption>
                          <NativeSelectOption value="HIGH">
                            Alta
                          </NativeSelectOption>
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
                        rows={5}
                        value={draft.description}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        placeholder="Descreva o pedido com o contexto necessário."
                      />
                      <FieldDescription>
                        Para pedidos operacionais, migração e alinhamentos de
                        onboarding.
                      </FieldDescription>
                    </Field>
                  </FieldGroup>

                  <DialogFooter>
                    <DialogClose
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          disabled={createRequestMutation.isPending}
                        />
                      }
                    >
                      Cancelar
                    </DialogClose>
                    <Button
                      type="submit"
                      className={ACTION_BUTTON_CLASS}
                      disabled={
                        createRequestMutation.isPending ||
                        !draft.subject.trim() ||
                        !draft.description.trim()
                      }
                    >
                      {createRequestMutation.isPending
                        ? 'Enviando...'
                        : 'Enviar solicitação'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          }
        />

        <div className="mt-5">
          {supportRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl bg-muted/30 px-6 py-12 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  className="size-5"
                />
              </span>
              <p className="mt-3 text-sm font-medium">
                Nenhuma solicitação aberta
              </p>
              <p className="mt-1 max-w-sm text-pretty text-sm text-muted-foreground">
                Está tudo tranquilo por aqui. Quando precisar, estamos a um
                clique de distância.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {supportRequests.map((request) => (
                <RequestItem key={request.id} request={request} />
              ))}
            </div>
          )}
        </div>
      </Panel>

      <p className="px-1 text-xs text-muted-foreground">
        {activeOrg?.name ?? 'Seu laboratório'} · acompanhe e fale com a equipe
        de sucesso da CalibraFácil por aqui.
      </p>
    </div>
  )
}

function RequestItem({ request }: { request: SupportRequest }) {
  const [open, setOpen] = useState(false)
  const hasThread = request.events.length > 0
  const isResolved =
    request.status === 'RESOLVED' || request.status === 'CLOSED'

  return (
    <div className="rounded-xl ring-1 ring-foreground/10">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium">{request.subject}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              #{request.id} · aberto em {formatDate(request.createdAt)}
            </p>
            <p className="mt-2 line-clamp-2 max-w-2xl text-pretty text-sm text-muted-foreground">
              {request.description}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Badge variant={requestStatusVariant(request.status)}>
              {requestStatusLabels[request.status]}
            </Badge>
            {!isResolved && (
              <Badge
                variant={
                  request.slaStatus === 'BREACHED' ? 'destructive' : 'outline'
                }
              >
                {slaStatusLabels[request.slaStatus]}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
          <span>
            Prioridade {priorityLabels[request.priority].toLowerCase()}
            {!isResolved &&
              request.timeToSlaMs !== null &&
              ` · ${formatRelativeSla(request.timeToSlaMs)}`}
            {request.resolvedAt &&
              ` · resolvido em ${formatDay(request.resolvedAt)}`}
          </span>
          {hasThread && (
            <CollapsibleTrigger className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-foreground transition-colors hover:bg-muted">
              {request.events.length} atualizaç
              {request.events.length === 1 ? 'ão' : 'ões'}
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className={cn(
                  'size-4 transition-transform duration-200',
                  open && 'rotate-180',
                )}
              />
            </CollapsibleTrigger>
          )}
        </div>

        {hasThread && (
          <CollapsibleContent>
            <div className="space-y-3 border-t px-4 py-3">
              {request.events.map((event, index) => (
                <div
                  key={`${request.id}-${index}-${event.createdAt}`}
                  className="flex gap-3"
                >
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                  <div className="min-w-0">
                    <p className="text-sm">{event.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {event.actorUser?.name ?? 'Equipe CalibraFácil'} ·{' '}
                      {formatDate(event.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  )
}

function CustomerSuccessSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-44 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  )
}
