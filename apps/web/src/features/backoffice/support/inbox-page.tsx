import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight02Icon,
  ArrowUp01Icon,
  CheckmarkCircle01Icon,
  InboxIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { useBackofficeSession } from '@calibra-facil/auth/client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { TicketBoard } from '@/features/backoffice/customer-success/boards'
import {
  ConsoleEmpty,
  ConsolePageHeader,
  ConsoleSearch,
  HealthDot,
  PreviewSheet,
  SectionPanel,
  SegmentedFilter,
  StatusChip,
  status,
  type SegmentedOption,
} from '@/features/backoffice/console'
import {
  useAssignRequest,
  useEscalateRequest,
  useRefreshCustomerSuccess,
  useRespondRequest,
  useSupportQueue,
  useUpdateRequestStatus,
} from '@/features/backoffice/customer-success/hooks'
import {
  formatDateTime,
  formatRelativeSla,
  type SupportRequest,
  type TicketFilter,
} from '@/features/backoffice/customer-success/model'
import { filterTickets, ticketViewCounts, TICKET_VIEWS } from './selectors'

type SupportView = 'list' | 'board'

const VIEW_TONE: Partial<
  Record<TicketFilter, SegmentedOption<TicketFilter>['tone']>
> = {
  breached: 'critical',
  due: 'warning',
  unassigned: 'warning',
  escalation: 'critical',
}

export function SupportInboxPage({
  filter,
  view,
}: {
  filter: TicketFilter
  view: SupportView
}) {
  const navigate = useNavigate()
  const session = useBackofficeSession()
  const userId = session.data?.user?.id
  const queueQuery = useSupportQueue()
  const updateStatus = useUpdateRequestStatus()
  const refresh = useRefreshCustomerSuccess()
  const [query, setQuery] = useState('')
  const [previewId, setPreviewId] = useState<number | null>(null)

  const tickets = useMemo(
    () => queueQuery.data?.data ?? [],
    [queueQuery.data?.data],
  )
  const counts = useMemo(
    () => ticketViewCounts(tickets, userId),
    [tickets, userId],
  )
  const filtered = useMemo(
    () => filterTickets(tickets, filter, userId, query),
    [tickets, filter, userId, query],
  )
  const previewTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === previewId) ?? null,
    [tickets, previewId],
  )

  const viewOptions: Array<SegmentedOption<TicketFilter>> = TICKET_VIEWS.map(
    (item) => ({
      value: item.value,
      label: item.label,
      count: counts[item.value],
      tone: VIEW_TONE[item.value],
    }),
  )

  const setFilter = (value: TicketFilter) =>
    navigate({ to: '/backoffice/support', search: { filter: value, view } })
  const setView = (value: SupportView) =>
    navigate({ to: '/backoffice/support', search: { filter, view: value } })

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        eyebrow="Atendimento"
        title="Suporte"
        description="Triagem priorizada por SLA: o que estourou ou está prestes a estourar aparece primeiro."
        actions={
          <>
            <div className="flex rounded-lg bg-muted/60 p-0.5">
              <ViewButton
                active={view === 'list'}
                onClick={() => setView('list')}
              >
                Lista
              </ViewButton>
              <ViewButton
                active={view === 'board'}
                onClick={() => setView('board')}
              >
                Quadro
              </ViewButton>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh()}
              disabled={queueQuery.isFetching}
              className="min-h-10 transition-transform active:scale-[0.96]"
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                className={cn(
                  'size-4',
                  queueQuery.isFetching && 'animate-spin',
                )}
              />
              Atualizar
            </Button>
          </>
        }
      />

      <SectionPanel
        eyebrow="Fila"
        title={view === 'list' ? 'Caixa de entrada' : 'Quadro de status'}
        description={
          queueQuery.isPending
            ? undefined
            : `${filtered.length} ticket(s) · ${counts.breached} fora do SLA · ${counts.unassigned} sem dono`
        }
        contentClassName="space-y-4"
      >
        {view === 'list' ? (
          <ConsoleSearch
            value={query}
            onChange={setQuery}
            placeholder="Buscar por assunto, conta ou responsável…"
          />
        ) : null}
        <SegmentedFilter
          options={viewOptions}
          value={filter}
          onChange={setFilter}
        />

        {queueQuery.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : view === 'board' ? (
          <TicketBoard
            requests={filtered}
            onMoveStatus={(requestId, nextStatus) =>
              updateStatus.mutate({ requestId, status: nextStatus })
            }
          />
        ) : filtered.length === 0 ? (
          <ConsoleEmpty
            icon={CheckmarkCircle01Icon}
            title="Fila limpa neste recorte"
            description="Nenhum ticket corresponde à visão atual."
          />
        ) : (
          <div className="overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            <div className="divide-y">
              {filtered.map((ticket) => (
                <TicketRow
                  key={ticket.id}
                  ticket={ticket}
                  onPreview={() => setPreviewId(ticket.id)}
                />
              ))}
            </div>
          </div>
        )}
      </SectionPanel>

      <TicketPreview
        ticket={previewTicket}
        userId={userId}
        onClose={() => setPreviewId(null)}
      />
    </div>
  )
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function TicketRow({
  ticket,
  onPreview,
}: {
  ticket: SupportRequest
  onPreview: () => void
}) {
  const sla = status.supportSlaStatus(ticket.slaStatus)
  const priority = status.supportPriority(ticket.priority)

  return (
    <button
      type="button"
      onClick={onPreview}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <HealthDot tone={sla.tone} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {ticket.subject}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {ticket.organization?.name ?? 'Conta desconhecida'} ·{' '}
            {ticket.assignedToUser?.name ?? 'Sem responsável'}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        {ticket.needsEscalation ? (
          <StatusChip tone="critical" icon={ArrowUp01Icon}>
            Escalar
          </StatusChip>
        ) : null}
        <StatusChip status={priority} />
        <span className="hidden sm:inline">
          <StatusChip status={sla} />
        </span>
        <span className="hidden w-20 text-right font-mono text-xs tabular-nums text-muted-foreground md:inline">
          {formatRelativeSla(ticket.timeToSlaMs)}
        </span>
        <HugeiconsIcon
          icon={ArrowRight02Icon}
          className="size-4 text-muted-foreground/40"
        />
      </span>
    </button>
  )
}

function TicketPreview({
  ticket,
  userId,
  onClose,
}: {
  ticket: SupportRequest | null
  userId: string | undefined
  onClose: () => void
}) {
  const assign = useAssignRequest()
  const respond = useRespondRequest()
  const updateStatus = useUpdateRequestStatus()
  const escalate = useEscalateRequest()
  const [message, setMessage] = useState('')

  const busy =
    assign.isPending ||
    respond.isPending ||
    updateStatus.isPending ||
    escalate.isPending

  const orgId = ticket?.organization?.id

  return (
    <PreviewSheet
      open={Boolean(ticket)}
      onOpenChange={(next) => {
        if (!next) {
          setMessage('')
          onClose()
        }
      }}
      eyebrow={ticket ? `Ticket #${ticket.id}` : 'Ticket'}
      title={ticket?.subject ?? ''}
      description={ticket?.organization?.name ?? undefined}
      actions={
        ticket ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                assign.mutate({
                  requestId: ticket.id,
                  assignedToUserId: userId ?? null,
                })
              }
              className="min-h-9"
            >
              Assumir
            </Button>
            {orgId ? (
              <Button
                size="sm"
                className="min-h-9"
                render={
                  <Link to="/backoffice/accounts/$id" params={{ id: orgId }} />
                }
              >
                Abrir conta
                <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" />
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {ticket ? (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-1.5">
            <StatusChip status={status.supportPriority(ticket.priority)} />
            <StatusChip status={status.supportSlaStatus(ticket.slaStatus)} />
            <StatusChip status={status.requestStatus(ticket.status)} />
            <StatusChip tone="neutral">{ticket.category}</StatusChip>
          </div>

          <p className="text-xs text-muted-foreground">
            SLA: {formatRelativeSla(ticket.timeToSlaMs)} · Responsável:{' '}
            {ticket.assignedToUser?.name ?? 'Não atribuído'}
          </p>

          {ticket.description ? (
            <p className="rounded-xl bg-muted/40 p-3 text-sm">
              {ticket.description}
            </p>
          ) : null}

          {ticket.needsEscalation || ticket.escalationReason ? (
            <div className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              {ticket.escalationReason ??
                'Este ticket precisa de acompanhamento prioritário.'}
            </div>
          ) : null}

          <div className="space-y-2">
            <Textarea
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Resposta visível para o laboratório"
            />
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                disabled={busy || !message.trim()}
                onClick={() =>
                  respond.mutate(
                    { requestId: ticket.id, message },
                    { onSuccess: () => setMessage('') },
                  )
                }
                className="min-h-9"
              >
                Responder
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  updateStatus.mutate({
                    requestId: ticket.id,
                    status: 'WAITING_ON_CUSTOMER',
                  })
                }
                className="min-h-9"
              >
                Aguardar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  updateStatus.mutate({
                    requestId: ticket.id,
                    status: 'RESOLVED',
                  })
                }
                className="min-h-9"
              >
                Resolver
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || Boolean(ticket.escalationReason)}
                onClick={() =>
                  escalate.mutate({
                    requestId: ticket.id,
                    reason:
                      ticket.slaStatus === 'BREACHED'
                        ? 'Escalação automática do operador: ticket fora do SLA.'
                        : 'Escalação manual do operador para tratamento prioritário.',
                  })
                }
                className="min-h-9"
              >
                <HugeiconsIcon icon={ArrowUp01Icon} className="size-4" />
                Escalar
              </Button>
            </div>
          </div>

          {ticket.events.length > 0 ? (
            <div className="space-y-2 border-t pt-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Histórico
              </p>
              {ticket.events.map((event, index) => (
                <div
                  key={`${ticket.id}-${index}-${event.createdAt}`}
                  className="rounded-lg bg-muted/40 p-2.5 text-sm"
                >
                  <p>{event.message}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {event.actorUser?.name ?? 'Sistema'} ·{' '}
                    {formatDateTime(event.createdAt)} ·{' '}
                    {event.publicVisible ? 'Público' : 'Interno'}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-muted/30 p-3 text-xs text-muted-foreground">
              <HugeiconsIcon icon={InboxIcon} className="size-4" />
              Sem histórico de mensagens neste ticket.
            </div>
          )}
        </div>
      ) : null}
    </PreviewSheet>
  )
}
