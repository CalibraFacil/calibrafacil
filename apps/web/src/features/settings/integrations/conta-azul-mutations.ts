import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import type {
  ContaAzulConnectionConfig,
  ContaAzulConnectionConfigInput,
} from '@calibra-facil/shared'
import { calibraApi } from '@/utils/api'
import type { SettingsIntegrationsData } from '@/features/settings/types'

const INTEGRATIONS_QUERY_KEY = ['integrations'] as const

function applyOptimisticContaAzulConfig(
  cache: SettingsIntegrationsData | undefined,
  integrationId: string,
  input: ContaAzulConnectionConfigInput,
): SettingsIntegrationsData | undefined {
  // Domain toggles are the field the user mutates rapidly — and the only one
  // where the cache-vs-server-roundtrip lag is visible enough to matter.
  // Optimistically merging only `enabledTargets` keeps the types narrow; other
  // field changes (default selects, modes) get the same cache-vs-fetch speedup
  // via `setQueryData(data)` in `onSuccess`, which is one round-trip faster
  // than `invalidateQueries`.
  if (!cache || !input.enabledTargets) return cache
  const enabledTargetsPatch = input.enabledTargets
  return {
    ...cache,
    data: cache.data.map((integration) => {
      if (integration.id !== integrationId) return integration
      const currentConfig = integration.connection.config
      // ContaAzulConnectionConfig is the only branch with a `provider`
      // discriminator. Skip optimistic merge if config is missing or the
      // generic-HTTP variant — those don't have enabledTargets.
      if (!currentConfig || !('provider' in currentConfig)) {
        return integration
      }
      const mergedConfig: ContaAzulConnectionConfig = {
        ...currentConfig,
        enabledTargets: {
          ...currentConfig.enabledTargets,
          ...enabledTargetsPatch,
        },
      }
      return {
        ...integration,
        connection: { ...integration.connection, config: mergedConfig },
      }
    }),
  }
}

function pollMutation({
  errorMessage,
  integrationId,
  onRefresh,
  request,
  successMessage,
}: {
  errorMessage: string
  integrationId: string
  onRefresh: () => Promise<void>
  request: (id: string) => Promise<unknown>
  successMessage: string
}) {
  return {
    mutationFn: async () => request(integrationId),
    onSuccess: async () => {
      toast.success(successMessage)
      await onRefresh()
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : errorMessage)
    },
  }
}

/** Conta Azul native operations: config, reconciliation polls, token, disconnect. */
export function useContaAzulMutations({
  integrationId,
  onRefresh,
  refreshCatalogs,
}: {
  integrationId: string
  onRefresh: () => Promise<void>
  refreshCatalogs: () => Promise<void>
}) {
  const queryClient = useQueryClient()
  const config = useMutation({
    mutationFn: async (input: ContaAzulConnectionConfigInput) =>
      calibraApi.integrations.updateContaAzulConfig<SettingsIntegrationsData>(
        integrationId,
        input,
      ),
    // Optimistic update: write the partial change into the cache before the
    // server responds so the toggle/select moves at click-speed. The server is
    // the source of truth and its response overwrites the cache on success;
    // failures roll back to the pre-mutation snapshot.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: INTEGRATIONS_QUERY_KEY })
      const previous = queryClient.getQueryData<SettingsIntegrationsData>(
        INTEGRATIONS_QUERY_KEY,
      )
      queryClient.setQueryData<SettingsIntegrationsData>(
        INTEGRATIONS_QUERY_KEY,
        (cache) => applyOptimisticContaAzulConfig(cache, integrationId, input),
      )
      return { previous }
    },
    onSuccess: (data) => {
      // Replace the optimistic cache with the server's authoritative payload —
      // skips the extra refetch round-trip that invalidateQueries would force.
      queryClient.setQueryData<SettingsIntegrationsData>(
        INTEGRATIONS_QUERY_KEY,
        data,
      )
      toast.success('Configuração da Conta Azul salva')
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData<SettingsIntegrationsData>(
          INTEGRATIONS_QUERY_KEY,
          context.previous,
        )
      }
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao salvar configuração da Conta Azul',
      )
    },
  })

  const pollReceivables = useMutation(
    pollMutation({
      integrationId,
      onRefresh,
      request: (id) =>
        calibraApi.integrations.pollContaAzul(id, { limit: 100 }),
      successMessage: 'Consulta de pagamentos concluída',
      errorMessage: 'Falha ao consultar pagamentos da Conta Azul',
    }),
  )

  const pollPayables = useMutation(
    pollMutation({
      integrationId,
      onRefresh,
      request: (id) =>
        calibraApi.integrations.pollContaAzulPayables(id, { limit: 100 }),
      successMessage: 'Consulta de contas a pagar concluída',
      errorMessage: 'Falha ao consultar contas a pagar da Conta Azul',
    }),
  )

  const pollFiscal = useMutation(
    pollMutation({
      integrationId,
      onRefresh,
      request: (id) =>
        calibraApi.integrations.pollContaAzulFiscal(id, { limit: 100 }),
      successMessage: 'Consulta fiscal concluída',
      errorMessage: 'Falha ao consultar documentos fiscais da Conta Azul',
    }),
  )

  const pollProtocols = useMutation(
    pollMutation({
      integrationId,
      onRefresh,
      request: (id) =>
        calibraApi.integrations.pollContaAzulProtocols(id, { limit: 100 }),
      successMessage: 'Consulta de protocolos concluída',
      errorMessage: 'Falha ao consultar protocolos da Conta Azul',
    }),
  )

  const pollDrift = useMutation(
    pollMutation({
      integrationId,
      onRefresh,
      request: (id) =>
        calibraApi.integrations.pollContaAzulDrift(id, { limit: 100 }),
      successMessage: 'Verificação de drift concluída',
      errorMessage: 'Falha ao verificar drift da Conta Azul',
    }),
  )

  const refreshToken = useMutation({
    mutationFn: async () =>
      calibraApi.integrations.refreshContaAzul(integrationId),
    onSuccess: async () => {
      toast.success('Token Conta Azul renovado')
      await refreshCatalogs()
      await onRefresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao renovar token da Conta Azul',
      )
    },
  })

  const disconnect = useMutation({
    mutationFn: async () =>
      calibraApi.integrations.disconnectContaAzul(integrationId),
    onSuccess: async () => {
      toast.success('Conta Azul desconectada')
      await onRefresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao desconectar Conta Azul',
      )
    },
  })

  return {
    config,
    pollReceivables,
    pollPayables,
    pollFiscal,
    pollProtocols,
    pollDrift,
    refreshToken,
    disconnect,
  }
}

export type ContaAzulMutations = ReturnType<typeof useContaAzulMutations>
