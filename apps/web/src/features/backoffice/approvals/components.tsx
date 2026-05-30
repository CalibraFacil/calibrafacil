import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight02Icon,
  CheckmarkCircle01Icon,
  Invoice01Icon,
  ShieldKeyIcon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ConsoleEmpty,
  SectionPanel,
  StatusChip,
} from '@/features/backoffice/console'
import { useBackofficeApprovalsData } from '@/features/backoffice/queries'
import type {
  BackofficeApprovalKind,
  BackofficeApprovalRequest,
} from '@/features/backoffice/types'

const APPROVAL_KINDS = ['refund', 'credit', 'adjustment', 'other'] as const

const KIND_LABELS: Record<BackofficeApprovalKind, string> = {
  refund: 'Reembolso',
  credit: 'Crédito',
  adjustment: 'Ajuste',
  other: 'Outro',
}

const KIND_TONES: Record<
  BackofficeApprovalKind,
  'warning' | 'info' | 'neutral'
> = {
  refund: 'warning',
  credit: 'info',
  adjustment: 'neutral',
  other: 'neutral',
}

function formatBRL(cents: number | null): string | null {
  if (cents === null) return null
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function relativeTime(value: string): string {
  return formatDistanceToNow(new Date(value), { addSuffix: true, locale: ptBR })
}

function useCreateApprovalRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      organizationId: string
      kind: BackofficeApprovalKind
      summary: string
      amountCents?: number
    }) => calibraApi.backoffice.createApprovalRequest(input),
    onSuccess: async () => {
      toast.success('Solicitação aberta para aprovação')
      await queryClient.invalidateQueries({
        queryKey: ['backoffice', 'approvals'],
      })
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Falha ao abrir solicitação',
      ),
  })
}

function useDecideApproval() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: number
      decision: 'approve' | 'reject'
      reason?: string
    }) =>
      calibraApi.backoffice.decideApproval(input.id, {
        decision: input.decision,
        reason: input.reason,
      }),
    onSuccess: async (_data, variables) => {
      toast.success(
        variables.decision === 'approve'
          ? 'Solicitação aprovada'
          : 'Solicitação recusada',
      )
      await queryClient.invalidateQueries({
        queryKey: ['backoffice', 'approvals'],
      })
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao decidir solicitação',
      ),
  })
}

/**
 * Per-account "request a sensitive money action" form (account profile). The
 * request enters the maker-checker queue and must be approved by a *different*
 * platform admin before it is acted on.
 */
export function RequestApprovalCard({
  organizationId,
}: {
  organizationId: string
}) {
  const create = useCreateApprovalRequest()
  const [kind, setKind] = useState<BackofficeApprovalKind>('refund')
  const [summary, setSummary] = useState('')
  const [amount, setAmount] = useState('')

  const canSubmit = summary.trim().length >= 3

  const submit = () => {
    if (!canSubmit) return
    const parsedAmount = Number.parseFloat(amount.replace(',', '.'))
    const amountCents =
      amount.trim() && Number.isFinite(parsedAmount)
        ? Math.round(parsedAmount * 100)
        : undefined
    create.mutate(
      { organizationId, kind, summary: summary.trim(), amountCents },
      {
        onSuccess: () => {
          setSummary('')
          setAmount('')
          setKind('refund')
        },
      },
    )
  }

  return (
    <SectionPanel
      eyebrow="Governança"
      title="Solicitar aprovação"
      description="Reembolsos, créditos e ajustes exigem controle duplo — outra pessoa precisa aprovar."
      contentClassName="space-y-3"
    >
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
          <NativeSelect
            className="w-full sm:w-auto"
            value={kind}
            onChange={(event) => {
              const next = event.target.value
              if (
                next === 'refund' ||
                next === 'credit' ||
                next === 'adjustment' ||
                next === 'other'
              ) {
                setKind(next)
              }
            }}
          >
            {APPROVAL_KINDS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {KIND_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="Valor (R$) — opcional"
          />
        </div>
        <Input
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="Motivo / descrição da solicitação"
        />
        <Button
          type="submit"
          disabled={!canSubmit || create.isPending}
          className="min-h-10 w-full transition-transform active:scale-[0.96] sm:w-auto"
        >
          <HugeiconsIcon icon={ShieldKeyIcon} className="size-4" />
          Enviar para aprovação
        </Button>
      </form>
    </SectionPanel>
  )
}

/**
 * Cross-account pending-approvals queue (command center). Any operator sees it;
 * the decision is server-gated to platform admins who are *not* the requester.
 */
export function ApprovalsQueuePanel() {
  const query = useBackofficeApprovalsData({ status: 'pending' })
  const decide = useDecideApproval()
  const approvals = query.data?.data ?? []

  return (
    <SectionPanel
      eyebrow="Governança"
      title="Aprovações pendentes"
      description="Ações sensíveis aguardando controle duplo (reembolso, crédito, ajuste)."
      action={
        approvals.length > 0 ? (
          <StatusChip tone="warning">{approvals.length} pendente(s)</StatusChip>
        ) : null
      }
    >
      {query.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : approvals.length === 0 ? (
        <ConsoleEmpty
          icon={CheckmarkCircle01Icon}
          title="Nenhuma aprovação pendente"
          description="Solicitações sensíveis aparecem aqui para controle duplo."
        />
      ) : (
        <div className="space-y-2">
          {approvals.map((approval) => (
            <ApprovalRow
              key={approval.id}
              approval={approval}
              onDecide={(decision, reason) =>
                decide.mutate({ id: approval.id, decision, reason })
              }
              deciding={decide.isPending}
            />
          ))}
        </div>
      )}
    </SectionPanel>
  )
}

function ApprovalRow({
  approval,
  onDecide,
  deciding,
}: {
  approval: BackofficeApprovalRequest
  onDecide: (decision: 'approve' | 'reject', reason?: string) => void
  deciding: boolean
}) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const amount = formatBRL(approval.amountCents)

  return (
    <div className="rounded-xl px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip tone={KIND_TONES[approval.kind]} icon={Invoice01Icon}>
              {KIND_LABELS[approval.kind]}
            </StatusChip>
            {amount ? (
              <span className="text-sm font-semibold tabular-nums">
                {amount}
              </span>
            ) : null}
          </span>
          <p className="mt-1 text-sm">{approval.summary}</p>
          <Link
            to="/backoffice/accounts/$id"
            params={{ id: approval.organizationId }}
            className="group mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground"
          >
            <span className="truncate">{approval.organizationName}</span>
            <HugeiconsIcon
              icon={ArrowRight02Icon}
              className="size-3 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5"
            />
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {approval.requestedByName
              ? `por ${approval.requestedByName} · `
              : ''}
            {relativeTime(approval.createdAt)}
          </p>
        </div>
      </div>

      {rejecting ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo da recusa (opcional)"
            autoFocus
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={deciding}
            onClick={() => onDecide('reject', reason.trim() || undefined)}
            className="min-h-9"
          >
            Confirmar recusa
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={deciding}
            onClick={() => {
              setRejecting(false)
              setReason('')
            }}
            className="min-h-9"
          >
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={deciding}
            onClick={() => setRejecting(true)}
            className="min-h-9"
          >
            Recusar
          </Button>
          <Button
            size="sm"
            disabled={deciding}
            onClick={() => onDecide('approve')}
            className="min-h-9 transition-transform active:scale-[0.96]"
          >
            <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-4" />
            Aprovar
          </Button>
        </div>
      )}
    </div>
  )
}
