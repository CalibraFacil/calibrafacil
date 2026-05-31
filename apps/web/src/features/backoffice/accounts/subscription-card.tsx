import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  RefreshIcon,
  CreditCardIcon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { type SignalTone } from '@/components/instrument-panel'
import { SectionPanel, StatusChip } from '@/features/backoffice/console'

const PLANS = ['FREE', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE'] as const
type PlanId = (typeof PLANS)[number]

const PLAN_LABELS: Record<string, string> = {
  FREE: 'Free',
  STANDARD: 'Standard',
  PROFESSIONAL: 'Professional',
  ENTERPRISE: 'Enterprise',
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativa',
  TRIAL: 'Trial',
  PAST_DUE: 'Inadimplente',
  CANCELED: 'Cancelada',
}

function statusTone(status: string): SignalTone {
  if (status === 'ACTIVE') return 'ok'
  if (status === 'TRIAL') return 'info'
  if (status === 'PAST_DUE') return 'warning'
  if (status === 'CANCELED') return 'critical'
  return 'neutral'
}

function isPlanId(value: string): value is PlanId {
  return PLANS.some((plan) => plan === value)
}

type SubscriptionSummary = {
  planId: string
  status: string
  billingCycle: string | null
} | null

function useManageSubscription(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      action: 'change_plan' | 'cancel' | 'reactivate'
      planId?: PlanId
      reason?: string
    }) => calibraApi.backoffice.manageSubscription(organizationId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['backoffice', 'commercial', 'context', organizationId],
      })
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar assinatura',
      ),
  })
}

/**
 * Operator-managed subscription state (gap #10 core) — change plan, cancel with a
 * reason, reactivate. Entitlements follow immediately; Asaas billing is reconciled
 * separately (this never touches billing credentials).
 */
export function SubscriptionManagementCard({
  organizationId,
  subscription,
}: {
  organizationId: string
  subscription: SubscriptionSummary
}) {
  const manage = useManageSubscription(organizationId)
  const currentPlan = subscription?.planId ?? 'FREE'
  const status = subscription?.status ?? 'ACTIVE'
  const isCanceled = status === 'CANCELED'

  const [plan, setPlan] = useState<PlanId>(
    isPlanId(currentPlan) ? currentPlan : 'FREE',
  )
  const [reasonOpen, setReasonOpen] = useState(false)
  const [reason, setReason] = useState('')

  const changePlan = () => {
    if (plan === currentPlan) return
    manage.mutate(
      { action: 'change_plan', planId: plan },
      { onSuccess: () => toast.success('Plano alterado') },
    )
  }

  const cancel = () => {
    if (reason.trim().length < 5) return
    manage.mutate(
      { action: 'cancel', reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success('Assinatura cancelada')
          setReasonOpen(false)
          setReason('')
        },
      },
    )
  }

  const reactivate = () =>
    manage.mutate(
      { action: 'reactivate' },
      { onSuccess: () => toast.success('Assinatura reativada') },
    )

  return (
    <SectionPanel
      eyebrow="Receita"
      title="Assinatura"
      description="Plano, cancelamento e reativação. A cobrança no Asaas é ajustada à parte."
      action={
        <StatusChip tone={statusTone(status)} icon={CreditCardIcon}>
          {STATUS_LABELS[status] ?? status}
        </StatusChip>
      }
      contentClassName="space-y-3"
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <NativeSelect
          value={plan}
          onChange={(event) => {
            if (isPlanId(event.target.value)) setPlan(event.target.value)
          }}
        >
          {PLANS.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {PLAN_LABELS[value]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          type="button"
          variant="outline"
          onClick={changePlan}
          disabled={plan === currentPlan || manage.isPending}
          className="min-h-10 transition-transform active:scale-[0.96]"
        >
          Alterar plano
        </Button>
      </div>

      {isCanceled ? (
        <Button
          type="button"
          onClick={reactivate}
          disabled={manage.isPending}
          className="min-h-10 w-full transition-transform active:scale-[0.96] sm:w-auto"
        >
          <HugeiconsIcon icon={RefreshIcon} className="size-4" />
          Reativar assinatura
        </Button>
      ) : reasonOpen ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo do cancelamento (mín. 5 caracteres)"
            autoFocus
          />
          <Button
            type="button"
            variant="destructive"
            onClick={cancel}
            disabled={reason.trim().length < 5 || manage.isPending}
            className="min-h-10"
          >
            Confirmar
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setReasonOpen(false)
              setReason('')
            }}
            disabled={manage.isPending}
            className="min-h-10"
          >
            Cancelar
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => setReasonOpen(true)}
          className="min-h-10"
        >
          <HugeiconsIcon icon={Alert02Icon} className="size-4" />
          Cancelar assinatura
        </Button>
      )}
    </SectionPanel>
  )
}
