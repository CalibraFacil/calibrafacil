import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle01Icon,
  Logout01Icon,
  PauseIcon,
  PlayIcon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import {
  SectionPanel,
  StatusChip,
  type StatusDescriptor,
} from '@/features/backoffice/console'
import { formatDateTime } from '@/features/backoffice/customer-success/model'
import type { BackofficeOrganizationDetail } from '@/features/backoffice/types'

type LifecycleAction =
  | 'suspend'
  | 'reactivate'
  | 'schedule_offboard'
  | 'cancel_offboard'

function statusDescriptor(status: string): StatusDescriptor {
  switch (status) {
    case 'SUSPENDED':
      return { label: 'Suspensa', tone: 'critical' }
    case 'OFFBOARDING':
      return { label: 'Em offboarding', tone: 'warning' }
    default:
      return { label: 'Ativa', tone: 'ok' }
  }
}

export function AccountLifecycleCard({
  organizationId,
  organization,
}: {
  organizationId: string
  organization: BackofficeOrganizationDetail['organization'] | undefined
}) {
  const queryClient = useQueryClient()
  const status = organization?.status ?? 'ACTIVE'
  const descriptor = statusDescriptor(status)

  const mutation = useMutation({
    mutationFn: (input: {
      action: LifecycleAction
      reason?: string
      graceDays?: number
    }) =>
      calibraApi.backoffice.updateOrganizationLifecycle(organizationId, input),
    onSuccess: async (_, variables) => {
      toast.success(
        variables.action === 'suspend'
          ? 'Conta suspensa'
          : variables.action === 'reactivate'
            ? 'Conta reativada'
            : variables.action === 'schedule_offboard'
              ? 'Offboarding agendado'
              : 'Offboarding cancelado',
      )
      await queryClient.invalidateQueries({
        queryKey: ['backoffice', 'organizations', organizationId],
      })
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar a conta',
      ),
  })

  return (
    <SectionPanel
      eyebrow="Ciclo de vida"
      title="Estado da conta"
      description="Suspenda ou inicie o offboarding direto do console — registrado na auditoria."
      action={<StatusChip status={descriptor} dot />}
      contentClassName="space-y-3"
    >
      {status === 'SUSPENDED' ? (
        <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          Acesso bloqueado desde{' '}
          {formatDateTime(organization?.suspendedAt ?? null)}.
          {organization?.suspensionReason
            ? ` Motivo: ${organization.suspensionReason}`
            : ''}
        </p>
      ) : status === 'OFFBOARDING' ? (
        <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          Exclusão agendada para{' '}
          {formatDateTime(organization?.deletionScheduledAt ?? null)}.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Conta operando normalmente.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {status === 'ACTIVE' ? (
          <>
            <ReasonDialog
              title="Suspender conta"
              description="O acesso do laboratório será bloqueado imediatamente até a reativação. Informe o motivo (registrado na auditoria)."
              confirmLabel="Suspender"
              triggerLabel="Suspender"
              triggerIcon={PauseIcon}
              pending={mutation.isPending}
              onConfirm={(reason) =>
                mutation.mutate({ action: 'suspend', reason })
              }
            />
            <ReasonDialog
              title="Agendar offboarding"
              description="Marca a conta para encerramento com 30 dias de carência. O acesso continua até a exclusão."
              confirmLabel="Agendar"
              triggerLabel="Offboarding"
              triggerIcon={Logout01Icon}
              pending={mutation.isPending}
              onConfirm={(reason) =>
                mutation.mutate({
                  action: 'schedule_offboard',
                  reason,
                  graceDays: 30,
                })
              }
            />
          </>
        ) : null}
        {status === 'SUSPENDED' ? (
          <Button
            size="sm"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ action: 'reactivate' })}
            className="min-h-9 transition-transform active:scale-[0.96]"
          >
            <HugeiconsIcon icon={PlayIcon} className="size-4" />
            Reativar
          </Button>
        ) : null}
        {status === 'OFFBOARDING' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ action: 'cancel_offboard' })}
            className="min-h-9 transition-transform active:scale-[0.96]"
          >
            <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-4" />
            Cancelar offboarding
          </Button>
        ) : null}
      </div>
    </SectionPanel>
  )
}

function ReasonDialog({
  title,
  description,
  confirmLabel,
  triggerLabel,
  triggerIcon,
  pending,
  onConfirm,
}: {
  title: string
  description: string
  confirmLabel: string
  triggerLabel: string
  triggerIcon: Parameters<typeof HugeiconsIcon>[0]['icon']
  pending: boolean
  onConfirm: (reason: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <HugeiconsIcon icon={triggerIcon} className="size-4" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Textarea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Motivo (opcional, registrado na auditoria)"
        />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancelar
          </DialogClose>
          <Button
            disabled={pending}
            onClick={() => {
              onConfirm(reason.trim())
              setOpen(false)
            }}
            className="transition-transform active:scale-[0.96]"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
