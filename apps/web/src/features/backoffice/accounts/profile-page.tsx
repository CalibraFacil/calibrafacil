import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowLeft01Icon,
  ArrowRight02Icon,
  Coins01Icon,
  Database01Icon,
  Invoice02Icon,
  PlugSocketIcon,
  RefreshIcon,
  Structure01Icon,
  UserCheck01Icon,
} from '@hugeicons/core-free-icons'
import { useBackofficeSession } from '@calibra-facil/auth/client'

import { CustomerSuccessAccountTimeline } from '@/components/customer-success-account-timeline'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from '@/components/instrument-panel'
import { cn } from '@/lib/utils'
import {
  ConsoleEmpty,
  ConsolePageHeader,
  SectionPanel,
  StatusChip,
  status,
} from '@/features/backoffice/console'
import { AccountTasksCard } from '@/features/backoffice/tasks/components'
import { AccountLifecycleCard } from './lifecycle-card'
import {
  useBackofficeOrganizationDetailData,
  useBackofficeCommercialContextData,
} from '@/features/backoffice/queries'
import {
  useAssignRequest,
  useBlocker,
  useEscalateRequest,
  useNextAction,
  useOrganizationProfile,
  useOrganizationRequests,
  useRefreshCustomerSuccess,
  useRespondRequest,
  useTakeOwnership,
  useUpdateProfile,
  useUpdateRequestStatus,
} from '@/features/backoffice/customer-success/hooks'
import {
  blockerScopeLabels,
  createProfileDraft,
  formatDateTime,
  formatRelativeSla,
  goLiveLabels,
  healthLabels,
  migrationLabels,
  onboardingLabels,
  slaTierLabels,
  type BlockerScope,
  type ProfileDraft,
  type ProfilePayload,
  type SupportRequest,
} from '@/features/backoffice/customer-success/model'

const COMMERCIAL_STATUS_TONE: Record<string, SignalTone> = {
  DRAFT: 'neutral',
  PENDING: 'info',
  ISSUED: 'info',
  ACCEPTED: 'ok',
  PAID: 'ok',
  EXPIRED: 'warning',
  CANCELLED: 'neutral',
  REJECTED: 'critical',
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

export function AccountProfilePage({ id }: { id: string }) {
  const profileQuery = useOrganizationProfile(id)
  const requestsQuery = useOrganizationRequests(id)
  const detailQuery = useBackofficeOrganizationDetailData(id)
  const commercialQuery = useBackofficeCommercialContextData(id)
  const refresh = useRefreshCustomerSuccess(id)
  const session = useBackofficeSession()
  const userId = session.data?.user?.id

  if (profileQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <Skeleton className="h-[560px] w-full rounded-2xl" />
          <Skeleton className="h-[560px] w-full rounded-2xl" />
        </div>
      </div>
    )
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <div className="space-y-4">
        <Button
          render={<Link to="/backoffice/accounts" />}
          size="sm"
          variant="outline"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
          Voltar para contas
        </Button>
        <ConsoleEmpty
          icon={Alert02Icon}
          title="Não foi possível carregar a conta"
          description={
            profileQuery.error instanceof Error
              ? profileQuery.error.message
              : 'Tente atualizar a página.'
          }
        />
      </div>
    )
  }

  return (
    <AccountProfile
      key={id}
      organizationId={id}
      payload={profileQuery.data}
      userId={userId}
      requests={requestsQuery.data?.data ?? []}
      requestsLoading={requestsQuery.isLoading}
      detail={detailQuery.data}
      commercial={commercialQuery.data}
      refresh={refresh}
    />
  )
}

function AccountProfile({
  organizationId,
  payload,
  userId,
  requests,
  requestsLoading,
  detail,
  commercial,
  refresh,
}: {
  organizationId: string
  payload: ProfilePayload
  userId: string | undefined
  requests: Array<SupportRequest>
  requestsLoading: boolean
  detail: ReturnType<typeof useBackofficeOrganizationDetailData>['data']
  commercial: ReturnType<typeof useBackofficeCommercialContextData>['data']
  refresh: () => Promise<void>
}) {
  const updateProfile = useUpdateProfile(organizationId)
  const nextAction = useNextAction(organizationId)
  const blocker = useBlocker(organizationId)
  const takeOwnership = useTakeOwnership(organizationId, userId)
  const assign = useAssignRequest(organizationId)
  const respond = useRespondRequest(organizationId)
  const updateStatus = useUpdateRequestStatus(organizationId)
  const escalate = useEscalateRequest(organizationId)

  const [draft, setDraft] = useState<ProfileDraft>(() =>
    createProfileDraft(payload),
  )
  const [blockerScope, setBlockerScope] = useState<BlockerScope>('ONBOARDING')
  const [blockerReason, setBlockerReason] = useState('')
  const [responses, setResponses] = useState<Record<number, string>>({})

  const summary = payload.operationalSummary
  const health = status.healthStatus(summary.healthStatus)
  const patch = (next: Partial<ProfileDraft>) =>
    setDraft((current) => ({ ...current, ...next }))

  return (
    <div className="space-y-5">
      <Button
        render={<Link to="/backoffice/accounts" />}
        size="sm"
        variant="ghost"
        className="-ml-2 h-8 text-muted-foreground"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
        Contas
      </Button>

      <ConsolePageHeader
        eyebrow={payload.organization.slug}
        title={payload.organization.name}
        description={
          detail?.organization.cnpj
            ? `CNPJ ${detail.organization.cnpj}`
            : 'Perfil operacional unificado.'
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh()}
              className="min-h-10 transition-transform active:scale-[0.96]"
            >
              <HugeiconsIcon icon={RefreshIcon} className="size-4" />
              Atualizar
            </Button>
            {payload.workflow.accountOwnershipStatus !== 'ASSIGNED' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => takeOwnership.mutate()}
                disabled={takeOwnership.isPending || !userId}
                className="min-h-10 transition-transform active:scale-[0.96]"
              >
                <HugeiconsIcon icon={UserCheck01Icon} className="size-4" />
                Assumir conta
              </Button>
            ) : null}
            <Button
              size="sm"
              className="min-h-10 transition-transform active:scale-[0.96]"
              render={
                <Link
                  to="/backoffice/commercial-checkouts"
                  search={{ organizationId }}
                />
              }
            >
              <HugeiconsIcon icon={Invoice02Icon} className="size-4" />
              Receita
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={health} dot />
        <StatusChip status={status.goLiveStatus(summary.goLiveStatus)} />
        <StatusChip status={status.slaTier(summary.effectiveSlaTier)} />
        <StatusChip
          status={status.ownershipStatus(
            payload.workflow.accountOwnershipStatus,
          )}
        />
        {summary.prioritySupport ? (
          <StatusChip tone="info">Priority support</StatusChip>
        ) : null}
        <StatusChip tone="neutral">{payload.plan.name}</StatusChip>
      </div>

      <StaggerGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StaggerItem>
          <SignalTile
            label="Abertos"
            value={summary.openRequestsCount}
            tone={summary.openRequestsCount > 0 ? 'info' : 'neutral'}
          />
        </StaggerItem>
        <StaggerItem>
          <SignalTile
            label="SLA vencendo"
            value={summary.dueSoonRequestsCount}
            tone={summary.dueSoonRequestsCount > 0 ? 'warning' : 'neutral'}
          />
        </StaggerItem>
        <StaggerItem>
          <SignalTile
            label="SLA estourado"
            value={summary.breachedRequestsCount}
            tone={summary.breachedRequestsCount > 0 ? 'critical' : 'ok'}
          />
        </StaggerItem>
        <StaggerItem>
          <SignalTile
            label="Escalados"
            value={summary.escalatedRequestsCount}
            tone={summary.escalatedRequestsCount > 0 ? 'critical' : 'neutral'}
          />
        </StaggerItem>
        <StaggerItem>
          <SignalTile
            label="Bloqueios"
            value={summary.activeBlockersCount}
            tone={summary.activeBlockersCount > 0 ? 'warning' : 'ok'}
          />
        </StaggerItem>
      </StaggerGroup>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="min-w-0 space-y-5">
          {/* Operational state */}
          <SectionPanel
            eyebrow="Workflow"
            title="Estado operacional"
            description="Owner, ciclo de vida, próxima ação e bloqueios."
          >
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <LifecycleCell
                  label="Onboarding"
                  descriptor={status.onboardingStatus(
                    payload.profile.onboardingStatus,
                  )}
                />
                <LifecycleCell
                  label="Migração"
                  descriptor={status.migrationStatus(
                    payload.profile.migrationStatus,
                  )}
                />
                <LifecycleCell
                  label="Go-live"
                  descriptor={status.goLiveStatus(payload.profile.goLiveStatus)}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-muted/40 p-3.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    Próxima ação
                  </p>
                  <p className="mt-1 text-sm">
                    {payload.profile.nextAction ?? 'Nenhuma ação definida'}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <StatusChip
                      status={status.nextActionStatus(summary.nextActionStatus)}
                    />
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(payload.profile.nextActionDueAt)}
                    </span>
                  </div>
                </div>
                <div className="rounded-xl bg-muted/40 p-3.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    Owner interno
                  </p>
                  <p className="mt-1 text-sm">
                    {payload.internalOwnerUser?.name ?? 'Não definido'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Externo: {payload.profile.accountOwnerName ?? '—'}
                  </p>
                </div>
              </div>

              {payload.workflowViolations.length > 0 ? (
                <Notice tone="critical" title="Ações requeridas">
                  {payload.workflowViolations.map((issue) => (
                    <p key={issue.code}>{issue.message}</p>
                  ))}
                </Notice>
              ) : null}
              {payload.workflowWarnings.length > 0 ? (
                <Notice tone="warning" title="Alertas do workflow">
                  {payload.workflowWarnings.map((issue) => (
                    <p key={issue.code}>{issue.message}</p>
                  ))}
                </Notice>
              ) : null}

              {summary.blockers.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    Bloqueios ativos
                  </p>
                  {summary.blockers.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-500/10 p-3"
                    >
                      <div className="min-w-0">
                        <StatusChip status={status.blockerScope(item.scope)} />
                        <p className="mt-1 text-sm text-muted-foreground">
                          {item.reason}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          blocker.mutate({ scope: item.scope, mode: 'RESOLVE' })
                        }
                        disabled={blocker.isPending}
                        className="min-h-9"
                      >
                        Resolver
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              {payload.profile.nextAction ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    nextAction.mutate({
                      nextAction: draft.nextAction,
                      nextActionDueAt: draft.nextActionDueAt,
                      markCompleted: true,
                    })
                  }
                  disabled={nextAction.isPending}
                  className="min-h-9"
                >
                  Concluir próxima ação
                </Button>
              ) : null}
            </div>
          </SectionPanel>

          {/* Account tasks */}
          <AccountTasksCard organizationId={organizationId} />

          {/* Posture editor */}
          <SectionPanel
            eyebrow="Edição"
            title="Postura da conta"
            description="Campos que governam workflow, saúde e comunicação."
          >
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                updateProfile.mutate(draft)
              }}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <DraftInput
                  label="Owner da conta"
                  value={draft.accountOwnerName}
                  onChange={(accountOwnerName) => patch({ accountOwnerName })}
                />
                <DraftInput
                  label="Email do owner"
                  type="email"
                  value={draft.accountOwnerEmail}
                  onChange={(accountOwnerEmail) => patch({ accountOwnerEmail })}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <DraftInput
                  label="Contato de suporte"
                  type="email"
                  value={draft.supportContactEmail}
                  onChange={(supportContactEmail) =>
                    patch({ supportContactEmail })
                  }
                />
                <Field>
                  <FieldLabel>Owner interno</FieldLabel>
                  <NativeSelect
                    className="w-full"
                    value={draft.internalOwnerUserId}
                    onChange={(event) =>
                      patch({ internalOwnerUserId: event.target.value })
                    }
                  >
                    <NativeSelectOption value="">Sem owner</NativeSelectOption>
                    {payload.operators.map((operator) => (
                      <NativeSelectOption key={operator.id} value={operator.id}>
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
                  value={draft.onboardingStatus}
                  onChange={(onboardingStatus) => patch({ onboardingStatus })}
                />
                <DraftSelect
                  label="Migração"
                  options={migrationLabels}
                  value={draft.migrationStatus}
                  onChange={(migrationStatus) => patch({ migrationStatus })}
                />
                <DraftSelect
                  label="Go-live"
                  options={goLiveLabels}
                  value={draft.goLiveStatus}
                  onChange={(goLiveStatus) => patch({ goLiveStatus })}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <DraftSelect
                  label="Saúde"
                  options={healthLabels}
                  value={draft.healthStatus}
                  onChange={(healthStatus) => patch({ healthStatus })}
                />
                <DraftSelect
                  label="SLA da conta"
                  options={slaTierLabels}
                  value={draft.slaTier}
                  onChange={(slaTier) => patch({ slaTier })}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <DraftInput
                  label="Próxima ação"
                  value={draft.nextAction}
                  onChange={(value) => patch({ nextAction: value })}
                  placeholder="Ex.: validar migração e reagendar treinamento"
                />
                <DraftInput
                  label="Prazo"
                  type="date"
                  value={draft.nextActionDueAt}
                  onChange={(nextActionDueAt) => patch({ nextActionDueAt })}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => nextAction.mutate(draft)}
                  disabled={nextAction.isPending}
                  className="min-h-9"
                >
                  Atualizar próxima ação
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-[0.7fr_1.3fr_auto] md:items-end">
                <DraftSelect
                  label="Bloqueio"
                  options={blockerScopeLabels}
                  value={blockerScope}
                  onChange={setBlockerScope}
                />
                <DraftInput
                  label="Motivo do bloqueio"
                  value={blockerReason}
                  onChange={setBlockerReason}
                  placeholder="Ex.: aguardando base validada"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    blocker.mutate({
                      scope: blockerScope,
                      mode: 'ADD',
                      reason: blockerReason,
                    })
                  }
                  disabled={blocker.isPending || !blockerReason.trim()}
                  className="min-h-9"
                >
                  Registrar
                </Button>
              </div>
              <Field orientation="horizontal">
                <Switch
                  checked={draft.prioritySupport}
                  onCheckedChange={(prioritySupport) =>
                    patch({ prioritySupport })
                  }
                />
                <div>
                  <FieldLabel>Priority support</FieldLabel>
                  <FieldDescription>
                    Antecipa o tratamento e destaca a conta no comando.
                  </FieldDescription>
                </div>
              </Field>
              <Field>
                <FieldLabel>Status público</FieldLabel>
                <Textarea
                  rows={3}
                  value={draft.publicStatusNote}
                  onChange={(event) =>
                    patch({ publicStatusNote: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>Notas internas</FieldLabel>
                <Textarea
                  rows={4}
                  value={draft.internalNotes}
                  onChange={(event) =>
                    patch({ internalNotes: event.target.value })
                  }
                />
              </Field>
              <Button
                type="submit"
                disabled={updateProfile.isPending}
                className="min-h-10 transition-transform active:scale-[0.96]"
              >
                {updateProfile.isPending ? 'Salvando…' : 'Salvar postura'}
              </Button>
            </form>
          </SectionPanel>

          {/* Structure */}
          <SectionPanel
            eyebrow="Estrutura"
            title="Unidades & integrações"
            description="Topologia operacional da conta."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <HugeiconsIcon
                    icon={Structure01Icon}
                    className="size-4 text-muted-foreground"
                  />
                  Unidades
                </p>
                {detail?.units.length ? (
                  <div className="space-y-1.5">
                    {detail.units.map((unit) => (
                      <div
                        key={unit.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm">
                            {unit.name}
                          </span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {unit.slug}
                          </span>
                        </span>
                        <StatusChip
                          tone={unit.status === 'active' ? 'ok' : 'neutral'}
                        >
                          {unit.status === 'active' ? 'Ativa' : 'Arquivada'}
                        </StatusChip>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Sem unidades cadastradas.
                  </p>
                )}
              </div>
              <div>
                <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <HugeiconsIcon
                    icon={PlugSocketIcon}
                    className="size-4 text-muted-foreground"
                  />
                  Integrações
                </p>
                {detail?.integrations.length ? (
                  <div className="space-y-1.5">
                    {detail.integrations.map((integration) => (
                      <div
                        key={integration.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2"
                      >
                        <span className="truncate text-sm">
                          {integration.name}
                        </span>
                        <StatusChip
                          tone={
                            integration.status === 'ACTIVE'
                              ? 'ok'
                              : integration.status === 'ERROR'
                                ? 'critical'
                                : 'neutral'
                          }
                        >
                          {integration.status}
                        </StatusChip>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma integração conectada.
                  </p>
                )}
              </div>
            </div>
          </SectionPanel>
        </div>

        <div className="min-w-0 space-y-5">
          {/* Tenant lifecycle */}
          <AccountLifecycleCard
            organizationId={organizationId}
            organization={detail?.organization}
          />

          {/* Commercial snapshot */}
          <SectionPanel
            eyebrow="Receita"
            title="Cobrança & comercial"
            description="Assinatura, cobrança e ofertas recentes."
            action={
              <Button
                variant="ghost"
                size="sm"
                className="min-h-9 transition-transform active:scale-[0.96]"
                render={
                  <Link
                    to="/backoffice/commercial-checkouts"
                    search={{ organizationId }}
                  />
                }
              >
                Abrir
                <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" />
              </Button>
            }
          >
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted/40 p-3.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    <HugeiconsIcon icon={Coins01Icon} className="size-3.5" />
                    Assinatura
                  </p>
                  <p className="mt-1 text-sm">
                    {commercial?.subscription?.planId ?? payload.plan.name}
                  </p>
                  {commercial?.subscription?.status ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {commercial.subscription.status}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-xl bg-muted/40 p-3.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    <HugeiconsIcon icon={Database01Icon} className="size-3.5" />
                    Cliente cobrança
                  </p>
                  <p className="mt-1 truncate text-sm">
                    {commercial?.billingCustomer?.name ?? 'Não sincronizado'}
                  </p>
                  {commercial?.billingCustomer?.email ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {commercial.billingCustomer.email}
                    </p>
                  ) : null}
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Ofertas recentes
                </p>
                {commercial?.recentOffers.length ? (
                  <div className="space-y-1.5">
                    {commercial.recentOffers.slice(0, 5).map((offer) => (
                      <div
                        key={offer.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm">
                            {offer.kind}
                          </span>
                          <span className="block font-mono text-xs tabular-nums text-muted-foreground">
                            {formatMoney(offer.totalAmount)}
                          </span>
                        </span>
                        <StatusChip
                          tone={
                            COMMERCIAL_STATUS_TONE[offer.status] ?? 'neutral'
                          }
                        >
                          {offer.status}
                        </StatusChip>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma oferta emitida.
                  </p>
                )}
              </div>
            </div>
          </SectionPanel>

          {/* Timeline */}
          <SectionPanel
            eyebrow="Histórico"
            title="Timeline"
            description="Mudanças de onboarding, suporte e postura."
          >
            {payload.timeline.length ? (
              <CustomerSuccessAccountTimeline events={payload.timeline} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma atividade operacional registrada.
              </p>
            )}
          </SectionPanel>

          {/* Tickets */}
          <SectionPanel
            eyebrow="Suporte"
            title="Tickets da conta"
            description="Responda, atribua, mova status ou escale no contexto."
          >
            {requestsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-28 w-full rounded-xl" />
                ))}
              </div>
            ) : requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum ticket registrado para esta conta.
              </p>
            ) : (
              <div className="space-y-3">
                {requests.map((request) => (
                  <TicketCard
                    key={request.id}
                    request={request}
                    response={responses[request.id] ?? ''}
                    onResponseChange={(value) =>
                      setResponses((current) => ({
                        ...current,
                        [request.id]: value,
                      }))
                    }
                    onAssign={() =>
                      assign.mutate({
                        requestId: request.id,
                        assignedToUserId: userId ?? null,
                      })
                    }
                    onRespond={() =>
                      respond.mutate({
                        requestId: request.id,
                        message: responses[request.id] ?? '',
                      })
                    }
                    onStatus={(value) =>
                      updateStatus.mutate({
                        requestId: request.id,
                        status: value,
                      })
                    }
                    onEscalate={() =>
                      escalate.mutate({
                        requestId: request.id,
                        reason:
                          request.slaStatus === 'BREACHED'
                            ? 'Escalação automática do operador: ticket fora do SLA.'
                            : 'Escalação manual do operador para tratamento prioritário.',
                      })
                    }
                    busy={
                      assign.isPending ||
                      respond.isPending ||
                      updateStatus.isPending ||
                      escalate.isPending
                    }
                  />
                ))}
              </div>
            )}
          </SectionPanel>
        </div>
      </div>
    </div>
  )
}

function LifecycleCell({
  label,
  descriptor,
}: {
  label: string
  descriptor: { label: string; tone: SignalTone }
}) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-1.5">
        <StatusChip status={descriptor} dot />
      </div>
    </div>
  )
}

function TicketCard({
  request,
  response,
  onResponseChange,
  onAssign,
  onRespond,
  onStatus,
  onEscalate,
  busy,
}: {
  request: SupportRequest
  response: string
  onResponseChange: (value: string) => void
  onAssign: () => void
  onRespond: () => void
  onStatus: (status: SupportRequest['status']) => void
  onEscalate: () => void
  busy: boolean
}) {
  return (
    <div className="space-y-3 rounded-xl p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{request.subject}</p>
          <p className="font-mono text-xs text-muted-foreground">
            #{request.id} · {request.category}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusChip status={status.supportPriority(request.priority)} />
          <StatusChip status={status.supportSlaStatus(request.slaStatus)} />
          <StatusChip status={status.requestStatus(request.status)} />
        </div>
      </div>

      {request.description ? (
        <p className="text-sm text-muted-foreground">{request.description}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        SLA: {formatRelativeSla(request.timeToSlaMs)} · Responsável:{' '}
        {request.assignedToUser?.name ?? 'Não atribuído'}
      </p>

      <Textarea
        rows={2}
        value={response}
        onChange={(event) => onResponseChange(event.target.value)}
        placeholder="Resposta visível para o laboratório"
      />

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={onAssign} disabled={busy}>
          Assumir
        </Button>
        <Button size="sm" onClick={onRespond} disabled={busy}>
          Responder
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onStatus('WAITING_ON_CUSTOMER')}
          disabled={busy}
        >
          Aguardar
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onStatus('RESOLVED')}
          disabled={busy}
        >
          Resolver
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onEscalate}
          disabled={busy || Boolean(request.escalationReason)}
        >
          Escalar
        </Button>
      </div>
    </div>
  )
}

function Notice({
  title,
  tone,
  children,
}: {
  title: string
  tone: SignalTone
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-xl p-3.5 text-sm',
        tone === 'critical'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
      )}
    >
      <p className="font-medium">{title}</p>
      <div className="mt-1 space-y-1 opacity-90">{children}</div>
    </div>
  )
}

function DraftInput({
  label,
  value,
  onChange,
  placeholder,
  type,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </Field>
  )
}

function DraftSelect<TValue extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: TValue
  options: Record<string, string>
  onChange: (value: TValue) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <NativeSelect
        className="w-full"
        value={value}
        onChange={(event) => {
          const nextValue = Object.keys(options).find(
            (option): option is TValue => option === event.target.value,
          )
          if (nextValue) onChange(nextValue)
        }}
      >
        {Object.entries(options).map(([optionValue, optionLabel]) => (
          <NativeSelectOption key={optionValue} value={optionValue}>
            {optionLabel}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  )
}
