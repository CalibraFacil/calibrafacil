import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api } from '@/utils/api'
import {
  parseApiError,
  type BlockerScope,
  type HealthStatus,
  type OrganizationQueueItem,
  type ProfileDraft,
  type ProfilePayload,
  type RequestsPayload,
  type SupportQueueResponse,
  type SupportRequestStatus,
} from './model'

export function useCustomerSuccessAccess() {
  return useQuery({
    queryKey: ['backoffice', 'access'],
    queryFn: async () => {
      const res = await api.api.backoffice.access.$get()
      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Acesso ao backoffice negado'))
      }

      return res.json() as Promise<{ allowed: boolean }>
    },
    retry: false,
  })
}

export function useCustomerSuccessOrganizations(enabled = true) {
  return useQuery({
    queryKey: ['backoffice', 'customer-success', 'organizations'],
    queryFn: async () => {
      const res =
        await api.api.backoffice['customer-success'].organizations.$get()
      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao carregar contas'))
      }

      return res.json() as Promise<{ data: OrganizationQueueItem[] }>
    },
    enabled,
  })
}

export function useSupportQueue(enabled = true) {
  return useQuery({
    queryKey: ['backoffice', 'support', 'queue', 'customer-success'],
    queryFn: async () => {
      const res = await api.api.backoffice.support.queue.$get()
      if (!res.ok) {
        throw new Error(
          await parseApiError(res, 'Falha ao carregar fila de tickets'),
        )
      }

      return res.json() as Promise<SupportQueueResponse>
    },
    enabled,
  })
}

export function useOrganizationProfile(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: ['backoffice', 'customer-success', 'profile', organizationId],
    queryFn: async () => {
      const res = await api.api.backoffice['customer-success'].organizations[
        ':id'
      ].profile.$get({
        param: { id: organizationId },
      })

      if (!res.ok) {
        throw new Error(
          await parseApiError(res, 'Falha ao carregar detalhe da conta'),
        )
      }

      return res.json() as Promise<ProfilePayload>
    },
    enabled: Boolean(organizationId) && enabled,
  })
}

export function useOrganizationRequests(
  organizationId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ['backoffice', 'customer-success', 'requests', organizationId],
    queryFn: async () => {
      const res = await api.api.backoffice['customer-success'].organizations[
        ':id'
      ].requests.$get({
        param: { id: organizationId },
      })

      if (!res.ok) {
        throw new Error(
          await parseApiError(res, 'Falha ao carregar tickets da conta'),
        )
      }

      return res.json() as Promise<RequestsPayload>
    },
    enabled: Boolean(organizationId) && enabled,
  })
}

export function useRefreshCustomerSuccess(organizationId?: string) {
  const queryClient = useQueryClient()

  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['backoffice', 'customer-success', 'organizations'],
      }),
      queryClient.invalidateQueries({
        queryKey: ['backoffice', 'support', 'queue', 'customer-success'],
      }),
      queryClient.invalidateQueries({
        queryKey: ['backoffice', 'support', 'queue'],
      }),
      queryClient.invalidateQueries({
        queryKey: ['customer-success', 'profile'],
      }),
      queryClient.invalidateQueries({
        queryKey: ['customer-success', 'requests'],
      }),
      organizationId
        ? queryClient.invalidateQueries({
            queryKey: [
              'backoffice',
              'customer-success',
              'profile',
              organizationId,
            ],
          })
        : Promise.resolve(),
      organizationId
        ? queryClient.invalidateQueries({
            queryKey: [
              'backoffice',
              'customer-success',
              'requests',
              organizationId,
            ],
          })
        : Promise.resolve(),
    ])
  }, [organizationId, queryClient])
}

export function useUpdateAccountHealth() {
  const refresh = useRefreshCustomerSuccess()

  return useMutation({
    mutationFn: async ({
      organizationId,
      healthStatus,
    }: {
      organizationId: string
      healthStatus: HealthStatus
    }) => {
      const res = await api.api.backoffice['customer-success'].organizations[
        ':id'
      ].profile.$put({
        param: { id: organizationId },
        json: { healthStatus },
      })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao atualizar saúde'))
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Saúde da conta atualizada')
      await refresh()
    },
    onError: async (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar saúde',
      )
      await refresh()
    },
  })
}

export function useUpdateRequestStatus(organizationId?: string) {
  const refresh = useRefreshCustomerSuccess(organizationId)

  return useMutation({
    mutationFn: async ({
      requestId,
      status,
    }: {
      requestId: number
      status: SupportRequestStatus
    }) => {
      const res = await api.api.backoffice['customer-success'].requests[
        ':id'
      ].status.$post({
        param: { id: String(requestId) },
        json: { status },
      })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao atualizar status'))
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Status atualizado')
      await refresh()
    },
    onError: async (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar status',
      )
      await refresh()
    },
  })
}

export function useAssignRequest(organizationId?: string) {
  const refresh = useRefreshCustomerSuccess(organizationId)

  return useMutation({
    mutationFn: async ({
      requestId,
      assignedToUserId,
    }: {
      requestId: number
      assignedToUserId: string | null
    }) => {
      const res = await api.api.backoffice['customer-success'].requests[
        ':id'
      ].assign.$post({
        param: { id: String(requestId) },
        json: { assignedToUserId },
      })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao atribuir ticket'))
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Atribuição atualizada')
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao atualizar atribuição',
      )
    },
  })
}

export function useRespondRequest(organizationId?: string) {
  const refresh = useRefreshCustomerSuccess(organizationId)

  return useMutation({
    mutationFn: async ({
      requestId,
      message,
    }: {
      requestId: number
      message: string
    }) => {
      if (!message.trim()) {
        throw new Error('Informe uma resposta antes de enviar')
      }

      const res = await api.api.backoffice['customer-success'].requests[
        ':id'
      ].respond.$post({
        param: { id: String(requestId) },
        json: {
          message,
          publicVisible: true,
        },
      })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao responder'))
      }

      return res.json()
    },
    onSuccess: async (_, variables) => {
      toast.success(`Resposta enviada para o ticket #${variables.requestId}`)
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao responder ticket',
      )
    },
  })
}

export function useEscalateRequest(organizationId?: string) {
  const refresh = useRefreshCustomerSuccess(organizationId)

  return useMutation({
    mutationFn: async ({
      requestId,
      reason,
    }: {
      requestId: number
      reason: string
    }) => {
      const res = await api.api.backoffice['customer-success'].requests[
        ':id'
      ].escalate.$post({
        param: { id: String(requestId) },
        json: { reason },
      })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao escalar ticket'))
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Ticket escalado')
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao escalar ticket',
      )
    },
  })
}

export function useUpdateProfile(organizationId: string) {
  const refresh = useRefreshCustomerSuccess(organizationId)

  return useMutation({
    mutationFn: async (profileDraft: ProfileDraft) => {
      const res = await api.api.backoffice['customer-success'].organizations[
        ':id'
      ].profile.$put({
        param: { id: organizationId },
        json: {
          accountOwnerName: profileDraft.accountOwnerName,
          accountOwnerEmail: profileDraft.accountOwnerEmail || null,
          supportContactEmail: profileDraft.supportContactEmail || null,
          internalOwnerUserId: profileDraft.internalOwnerUserId || null,
          prioritySupport: profileDraft.prioritySupport,
          slaTier: profileDraft.slaTier,
          onboardingStatus: profileDraft.onboardingStatus,
          migrationStatus: profileDraft.migrationStatus,
          goLiveStatus: profileDraft.goLiveStatus,
          healthStatus: profileDraft.healthStatus,
          goLiveTargetDate: profileDraft.goLiveTargetDate
            ? new Date(profileDraft.goLiveTargetDate).toISOString()
            : null,
          goLiveActualDate: profileDraft.goLiveActualDate
            ? new Date(profileDraft.goLiveActualDate).toISOString()
            : null,
          publicStatusNote: profileDraft.publicStatusNote || null,
          internalNotes: profileDraft.internalNotes || null,
        },
      })

      if (!res.ok) {
        throw new Error(
          await parseApiError(res, 'Falha ao atualizar perfil operacional'),
        )
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Conta operacional atualizada')
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao atualizar perfil operacional',
      )
    },
  })
}

export function useNextAction(organizationId: string) {
  const refresh = useRefreshCustomerSuccess(organizationId)

  return useMutation({
    mutationFn: async ({
      nextAction,
      nextActionDueAt,
      markCompleted = false,
    }: {
      nextAction: string
      nextActionDueAt: string
      markCompleted?: boolean
    }) => {
      const res = await api.api.backoffice['customer-success'].organizations[
        ':id'
      ]['next-action'].$post({
        param: { id: organizationId },
        json: {
          nextAction: markCompleted ? null : nextAction || null,
          nextActionDueAt:
            markCompleted || !nextActionDueAt
              ? null
              : new Date(nextActionDueAt).toISOString(),
          markCompleted,
        },
      })

      if (!res.ok) {
        throw new Error(
          await parseApiError(res, 'Falha ao atualizar próxima ação'),
        )
      }

      return res.json()
    },
    onSuccess: async (_, variables) => {
      toast.success(
        variables.markCompleted
          ? 'Próxima ação concluída'
          : 'Próxima ação atualizada',
      )
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao atualizar próxima ação',
      )
    },
  })
}

export function useBlocker(organizationId: string) {
  const refresh = useRefreshCustomerSuccess(organizationId)

  return useMutation({
    mutationFn: async ({
      scope,
      mode,
      reason,
    }: {
      scope: BlockerScope
      mode: 'ADD' | 'RESOLVE'
      reason?: string
    }) => {
      const res = await api.api.backoffice['customer-success'].organizations[
        ':id'
      ].block.$post({
        param: { id: organizationId },
        json: {
          scope,
          mode,
          reason: mode === 'ADD' ? reason : undefined,
        },
      })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao atualizar bloqueio'))
      }

      return res.json()
    },
    onSuccess: async (_, variables) => {
      toast.success(
        variables.mode === 'ADD' ? 'Bloqueio registrado' : 'Bloqueio resolvido',
      )
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar bloqueio',
      )
    },
  })
}

export function useTakeOwnership(organizationId: string, userId?: string) {
  const refresh = useRefreshCustomerSuccess(organizationId)

  return useMutation({
    mutationFn: async () => {
      if (!userId) {
        throw new Error('Sessão inválida para assumir a conta')
      }

      const res = await api.api.backoffice['customer-success'].organizations[
        ':id'
      ].profile.$put({
        param: { id: organizationId },
        json: {
          internalOwnerUserId: userId,
        },
      })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao assumir a conta'))
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Conta atribuída ao operador atual')
      await refresh()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao assumir a conta',
      )
    },
  })
}
