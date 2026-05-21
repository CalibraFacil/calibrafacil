import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import { CustomerSuccessAccountTimeline } from '@/components/customer-success-account-timeline'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  useAssignRequest,
  useBlocker,
  useEscalateRequest,
  useNextAction,
  useOrganizationProfile,
  useOrganizationRequests,
  useRespondRequest,
  useTakeOwnership,
  useUpdateProfile,
  useUpdateRequestStatus,
} from './hooks'
import {
  blockerScopeLabels,
  createProfileDraft,
  DEFAULT_PROFILE_DRAFT,
  formatDateTime,
  formatRelativeSla,
  getHealthBadgeVariant,
  getNextActionBadgeVariant,
  getPriorityBadgeVariant,
  getSlaBadgeVariant,
  getWorkflowBadgeVariant,
  goLiveLabels,
  healthLabels,
  migrationLabels,
  nextActionStatusLabels,
  onboardingLabels,
  ownershipStatusLabels,
  requestPriorityLabels,
  requestStatusLabels,
  slaStatusLabels,
  slaTierLabels,
  supportWorkflowStateLabels,
  workflowStateLabels,
  type BlockerScope,
  type ProfileDraft,
} from './model'

export function AccountWorkspace(props: {
  organizationId: string
  sessionUserId?: string
}) {
  const profileQuery = useOrganizationProfile(props.organizationId)
  const requestsQuery = useOrganizationRequests(props.organizationId)
  const updateProfileMutation = useUpdateProfile(props.organizationId)
  const nextActionMutation = useNextAction(props.organizationId)
  const blockerMutation = useBlocker(props.organizationId)
  const takeOwnershipMutation = useTakeOwnership(
    props.organizationId,
    props.sessionUserId,
  )
  const assignMutation = useAssignRequest(props.organizationId)
  const respondMutation = useRespondRequest(props.organizationId)
  const updateStatusMutation = useUpdateRequestStatus(props.organizationId)
  const escalateMutation = useEscalateRequest(props.organizationId)
  const [profileDraftSource, setProfileDraftSource] =
    useState<typeof profileQuery.data>(undefined)
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(
    DEFAULT_PROFILE_DRAFT,
  )
  const [responseDrafts, setResponseDrafts] = useState<Record<number, string>>(
    {},
  )
  const [blockerScopeDraft, setBlockerScopeDraft] =
    useState<BlockerScope>('ONBOARDING')
  const [blockerReasonDraft, setBlockerReasonDraft] = useState('')

  if (profileQuery.data && profileQuery.data !== profileDraftSource) {
    setProfileDraftSource(profileQuery.data)
    setProfileDraft(createProfileDraft(profileQuery.data))
  }

  if (profileQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Skeleton className="h-[720px] w-full" />
          <Skeleton className="h-[720px] w-full" />
        </div>
      </div>
    )
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <div className="rounded-xl border border-dashed border-destructive/40 bg-destructive/5 p-8 text-sm text-destructive">
        {profileQuery.error instanceof Error
          ? profileQuery.error.message
          : 'Falha ao carregar detalhe da conta'}
      </div>
    )
  }

  const profileData = profileQuery.data
  const organizationRequests = requestsQuery.data?.data ?? []
  const summary = profileData.operationalSummary

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <Button
            render={<Link to="/backoffice/customer-success" />}
            size="sm"
            variant="outline"
          >
            Voltar ao board
          </Button>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {profileData.organization.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {profileData.organization.slug}
            </p>
          </div>
        </div>

        <div className="flex max-w-3xl flex-wrap gap-2 lg:justify-end">
          <Badge variant={getHealthBadgeVariant(summary.healthStatus)}>
            {healthLabels[summary.healthStatus]}
          </Badge>
          <Badge variant="outline">{goLiveLabels[summary.goLiveStatus]}</Badge>
          <Badge variant="outline">
            SLA {slaTierLabels[summary.effectiveSlaTier]}
          </Badge>
          <Badge
            variant={getWorkflowBadgeVariant(
              profileData.workflow.accountOwnershipStatus,
            )}
          >
            {ownershipStatusLabels[profileData.workflow.accountOwnershipStatus]}
          </Badge>
          {summary.prioritySupport ? <Badge>Priority support</Badge> : null}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Tickets abertos" value={summary.openRequestsCount} />
        <Metric label="SLA vencendo" value={summary.dueSoonRequestsCount} />
        <Metric label="SLA violado" value={summary.breachedRequestsCount} />
        <Metric label="Escalados" value={summary.escalatedRequestsCount} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Estado operacional</CardTitle>
              <CardDescription>
                Owner, workflow, próxima ação, bloqueios e comunicação da conta.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <WorkflowBadge
                  label="Onboarding"
                  value={
                    workflowStateLabels[profileData.workflow.onboardingState]
                  }
                  variant={getWorkflowBadgeVariant(
                    profileData.workflow.onboardingState,
                  )}
                />
                <WorkflowBadge
                  label="Migração"
                  value={
                    workflowStateLabels[profileData.workflow.migrationState]
                  }
                  variant={getWorkflowBadgeVariant(
                    profileData.workflow.migrationState,
                  )}
                />
                <WorkflowBadge
                  label="Go-live"
                  value={workflowStateLabels[profileData.workflow.goLiveState]}
                  variant={getWorkflowBadgeVariant(
                    profileData.workflow.goLiveState,
                  )}
                />
                <WorkflowBadge
                  label="Suporte"
                  value={
                    supportWorkflowStateLabels[
                      profileData.workflow.supportState
                    ]
                  }
                  variant={getWorkflowBadgeVariant(
                    profileData.workflow.supportState,
                  )}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium">Próxima ação</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {profileData.profile.nextAction ?? 'Nenhuma ação definida'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge
                      variant={getNextActionBadgeVariant(
                        summary.nextActionStatus,
                      )}
                    >
                      {nextActionStatusLabels[summary.nextActionStatus]}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Prazo: {formatDateTime(profileData.profile.nextActionDueAt)}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium">Responsável interno</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {profileData.internalOwnerUser?.name ?? 'Não definido'}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Owner externo:{' '}
                    {profileData.profile.accountOwnerName ?? 'Não definido'}
                  </p>
                </div>
              </div>

              {profileData.workflowViolations.length > 0 ? (
                <Notice tone="destructive" title="Ações requeridas">
                  {profileData.workflowViolations.map((issue) => (
                    <p key={issue.code}>{issue.message}</p>
                  ))}
                </Notice>
              ) : null}

              {profileData.workflowWarnings.length > 0 ? (
                <Notice title="Alertas do workflow">
                  {profileData.workflowWarnings.map((issue) => (
                    <p key={issue.code}>{issue.message}</p>
                  ))}
                </Notice>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {summary.workstreams.map((item) => (
                  <Badge key={item} variant="outline">
                    {item}
                  </Badge>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => takeOwnershipMutation.mutate()}
                  disabled={takeOwnershipMutation.isPending}
                >
                  Assumir conta
                </Button>
                {profileData.profile.nextAction ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      nextActionMutation.mutate({
                        nextAction: profileDraft.nextAction,
                        nextActionDueAt: profileDraft.nextActionDueAt,
                        markCompleted: true,
                      })
                    }
                    disabled={nextActionMutation.isPending}
                  >
                    Concluir próxima ação
                  </Button>
                ) : null}
              </div>

              {summary.blockers.length > 0 ? (
                <div className="space-y-2 rounded-lg border border-dashed p-4">
                  <p className="text-sm font-medium">Bloqueios ativos</p>
                  {summary.blockers.map((blocker) => (
                    <div
                      key={blocker.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div>
                        <p className="font-medium">
                          {blockerScopeLabels[blocker.scope]}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {blocker.reason}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          blockerMutation.mutate({
                            scope: blocker.scope,
                            mode: 'RESOLVE',
                          })
                        }
                        disabled={blockerMutation.isPending}
                      >
                        Resolver
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Postura da conta</CardTitle>
              <CardDescription>
                Atualize os campos que governam workflow, saúde e comunicação.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault()
                  updateProfileMutation.mutate(profileDraft)
                }}
              >
                <FieldGroup>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel>Plano</FieldLabel>
                      <Input value={profileData.plan.name} disabled />
                    </Field>
                    <Field>
                      <FieldLabel>Modo de suporte</FieldLabel>
                      <Input
                        value={profileData.supportPolicy.supportMode}
                        disabled
                      />
                      <FieldDescription>
                        Primeira resposta:{' '}
                        {profileData.policy.targetFirstResponseBusinessHours}h
                        úteis
                      </FieldDescription>
                    </Field>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <DraftInput
                      label="Owner da conta"
                      value={profileDraft.accountOwnerName}
                      onChange={(accountOwnerName) =>
                        setProfileDraft((current) => ({
                          ...current,
                          accountOwnerName,
                        }))
                      }
                    />
                    <DraftInput
                      label="Email do owner"
                      type="email"
                      value={profileDraft.accountOwnerEmail}
                      onChange={(accountOwnerEmail) =>
                        setProfileDraft((current) => ({
                          ...current,
                          accountOwnerEmail,
                        }))
                      }
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <DraftInput
                      label="Contato de suporte"
                      type="email"
                      value={profileDraft.supportContactEmail}
                      onChange={(supportContactEmail) =>
                        setProfileDraft((current) => ({
                          ...current,
                          supportContactEmail,
                        }))
                      }
                    />
                    <Field>
                      <FieldLabel>Owner interno</FieldLabel>
                      <NativeSelect
                        value={profileDraft.internalOwnerUserId}
                        onChange={(event) =>
                          setProfileDraft((current) => ({
                            ...current,
                            internalOwnerUserId: event.target.value,
                          }))
                        }
                      >
                        <NativeSelectOption value="">
                          Sem owner
                        </NativeSelectOption>
                        {profileData.operators.map((operator) => (
                          <NativeSelectOption
                            key={operator.id}
                            value={operator.id}
                          >
                            {operator.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <DraftSelect
                      label="Onboarding"
                      options={onboardingLabels}
                      value={profileDraft.onboardingStatus}
                      onChange={(onboardingStatus) =>
                        setProfileDraft((current) => ({
                          ...current,
                          onboardingStatus,
                        }))
                      }
                    />
                    <DraftSelect
                      label="Migração"
                      options={migrationLabels}
                      value={profileDraft.migrationStatus}
                      onChange={(migrationStatus) =>
                        setProfileDraft((current) => ({
                          ...current,
                          migrationStatus,
                        }))
                      }
                    />
                    <DraftSelect
                      label="Go-live"
                      options={goLiveLabels}
                      value={profileDraft.goLiveStatus}
                      onChange={(goLiveStatus) =>
                        setProfileDraft((current) => ({
                          ...current,
                          goLiveStatus,
                        }))
                      }
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <DraftSelect
                      label="Saúde"
                      options={healthLabels}
                      value={profileDraft.healthStatus}
                      onChange={(healthStatus) =>
                        setProfileDraft((current) => ({
                          ...current,
                          healthStatus,
                        }))
                      }
                    />
                    <DraftSelect
                      label="SLA da conta"
                      options={slaTierLabels}
                      value={profileDraft.slaTier}
                      onChange={(slaTier) =>
                        setProfileDraft((current) => ({
                          ...current,
                          slaTier,
                        }))
                      }
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <DraftInput
                      label="Meta de go-live"
                      type="date"
                      value={profileDraft.goLiveTargetDate}
                      onChange={(goLiveTargetDate) =>
                        setProfileDraft((current) => ({
                          ...current,
                          goLiveTargetDate,
                        }))
                      }
                    />
                    <DraftInput
                      label="Go-live real"
                      type="date"
                      value={profileDraft.goLiveActualDate}
                      onChange={(goLiveActualDate) =>
                        setProfileDraft((current) => ({
                          ...current,
                          goLiveActualDate,
                        }))
                      }
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                    <DraftInput
                      label="Próxima ação"
                      value={profileDraft.nextAction}
                      onChange={(nextAction) =>
                        setProfileDraft((current) => ({
                          ...current,
                          nextAction,
                        }))
                      }
                      placeholder="Ex.: validar migração e reagendar treinamento"
                    />
                    <DraftInput
                      label="Prazo"
                      type="date"
                      value={profileDraft.nextActionDueAt}
                      onChange={(nextActionDueAt) =>
                        setProfileDraft((current) => ({
                          ...current,
                          nextActionDueAt,
                        }))
                      }
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => nextActionMutation.mutate(profileDraft)}
                      disabled={nextActionMutation.isPending}
                    >
                      Atualizar próxima ação
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        nextActionMutation.mutate({
                          ...profileDraft,
                          markCompleted: true,
                        })
                      }
                      disabled={
                        nextActionMutation.isPending || !profileDraft.nextAction
                      }
                    >
                      Concluir ação atual
                    </Button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-[0.7fr_1.3fr_auto] md:items-end">
                    <DraftSelect
                      label="Bloqueio"
                      options={blockerScopeLabels}
                      value={blockerScopeDraft}
                      onChange={setBlockerScopeDraft}
                    />
                    <DraftInput
                      label="Motivo do bloqueio"
                      value={blockerReasonDraft}
                      onChange={setBlockerReasonDraft}
                      placeholder="Ex.: aguardando base validada"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        blockerMutation.mutate({
                          scope: blockerScopeDraft,
                          mode: 'ADD',
                          reason: blockerReasonDraft,
                        })
                      }
                      disabled={
                        blockerMutation.isPending || !blockerReasonDraft.trim()
                      }
                    >
                      Registrar
                    </Button>
                  </div>

                  <Field>
                    <FieldLabel>Priority support</FieldLabel>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={profileDraft.prioritySupport}
                        onCheckedChange={(prioritySupport) =>
                          setProfileDraft((current) => ({
                            ...current,
                            prioritySupport,
                          }))
                        }
                      />
                      <FieldDescription>
                        Destaca a conta no board e antecipa o tratamento.
                      </FieldDescription>
                    </div>
                  </Field>

                  <Field>
                    <FieldLabel>Status público</FieldLabel>
                    <Textarea
                      rows={4}
                      value={profileDraft.publicStatusNote}
                      onChange={(event) =>
                        setProfileDraft((current) => ({
                          ...current,
                          publicStatusNote: event.target.value,
                        }))
                      }
                    />
                  </Field>

                  <Field>
                    <FieldLabel>Notas internas</FieldLabel>
                    <Textarea
                      rows={5}
                      value={profileDraft.internalNotes}
                      onChange={(event) =>
                        setProfileDraft((current) => ({
                          ...current,
                          internalNotes: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </FieldGroup>

                <Button
                  type="submit"
                  disabled={updateProfileMutation.isPending}
                >
                  {updateProfileMutation.isPending
                    ? 'Salvando...'
                    : 'Salvar postura'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
              <CardDescription>
                Mudanças recentes de onboarding, suporte e postura.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {profileData.timeline.length ? (
                <CustomerSuccessAccountTimeline events={profileData.timeline} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma atividade operacional registrada.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tickets da conta</CardTitle>
              <CardDescription>
                Responda, atribua, mova status ou escale no contexto da conta.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {requestsQuery.isLoading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-40 w-full" />
                ))
              ) : requestsQuery.isError ? (
                <p className="text-sm text-destructive">
                  {requestsQuery.error instanceof Error
                    ? requestsQuery.error.message
                    : 'Falha ao carregar tickets'}
                </p>
              ) : organizationRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum ticket registrado para esta conta.
                </p>
              ) : (
                organizationRequests.map((request) => (
                  <div
                    key={request.id}
                    className="space-y-4 rounded-lg border p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium">{request.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          #{request.id} · {request.category} ·{' '}
                          {requestPriorityLabels[request.priority]}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge
                          variant={getPriorityBadgeVariant(request.priority)}
                        >
                          {requestPriorityLabels[request.priority]}
                        </Badge>
                        <Badge variant={getSlaBadgeVariant(request.slaStatus)}>
                          {slaStatusLabels[request.slaStatus]}
                        </Badge>
                        <Badge variant="outline">
                          {requestStatusLabels[request.status]}
                        </Badge>
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground">
                      {request.description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      SLA: {formatRelativeSla(request.timeToSlaMs)} ·
                      Responsável:{' '}
                      {request.assignedToUser?.name ?? 'Não atribuído'}
                    </p>

                    {request.needsEscalation || request.escalationReason ? (
                      <Notice title="Escalação" tone="destructive">
                        <p>
                          {request.escalationReason ??
                            'Este ticket precisa de acompanhamento prioritário.'}
                        </p>
                      </Notice>
                    ) : null}

                    <Field>
                      <FieldLabel>Resposta pública</FieldLabel>
                      <Textarea
                        rows={3}
                        value={responseDrafts[request.id] ?? ''}
                        onChange={(event) =>
                          setResponseDrafts((current) => ({
                            ...current,
                            [request.id]: event.target.value,
                          }))
                        }
                        placeholder="Resposta visível para o laboratório"
                      />
                    </Field>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          assignMutation.mutate({
                            requestId: request.id,
                            assignedToUserId: props.sessionUserId ?? null,
                          })
                        }
                        disabled={assignMutation.isPending}
                      >
                        Assumir
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          respondMutation.mutate({
                            requestId: request.id,
                            message: responseDrafts[request.id] ?? '',
                          })
                        }
                        disabled={respondMutation.isPending}
                      >
                        Responder
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateStatusMutation.mutate({
                            requestId: request.id,
                            status: 'WAITING_ON_CUSTOMER',
                          })
                        }
                      >
                        Aguardar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateStatusMutation.mutate({
                            requestId: request.id,
                            status: 'RESOLVED',
                          })
                        }
                      >
                        Resolver
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          escalateMutation.mutate({
                            requestId: request.id,
                            reason:
                              request.slaStatus === 'BREACHED'
                                ? 'Escalação automática do operador: ticket fora do SLA.'
                                : 'Escalação manual do operador para tratamento prioritário.',
                          })
                        }
                        disabled={
                          escalateMutation.isPending ||
                          Boolean(request.escalationReason)
                        }
                      >
                        Escalar
                      </Button>
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
                              {event.actorUser?.name ?? 'Sistema'} ·{' '}
                              {formatDateTime(event.createdAt)}
                              {event.publicVisible
                                ? ' · Público'
                                : ' · Interno'}
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
        </div>
      </div>
    </div>
  )
}

function Metric(props: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {props.label}
      </p>
      <p className="text-3xl font-semibold tracking-tight">{props.value}</p>
    </div>
  )
}

function WorkflowBadge(props: {
  label: string
  value: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
}) {
  return (
    <Badge variant={props.variant}>
      {props.label} {props.value}
    </Badge>
  )
}

function Notice(props: {
  title: string
  children: ReactNode
  tone?: 'default' | 'destructive'
}) {
  return (
    <div
      className={
        props.tone === 'destructive'
          ? 'rounded-lg border border-dashed border-destructive/40 bg-destructive/5 p-4 text-sm'
          : 'rounded-lg border border-dashed p-4 text-sm'
      }
    >
      <p
        className={
          props.tone === 'destructive'
            ? 'font-medium text-destructive'
            : 'font-medium'
        }
      >
        {props.title}
      </p>
      <div className="mt-2 space-y-1 text-muted-foreground">
        {props.children}
      </div>
    </div>
  )
}

function DraftInput(props: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <Field>
      <FieldLabel>{props.label}</FieldLabel>
      <Input
        type={props.type}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
      />
    </Field>
  )
}

function DraftSelect<TValue extends string>(props: {
  label: string
  value: TValue
  options: Record<TValue, string>
  onChange: (value: TValue) => void
}) {
  return (
    <Field>
      <FieldLabel>{props.label}</FieldLabel>
      <NativeSelect
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as TValue)}
      >
        {(Object.entries(props.options) as Array<[TValue, string]>).map(
          ([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ),
        )}
      </NativeSelect>
    </Field>
  )
}
