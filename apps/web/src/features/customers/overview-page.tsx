import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  Call02Icon,
  Clock01Icon,
  DollarCircleIcon,
  Invoice01Icon,
  Location01Icon,
  Mail01Icon,
  ToolsIcon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons'
import { formatMoney } from '@calibra-facil/shared'

import {
  useCustomerAssetsData,
  useCustomerDetailData,
  useCustomerInvitationsData,
  useCustomerJobsData,
  useCustomerMembersData,
} from '@/features/customers/queries'
import type {
  CustomerCompliance,
  CustomerJobStatus,
} from '@/features/customers/types'
import {
  buildAssetCalibrationStatus,
  formatDate,
} from '@/features/assets/detail-model'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { jobRouteId } from '@/lib/route-identifiers'
import { cn } from '@/lib/utils'

const QUALIFICATION: Record<
  NonNullable<CustomerCompliance['qualificationStatus']>,
  { label: string; variant: 'default' | 'secondary' | 'destructive' }
> = {
  qualified: { label: 'Qualificado', variant: 'default' },
  pending: { label: 'Pendente', variant: 'secondary' },
  suspended: { label: 'Suspenso', variant: 'destructive' },
  expired: { label: 'Expirado', variant: 'destructive' },
}

const JOB_STATUS: Record<
  CustomerJobStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
  }
> = {
  DRAFT: { label: 'Rascunho', variant: 'secondary' },
  IN_PROGRESS: { label: 'Em execução', variant: 'default' },
  REVIEW: { label: 'Em revisão', variant: 'outline' },
  GENERATING_PDF: { label: 'Gerando PDF', variant: 'outline' },
  APPROVED: { label: 'Aprovado', variant: 'default' },
  REJECTED: { label: 'Rejeitado', variant: 'destructive' },
  CANCELED: { label: 'Cancelado', variant: 'secondary' },
  SUPERSEDED: { label: 'Retificado', variant: 'outline' },
}

/** A right-aligned "see all" affordance for a panel header. */
function SeeAll({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground">
      {children}
      <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
    </span>
  )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-sm">{children}</span>
    </div>
  )
}

/** Prominent, click-to-act contact tile (mailto / tel) for fast outreach. */
function ContactTile({
  icon,
  label,
  value,
  href,
  secondary,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  label: string
  value: string | null | undefined
  href?: string
  secondary?: string
}) {
  const hasValue = Boolean(value)
  const valueClass = 'mt-2 block truncate text-base font-medium'
  return (
    <div className="rounded-xl bg-muted/45 p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <HugeiconsIcon icon={icon} className="size-4" aria-hidden="true" />
        {label}
      </div>
      {!hasValue ? (
        <span className={cn(valueClass, 'text-muted-foreground')}>—</span>
      ) : href ? (
        <a
          href={href}
          className={cn(
            valueClass,
            'underline-offset-4 transition-colors hover:text-primary hover:underline',
          )}
        >
          {value}
        </a>
      ) : (
        <span className={valueClass}>{value}</span>
      )}
      {secondary && (
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {secondary}
        </span>
      )}
    </div>
  )
}

export function ClientOverviewTab({ id }: { id: string }) {
  const { data: customer, isLoading } = useCustomerDetailData(id)
  const customerId = customer?.id

  const { data: assetsData, isLoading: assetsLoading } = useCustomerAssetsData({
    customerId,
    page: 1,
    limit: 100,
    search: '',
  })
  const { data: jobsData, isLoading: jobsLoading } = useCustomerJobsData({
    customerId,
    page: 1,
    limit: 5,
    search: '',
    statusFilter: '',
  })
  const { data: members } = useCustomerMembersData(id)
  const { data: invitations } = useCustomerInvitationsData(id)

  if (isLoading) {
    return <OverviewSkeleton />
  }

  if (!customer) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">Cliente não encontrado.</p>
      </Panel>
    )
  }

  const compliance = customer.compliance
  const qualification = compliance?.qualificationStatus
    ? QUALIFICATION[compliance.qualificationStatus]
    : null
  const financial = customer.financialSummary

  const assetItems = assetsData?.data ?? []
  const assetTotal = assetsData?.pagination?.total ?? assetItems.length
  let overdueAssets = 0
  let dueSoonAssets = 0
  for (const asset of assetItems) {
    const status = buildAssetCalibrationStatus({
      status: asset.status,
      nextCalibrationDate: asset.nextCalibrationDate,
    })
    if (status.level === 'overdue') overdueAssets += 1
    else if (status.level === 'due_soon') dueSoonAssets += 1
  }

  const recentJobs = jobsData?.data ?? []
  const memberCount = members?.length ?? 0
  const pendingInvites =
    invitations?.filter((invite) => invite.status === 'pending').length ?? 0

  const address = customer.address
  const cityState = [address?.city, address?.state].filter(Boolean).join(' · ')
  const streetLine = [address?.street, address?.number]
    .filter(Boolean)
    .join(', ')
  const telDigits = customer.phone ? customer.phone.replace(/\D/g, '') : ''

  return (
    <div className="space-y-6">
      {/* Contato — most-used info: keep it first and click-to-act */}
      <Panel className="p-4 sm:p-5">
        <PanelHeader
          title="Contato"
          description="Canais para falar com o cliente sobre coletas, prazos e calibrações."
          action={
            <Link
              to="/dashboard/clients/$id/info"
              params={{ id }}
              className="group inline-flex"
            >
              <SeeAll>Editar</SeeAll>
            </Link>
          }
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ContactTile
            icon={Mail01Icon}
            label="Email"
            value={customer.email}
            href={customer.email ? `mailto:${customer.email}` : undefined}
          />
          <ContactTile
            icon={Call02Icon}
            label="Telefone"
            value={customer.phone}
            href={telDigits ? `tel:${telDigits}` : undefined}
          />
          <ContactTile
            icon={Location01Icon}
            label="Localização"
            value={cityState || undefined}
            secondary={streetLine || undefined}
          />
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Conformidade */}
        <Link
          to="/dashboard/clients/$id/compliance"
          params={{ id }}
          className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Panel className="h-full p-4 transition-[box-shadow] group-hover:shadow-[0_1px_2px_rgba(15,23,42,0.06),0_22px_50px_rgba(15,23,42,0.10)] sm:p-5">
            <PanelHeader title="Qualificação" action={<SeeAll>Ver</SeeAll>} />
            <div className="mt-4 space-y-1 divide-y divide-foreground/[0.06]">
              <FieldRow label="Situação">
                {qualification ? (
                  <Badge variant={qualification.variant}>
                    {qualification.label}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </FieldRow>
              <FieldRow label="Válida até">
                <span className="font-mono tabular-nums">
                  {formatDate(compliance?.qualificationExpiresAt)}
                </span>
              </FieldRow>
              <FieldRow label="Contrato">
                {compliance?.contractNumber ? (
                  <span className="font-mono tabular-nums">
                    {compliance.contractNumber}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Sem contrato</span>
                )}
              </FieldRow>
            </div>
          </Panel>
        </Link>

        {/* Financeiro */}
        <Panel className="h-full p-4 sm:p-5">
          <PanelHeader title="Faturamento" />
          <StaggerGroup className="mt-4 grid grid-cols-2 gap-3">
            <StaggerItem>
              <SignalTile
                icon={Invoice01Icon}
                label="Docs. em aberto"
                value={String(financial?.openDocumentsCount ?? 0)}
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={Invoice01Icon}
                label="Docs. vencidos"
                value={String(financial?.overdueDocumentsCount ?? 0)}
                tone={
                  (financial?.overdueDocumentsCount ?? 0) > 0
                    ? 'critical'
                    : 'neutral'
                }
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={DollarCircleIcon}
                label="Saldo em aberto"
                value={formatMoney(financial?.openBalanceCents ?? 0)}
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={DollarCircleIcon}
                label="Saldo vencido"
                value={formatMoney(financial?.overdueBalanceCents ?? 0)}
                tone={financial?.overdueBalanceFlag ? 'critical' : 'neutral'}
              />
            </StaggerItem>
          </StaggerGroup>
        </Panel>
      </div>

      {/* Ativos */}
      <Link
        to="/dashboard/clients/$id/assets"
        params={{ id }}
        className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Panel className="p-4 transition-[box-shadow] group-hover:shadow-[0_1px_2px_rgba(15,23,42,0.06),0_22px_50px_rgba(15,23,42,0.10)] sm:p-5">
          <PanelHeader
            title="Instrumentos do cliente"
            action={<SeeAll>Ver todos</SeeAll>}
          />
          {assetsLoading ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_item, index) => (
                <Skeleton key={index} className="h-[88px] rounded-xl" />
              ))}
            </div>
          ) : (
            <StaggerGroup className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StaggerItem>
                <SignalTile
                  icon={ToolsIcon}
                  label="Total"
                  value={String(assetTotal)}
                  tone="neutral"
                />
              </StaggerItem>
              <StaggerItem>
                <SignalTile
                  icon={Alert02Icon}
                  label="Calibração vencida"
                  value={String(overdueAssets)}
                  hint={overdueAssets > 0 ? 'recalibrar' : undefined}
                  tone={overdueAssets > 0 ? 'critical' : 'neutral'}
                />
              </StaggerItem>
              <StaggerItem>
                <SignalTile
                  icon={Clock01Icon}
                  label="Vencendo (30d)"
                  value={String(dueSoonAssets)}
                  hint={dueSoonAssets > 0 ? 'em breve' : undefined}
                  tone={dueSoonAssets > 0 ? 'warning' : 'neutral'}
                />
              </StaggerItem>
            </StaggerGroup>
          )}
        </Panel>
      </Link>

      {/* Calibrações recentes */}
      <Panel className="p-4 sm:p-5">
        <Link to="/dashboard/clients/$id/calibrations" params={{ id }}>
          <div className="group">
            <PanelHeader
              title="Calibrações recentes"
              action={<SeeAll>Ver todas</SeeAll>}
            />
          </div>
        </Link>
        {jobsLoading ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 3 }).map((_item, index) => (
              <Skeleton key={index} className="h-12 rounded-xl" />
            ))}
          </div>
        ) : recentJobs.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nenhuma calibração registrada para este cliente.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
            <div className="divide-y divide-foreground/[0.07]">
              {recentJobs.map((job) => {
                const status = JOB_STATUS[job.status]
                return (
                  <Link
                    key={job.id}
                    to="/dashboard/jobs/$id"
                    params={{ id: jobRouteId(job) }}
                    className="flex items-center gap-3 bg-background px-3 py-2.5 transition-colors hover:bg-muted/40"
                  >
                    <HugeiconsIcon
                      icon={Calendar03Icon}
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="w-28 shrink-0 font-mono text-sm font-medium tabular-nums">
                      {job.jobId}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {job.assetName || '—'}
                      {job.assetTag && (
                        <span className="ml-1 font-mono text-xs text-muted-foreground">
                          ({job.assetTag})
                        </span>
                      )}
                    </span>
                    <Badge variant={status.variant} className="shrink-0">
                      {status.label}
                    </Badge>
                    <span className="hidden w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground sm:inline">
                      {formatDate(
                        job.performedAt ?? job.approvedAt ?? job.createdAt,
                      )}
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </Panel>

      {/* Portal — admin, lowest priority */}
      <Link
        to="/dashboard/clients/$id/users"
        params={{ id }}
        className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Panel className="p-4 transition-[box-shadow] group-hover:shadow-[0_1px_2px_rgba(15,23,42,0.06),0_22px_50px_rgba(15,23,42,0.10)] sm:p-5">
          <PanelHeader
            title="Acesso do cliente"
            action={<SeeAll>Gerenciar</SeeAll>}
          />
          <StaggerGroup className="mt-4 grid grid-cols-2 gap-3">
            <StaggerItem>
              <SignalTile
                icon={UserMultipleIcon}
                label="Usuários ativos"
                value={String(memberCount)}
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={Mail01Icon}
                label="Convites pendentes"
                value={String(pendingInvites)}
                tone={pendingInvites > 0 ? 'info' : 'neutral'}
              />
            </StaggerItem>
          </StaggerGroup>
        </Panel>
      </Link>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl" />
      </div>
      <Skeleton className="h-40 rounded-2xl" />
      <Skeleton className="h-56 rounded-2xl" />
    </div>
  )
}
