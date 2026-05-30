import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight02Icon,
  CheckmarkCircle01Icon,
  PlusSignIcon,
  TaskDone01Icon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  ConsoleEmpty,
  SectionPanel,
  StatusChip,
} from '@/features/backoffice/console'
import { useBackofficeAccountTasksData } from '@/features/backoffice/queries'
import type { BackofficeAccountTask } from '@/features/backoffice/types'

const TASK_TYPES = [
  'GENERAL',
  'ONBOARDING',
  'MIGRATION',
  'GO_LIVE',
  'DUNNING',
  'CHECK_IN',
] as const

const TASK_TYPE_LABELS: Record<string, string> = {
  GENERAL: 'Geral',
  ONBOARDING: 'Onboarding',
  MIGRATION: 'Migração',
  GO_LIVE: 'Go-live',
  DUNNING: 'Cobrança',
  CHECK_IN: 'Check-in',
}

function dueLabel(dueAt: string | null): { label: string; overdue: boolean } {
  if (!dueAt) return { label: '', overdue: false }
  const due = new Date(dueAt)
  const today = new Date()
  const startOfDue = new Date(
    due.getFullYear(),
    due.getMonth(),
    due.getDate(),
  ).getTime()
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime()
  const diffDays = Math.round((startOfDue - startOfToday) / 86_400_000)
  if (diffDays < 0)
    return { label: `${Math.abs(diffDays)}d atrás`, overdue: true }
  if (diffDays === 0) return { label: 'vence hoje', overdue: true }
  if (diffDays === 1) return { label: 'vence amanhã', overdue: false }
  return { label: `em ${diffDays}d`, overdue: false }
}

function useCreateAccountTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      organizationId: string
      title: string
      type: string
      dueAt?: string
    }) => calibraApi.backoffice.createAccountTask(input),
    onSuccess: async () => {
      toast.success('Tarefa criada')
      await queryClient.invalidateQueries({
        queryKey: ['backoffice', 'account-tasks'],
      })
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Falha ao criar tarefa',
      ),
  })
}

function useCompleteAccountTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => calibraApi.backoffice.completeAccountTask(id),
    onSuccess: async () => {
      toast.success('Tarefa concluída')
      await queryClient.invalidateQueries({
        queryKey: ['backoffice', 'account-tasks'],
      })
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Falha ao concluir tarefa',
      ),
  })
}

/** Per-account task list with an inline add form (account profile). */
export function AccountTasksCard({
  organizationId,
}: {
  organizationId: string
}) {
  const query = useBackofficeAccountTasksData({
    organizationId,
    status: 'open',
  })
  const create = useCreateAccountTask()
  const complete = useCompleteAccountTask()
  const [title, setTitle] = useState('')
  const [type, setType] = useState('GENERAL')
  const [due, setDue] = useState('')

  const tasks = query.data?.data ?? []
  const canCreate = title.trim().length >= 2

  const submit = () => {
    if (!canCreate) return
    create.mutate(
      {
        organizationId,
        title: title.trim(),
        type,
        dueAt: due ? new Date(due).toISOString() : undefined,
      },
      {
        onSuccess: () => {
          setTitle('')
          setDue('')
          setType('GENERAL')
        },
      },
    )
  }

  return (
    <SectionPanel
      eyebrow="Execução"
      title="Tarefas"
      description="Próximos passos assertivos por conta — atribuíveis, com prazo e auditáveis."
      contentClassName="space-y-4"
    >
      <form
        className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Nova tarefa…"
        />
        <NativeSelect
          className="w-full sm:w-auto"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          {TASK_TYPES.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {TASK_TYPE_LABELS[value] ?? value}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Input
          type="date"
          value={due}
          onChange={(event) => setDue(event.target.value)}
          className="w-full sm:w-auto"
        />
        <Button
          type="submit"
          disabled={!canCreate || create.isPending}
          className="min-h-10 transition-transform active:scale-[0.96]"
        >
          <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
          Adicionar
        </Button>
      </form>

      {query.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <ConsoleEmpty
          icon={CheckmarkCircle01Icon}
          title="Nenhuma tarefa aberta"
          description="Adicione um próximo passo para esta conta."
        />
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onComplete={() => complete.mutate(task.id)}
              completing={complete.isPending}
            />
          ))}
        </div>
      )}
    </SectionPanel>
  )
}

function TaskRow({
  task,
  onComplete,
  completing,
}: {
  task: BackofficeAccountTask
  onComplete: () => void
  completing: boolean
}) {
  const due = dueLabel(task.dueAt)
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{task.title}</span>
          <StatusChip tone={task.type === 'DUNNING' ? 'warning' : 'neutral'}>
            {TASK_TYPE_LABELS[task.type] ?? task.type}
          </StatusChip>
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {task.ownerName ? `${task.ownerName} · ` : ''}
          {due.label ? (
            <span className={cn(due.overdue && 'font-medium text-destructive')}>
              {due.label}
            </span>
          ) : (
            'sem prazo'
          )}
        </span>
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={onComplete}
        disabled={completing}
        className="min-h-9 shrink-0"
      >
        <HugeiconsIcon icon={TaskDone01Icon} className="size-4" />
        Concluir
      </Button>
    </div>
  )
}

/** Cross-account "my day" worklist (command center). */
export function MyTasksPanel() {
  const query = useBackofficeAccountTasksData({ scope: 'mine', status: 'open' })
  const complete = useCompleteAccountTask()
  const tasks = query.data?.data ?? []

  return (
    <SectionPanel
      eyebrow="Minha operação"
      title="Minhas tarefas"
      description="Tarefas abertas atribuídas a você, em todas as contas."
      action={
        tasks.length > 0 ? (
          <StatusChip tone="info">{tasks.length} aberta(s)</StatusChip>
        ) : null
      }
    >
      {query.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <ConsoleEmpty
          icon={CheckmarkCircle01Icon}
          title="Sem tarefas atribuídas"
          description="Você está em dia — nenhuma tarefa aberta no seu nome."
        />
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const due = dueLabel(task.dueAt)
            return (
              <div
                key={task.id}
                className="flex items-center gap-3 rounded-xl px-3 py-2 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
              >
                <Link
                  to="/backoffice/accounts/$id"
                  params={{ id: task.organizationId }}
                  className="group min-w-0 flex-1"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">
                      {task.title}
                    </span>
                    <HugeiconsIcon
                      icon={ArrowRight02Icon}
                      className="size-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {task.organizationName}
                    {due.label ? (
                      <>
                        {' · '}
                        <span
                          className={cn(
                            due.overdue && 'font-medium text-destructive',
                          )}
                        >
                          {due.label}
                        </span>
                      </>
                    ) : null}
                  </span>
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => complete.mutate(task.id)}
                  disabled={complete.isPending}
                  className="min-h-9 shrink-0"
                >
                  <HugeiconsIcon icon={TaskDone01Icon} className="size-4" />
                  Concluir
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </SectionPanel>
  )
}
