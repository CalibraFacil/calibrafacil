import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import { FEATURE_FLAGS } from '@calibra-facil/shared'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { SectionPanel, StatusChip } from '@/features/backoffice/console'
import { useBackofficeEntitlementOverridesData } from '@/features/backoffice/queries'
import { formatDateTime } from '@/features/backoffice/customer-success/model'
import type { BackofficeEntitlementOverride } from '@/features/backoffice/types'

const FEATURE_LABELS: Record<string, string> = {
  math_engine: 'Motor de incerteza',
  portal: 'Portal do cliente',
  financial: 'Módulo financeiro',
  financial_integrations: 'Integrações financeiras',
  api: 'Acesso à API',
  custom_domain: 'Domínio personalizado',
  sso: 'SSO',
  approval_workflow: 'Fluxo de aprovação',
  advanced_audit_trail: 'Auditoria avançada',
  custom_templates: 'Templates personalizados',
  priority_support: 'Suporte prioritário',
  multi_unit: 'Multiunidade',
  custom_integrations: 'Integrações customizadas',
}

function featureLabel(feature: string) {
  return FEATURE_LABELS[feature] ?? feature
}

export function EntitlementOverridesCard({
  organizationId,
}: {
  organizationId: string
}) {
  const queryClient = useQueryClient()
  const query = useBackofficeEntitlementOverridesData(organizationId)
  const [feature, setFeature] = useState<string>(FEATURE_FLAGS[0])
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState('')

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ['backoffice', 'entitlement-overrides', organizationId],
    })

  const grant = useMutation({
    mutationFn: (input: {
      feature: string
      reason?: string
      expiresAt?: string
    }) => calibraApi.backoffice.grantEntitlementOverride(organizationId, input),
    onSuccess: async () => {
      toast.success('Acesso concedido')
      setReason('')
      setExpiresAt('')
      await invalidate()
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Falha ao conceder acesso',
      ),
  })

  const revoke = useMutation({
    mutationFn: (id: number) =>
      calibraApi.backoffice.revokeEntitlementOverride(id),
    onSuccess: async () => {
      toast.success('Concessão revogada')
      await invalidate()
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Falha ao revogar'),
  })

  const overrides = query.data?.data ?? []

  return (
    <SectionPanel
      eyebrow="Entitlements"
      title="Concessões de acesso"
      description="Libere recursos acima do plano (comps, trials de upsell) — aditivo, opcionalmente com validade, e auditado."
      contentClassName="space-y-4"
    >
      <form
        className="grid gap-2 sm:grid-cols-[1.2fr_1fr_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          grant.mutate({
            feature,
            reason: reason.trim() || undefined,
            expiresAt: expiresAt
              ? new Date(expiresAt).toISOString()
              : undefined,
          })
        }}
      >
        <NativeSelect
          className="w-full"
          value={feature}
          onChange={(event) => setFeature(event.target.value)}
        >
          {FEATURE_FLAGS.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {featureLabel(value)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Motivo (opcional)"
        />
        <Input
          type="date"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
          className="w-full sm:w-auto"
        />
        <Button
          type="submit"
          disabled={grant.isPending}
          className="min-h-10 transition-transform active:scale-[0.96]"
        >
          <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
          Conceder
        </Button>
      </form>

      {query.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full rounded-xl" />
          ))}
        </div>
      ) : overrides.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma concessão ativa — a conta usa apenas o que o plano inclui.
        </p>
      ) : (
        <div className="space-y-2">
          {overrides.map((override) => (
            <OverrideRow
              key={override.id}
              override={override}
              onRevoke={() => revoke.mutate(override.id)}
              revoking={revoke.isPending}
            />
          ))}
        </div>
      )}
    </SectionPanel>
  )
}

function OverrideRow({
  override,
  onRevoke,
  revoking,
}: {
  override: BackofficeEntitlementOverride
  onRevoke: () => void
  revoking: boolean
}) {
  const expired =
    override.expiresAt != null && new Date(override.expiresAt) < new Date()
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip tone={expired ? 'neutral' : 'ok'}>
            {featureLabel(override.feature)}
          </StatusChip>
          {expired ? (
            <span className="text-xs text-muted-foreground">expirada</span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {override.createdByName ? `${override.createdByName} · ` : ''}
          {override.reason ? `${override.reason} · ` : ''}
          {override.expiresAt ? (
            <span className={cn(expired && 'text-destructive')}>
              até {formatDateTime(override.expiresAt)}
            </span>
          ) : (
            'sem validade'
          )}
        </span>
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={onRevoke}
        disabled={revoking}
        className="min-h-9 shrink-0"
      >
        <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
        Revogar
      </Button>
    </div>
  )
}
