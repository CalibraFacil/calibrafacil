import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import {
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
  type DragEndEvent as KanbanDragEndEvent,
} from '@/components/kanban'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  accountBoardColumns,
  formatRelativeSla,
  getHealthBadgeVariant,
  getNextActionBadgeVariant,
  getPriorityBadgeVariant,
  getSlaBadgeVariant,
  getWorkflowBadgeVariant,
  healthLabels,
  nextActionStatusLabels,
  ownershipStatusLabels,
  requestPriorityLabels,
  requestStatusLabels,
  slaStatusLabels,
  supportBoardColumns,
  type AccountBoardColumn,
  type AccountBoardItem,
  type HealthStatus,
  type OrganizationQueueItem,
  type SupportBoardColumn,
  type SupportBoardItem,
  type SupportQueueItem,
  type SupportRequestStatus,
} from './model'

function resolveKanbanDropColumn<
  TColumn extends string,
  TItem extends { id: string; column: TColumn },
>(event: KanbanDragEndEvent, items: TItem[], columns: Array<{ id: TColumn }>) {
  const overId = event.over?.id
  if (!overId) return null

  const overItem = items.find((item) => item.id === String(overId))
  if (overItem) return overItem.column

  return columns.find((column) => column.id === String(overId))?.id ?? null
}

export function AccountBoard(props: {
  organizations: OrganizationQueueItem[]
  onMoveHealth: (organizationId: string, healthStatus: HealthStatus) => void
}) {
  const navigate = useNavigate()
  const boardSource = useMemo<AccountBoardItem[]>(
    () =>
      props.organizations.map((organization) => ({
        id: `org-${organization.id}`,
        name: organization.name,
        column: organization.operationalSummary.healthStatus,
        organizationId: organization.id,
        organization,
      })),
    [props.organizations],
  )
  const [boardSourceSnapshot, setBoardSourceSnapshot] =
    useState<AccountBoardItem[]>(boardSource)
  const [boardData, setBoardData] = useState<AccountBoardItem[]>(boardSource)
  const [dragOrigin, setDragOrigin] = useState<{
    itemId: string
    column: HealthStatus
  } | null>(null)

  if (boardSource !== boardSourceSnapshot) {
    setBoardSourceSnapshot(boardSource)
    setBoardData(boardSource)
  }

  const handleDragEnd = (event: KanbanDragEndEvent) => {
    const activeItem = boardData.find(
      (item) => item.id === String(event.active.id),
    )
    const originColumn =
      dragOrigin?.itemId === String(event.active.id) ? dragOrigin.column : null
    const nextColumn = resolveKanbanDropColumn(
      event,
      boardData,
      accountBoardColumns,
    )

    setDragOrigin(null)

    if (
      !activeItem ||
      !originColumn ||
      !nextColumn ||
      originColumn === nextColumn
    ) {
      return
    }

    props.onMoveHealth(activeItem.organizationId, nextColumn)
  }

  if (boardData.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
        Nenhuma conta corresponde aos filtros atuais.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto pb-2">
      <KanbanProvider<AccountBoardItem, AccountBoardColumn>
        className="min-w-max auto-cols-[minmax(19rem,19rem)] gap-4 xl:auto-cols-[minmax(21rem,1fr)]"
        columns={accountBoardColumns}
        data={boardData}
        onDataChange={setBoardData}
        onDragEnd={handleDragEnd}
        onDragStart={(event) => {
          const activeItem = boardData.find(
            (item) => item.id === String(event.active.id),
          )

          setDragOrigin(
            activeItem
              ? { itemId: activeItem.id, column: activeItem.column }
              : null,
          )
        }}
      >
        {(column) => (
          <KanbanBoard
            key={column.id}
            className="min-h-[28rem] border-border/70 bg-muted/20 shadow-none"
            id={column.id}
          >
            <KanbanHeader className="space-y-3 border-b bg-background/80">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium">{column.name}</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {column.description}
                  </p>
                </div>
                <Badge
                  variant={
                    column.id === 'CRITICAL'
                      ? 'destructive'
                      : column.id === 'ATTENTION'
                        ? 'default'
                        : 'secondary'
                  }
                >
                  {boardData.filter((item) => item.column === column.id).length}
                </Badge>
              </div>
            </KanbanHeader>

            <KanbanCards<AccountBoardItem> className="gap-3 p-3" id={column.id}>
              {(item) => (
                <KanbanCard<AccountBoardItem>
                  key={item.id}
                  {...item}
                  className="gap-3 border border-border/60 bg-background px-4 py-4 shadow-none transition-colors hover:border-foreground/20"
                >
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="line-clamp-2 font-medium leading-5">
                        {item.organization.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.organization.slug}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge
                        variant={getWorkflowBadgeVariant(
                          item.organization.workflow.accountOwnershipStatus,
                        )}
                      >
                        {
                          ownershipStatusLabels[
                            item.organization.workflow.accountOwnershipStatus
                          ]
                        }
                      </Badge>
                      <Badge
                        variant={getNextActionBadgeVariant(
                          item.organization.operationalSummary.nextActionStatus,
                        )}
                      >
                        {
                          nextActionStatusLabels[
                            item.organization.operationalSummary
                              .nextActionStatus
                          ]
                        }
                      </Badge>
                      {item.organization.operationalSummary.prioritySupport ? (
                        <Badge>Priority</Badge>
                      ) : null}
                      {item.organization.operationalSummary
                        .activeBlockersCount > 0 ? (
                        <Badge variant="destructive">
                          {
                            item.organization.operationalSummary
                              .activeBlockersCount
                          }{' '}
                          bloqueios
                        </Badge>
                      ) : null}
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-3 text-muted-foreground">
                        <span>
                          {item.organization.internalOwnerUser?.name ??
                            'Sem owner'}
                        </span>
                        <span>
                          {
                            item.organization.operationalSummary
                              .breachedRequestsCount
                          }{' '}
                          violado ·{' '}
                          {
                            item.organization.operationalSummary
                              .dueSoonRequestsCount
                          }{' '}
                          vencendo
                        </span>
                      </div>
                      <Separator />
                      <div className="flex items-center justify-between gap-3 text-muted-foreground">
                        <span>
                          Score{' '}
                          {item.organization.operationalSummary.attentionScore}
                        </span>
                        <span>{healthLabels[item.column]}</span>
                      </div>
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={(event) => {
                        event.stopPropagation()
                        void navigate({
                          params: { id: item.organizationId },
                          to: '/backoffice/customer-success/accounts/$id',
                        })
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      Abrir conta
                    </Button>
                  </div>
                </KanbanCard>
              )}
            </KanbanCards>
          </KanbanBoard>
        )}
      </KanbanProvider>
    </div>
  )
}

export function TicketBoard(props: {
  requests: SupportQueueItem[]
  onMoveStatus: (requestId: number, status: SupportRequestStatus) => void
}) {
  const navigate = useNavigate()
  const boardSource = useMemo<SupportBoardItem[]>(
    () =>
      props.requests.map((request) => ({
        id: `request-${request.id}`,
        name: request.subject,
        column: request.status,
        requestId: request.id,
        request,
      })),
    [props.requests],
  )
  const [boardSourceSnapshot, setBoardSourceSnapshot] =
    useState<SupportBoardItem[]>(boardSource)
  const [boardData, setBoardData] = useState<SupportBoardItem[]>(boardSource)
  const [dragOrigin, setDragOrigin] = useState<{
    itemId: string
    column: SupportRequestStatus
  } | null>(null)

  if (boardSource !== boardSourceSnapshot) {
    setBoardSourceSnapshot(boardSource)
    setBoardData(boardSource)
  }

  const handleDragEnd = (event: KanbanDragEndEvent) => {
    const activeItem = boardData.find(
      (item) => item.id === String(event.active.id),
    )
    const originColumn =
      dragOrigin?.itemId === String(event.active.id) ? dragOrigin.column : null
    const nextColumn = resolveKanbanDropColumn(
      event,
      boardData,
      supportBoardColumns,
    )

    setDragOrigin(null)

    if (
      !activeItem ||
      !originColumn ||
      !nextColumn ||
      originColumn === nextColumn
    ) {
      return
    }

    props.onMoveStatus(activeItem.requestId, nextColumn)
  }

  if (boardData.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
        Nenhum ticket corresponde aos filtros atuais.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto pb-2">
      <KanbanProvider<SupportBoardItem, SupportBoardColumn>
        className="min-w-max auto-cols-[minmax(19rem,19rem)] gap-4 xl:auto-cols-[minmax(20rem,1fr)]"
        columns={supportBoardColumns}
        data={boardData}
        onDataChange={setBoardData}
        onDragEnd={handleDragEnd}
        onDragStart={(event) => {
          const activeItem = boardData.find(
            (item) => item.id === String(event.active.id),
          )

          setDragOrigin(
            activeItem
              ? { itemId: activeItem.id, column: activeItem.column }
              : null,
          )
        }}
      >
        {(column) => (
          <KanbanBoard
            key={column.id}
            className="min-h-[30rem] border-border/70 bg-muted/20 shadow-none"
            id={column.id}
          >
            <KanbanHeader className="space-y-3 border-b bg-background/80">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium">{column.name}</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {column.description}
                  </p>
                </div>
                <Badge variant="outline">
                  {boardData.filter((item) => item.column === column.id).length}
                </Badge>
              </div>
            </KanbanHeader>

            <KanbanCards<SupportBoardItem> className="gap-3 p-3" id={column.id}>
              {(item) => (
                <KanbanCard<SupportBoardItem>
                  key={item.id}
                  {...item}
                  className="gap-3 border border-border/60 bg-background px-4 py-4 shadow-none transition-colors hover:border-foreground/20"
                >
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="line-clamp-2 font-medium leading-5">
                          {item.request.subject}
                        </p>
                        <Badge variant="outline">#{item.requestId}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {item.request.organization?.name ??
                          'Organização removida'}{' '}
                        · {item.request.category}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge
                        variant={getPriorityBadgeVariant(item.request.priority)}
                      >
                        {requestPriorityLabels[item.request.priority]}
                      </Badge>
                      <Badge
                        variant={getSlaBadgeVariant(item.request.slaStatus)}
                      >
                        {slaStatusLabels[item.request.slaStatus]}
                      </Badge>
                      <Badge
                        variant={getHealthBadgeVariant(
                          item.request.organizationHealth,
                        )}
                      >
                        {healthLabels[item.request.organizationHealth]}
                      </Badge>
                      {item.request.needsEscalation ? (
                        <Badge variant="destructive">Escalação pendente</Badge>
                      ) : null}
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-3 text-muted-foreground">
                        <span>
                          {item.request.assignedToUser?.name ??
                            'Sem responsável'}
                        </span>
                        <span>
                          {formatRelativeSla(item.request.timeToSlaMs)}
                        </span>
                      </div>
                      <Separator />
                      <div className="flex items-center justify-between gap-3 text-muted-foreground">
                        <span>Score {item.request.attentionScore}</span>
                        <span>{requestStatusLabels[item.column]}</span>
                      </div>
                    </div>

                    {item.request.organization?.id ? (
                      <OpenAccountButton
                        organizationId={item.request.organization.id}
                        navigate={navigate}
                      />
                    ) : null}
                  </div>
                </KanbanCard>
              )}
            </KanbanCards>
          </KanbanBoard>
        )}
      </KanbanProvider>
    </div>
  )
}

function OpenAccountButton({
  organizationId,
  navigate,
}: {
  organizationId: string
  navigate: (options: {
    params: { id: string }
    to: '/backoffice/customer-success/accounts/$id'
  }) => Promise<unknown> | void
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="w-full"
      onClick={(event) => {
        event.stopPropagation()
        void navigate({
          params: { id: organizationId },
          to: '/backoffice/customer-success/accounts/$id',
        })
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      Abrir conta
    </Button>
  )
}
