import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import type {
  IntegrationRunMode,
  IntegrationScheduleFrequency,
} from '@calibra-facil/shared'
import { calibraApi } from '@/utils/api'
import { integrationTargetMeta } from '@/features/settings/integrations-model'
import type { SyncTarget } from '@/features/settings/types'

/**
 * Connector-level mutations shared by the Conta Azul and generic HTTP cards.
 * The integration id is bound once so call sites only pass what varies.
 */
export function useConnectorMutations({
  integrationId,
  onRefresh,
}: {
  integrationId: string
  onRefresh: () => Promise<void>
}) {
  const validate = useMutation({
    mutationFn: async () => calibraApi.integrations.validate(integrationId),
    onSuccess: async () => {
      toast.success('Conexão validada')
      await onRefresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao validar conexão',
      )
    },
  })

  const toggle = useMutation({
    mutationFn: async ({ enabled }: { enabled: boolean }) =>
      calibraApi.integrations.toggle(integrationId, { enabled }),
    onSuccess: async () => {
      toast.success('Status da integração atualizado')
      await onRefresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar status',
      )
    },
  })

  const sync = useMutation({
    mutationFn: async ({ target }: { target: SyncTarget }) =>
      calibraApi.integrations.sync(integrationId, { target, limit: 50 }),
    onSuccess: async (data, variables) => {
      const queued =
        data && typeof data === 'object' && 'queued' in data && data.queued
      toast.success(
        queued
          ? `${integrationTargetMeta[variables.target].label} enfileirados`
          : `${integrationTargetMeta[variables.target].label} sincronizados`,
      )
      await onRefresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao iniciar sync',
      )
    },
  })

  const schedule = useMutation({
    mutationFn: async ({
      frequency,
      mode,
      target,
    }: {
      target: SyncTarget
      mode: IntegrationRunMode
      frequency?: IntegrationScheduleFrequency
    }) =>
      calibraApi.integrations.schedule(integrationId, {
        target,
        mode,
        frequency,
      }),
    onSuccess: async () => {
      toast.success('Agendamento atualizado')
      await onRefresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar agenda',
      )
    },
  })

  const retry = useMutation({
    mutationFn: async ({ runId }: { runId: string }) =>
      calibraApi.integrations.retryRun(integrationId, runId),
    onSuccess: async () => {
      toast.success('Reprocessamento disparado')
      await onRefresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao reprocessar sync',
      )
    },
  })

  return { validate, toggle, sync, schedule, retry }
}

export type ConnectorMutations = ReturnType<typeof useConnectorMutations>
