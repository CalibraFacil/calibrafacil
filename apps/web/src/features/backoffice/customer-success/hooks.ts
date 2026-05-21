import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { calibraApi } from '@/utils/api'
import {
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
      return calibraApi.backoffice.getAccess() as Promise<{ allowed: boolean }>
    },
    retry: false,
  })
}

export function useCustomerSuccessOrganizations(enabled = true) {
  return useQuery({
    queryKey: ['backoffice', 'customer-success', 'organizations'],
    queryFn: async () => {
      return calibraApi.backoffice.customerSuccess.listOrganizations<{
        data: OrganizationQueueItem[]
      }>()
    },
    enabled,
  })
}

export function useSupportQueue(enabled = true) {
  return useQuery({
    queryKey: ['backoffice', 'support', 'queue', 'customer-success'],
    queryFn: async () => {
      return calibraApi.backoffice.getSupportQueue<SupportQueueResponse>()
    },
    enabled,
  })
}

export function useOrganizationProfile(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: ['backoffice', 'customer-success', 'profile', organizationId],
    queryFn: async () => {
      return calibraApi.backoffice.customerSuccess.getProfile<ProfilePayload>(
        organizationId,
      )
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
      return calibraApi.backoffice.customerSuccess.getRequests<RequestsPayload>(
        organizationId,
      )
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
      return calibraApi.backoffice.customerSuccess.updateProfile(
        organizationId,
        { healthStatus },
      )
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
      return calibraApi.backoffice.customerSuccess.updateRequestStatus(
        requestId,
        { status },
      )
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
      return calibraApi.backoffice.customerSuccess.assignRequest(requestId, {
        assignedToUserId,
      })
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

      return calibraApi.backoffice.customerSuccess.respondRequest(requestId, {
        message,
        publicVisible: true,
      })
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
      return calibraApi.backoffice.customerSuccess.escalateRequest(requestId, {
        reason,
      })
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
      return calibraApi.backoffice.customerSuccess.updateProfile(
        organizationId,
        {
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
      )
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
      return calibraApi.backoffice.customerSuccess.updateNextAction(
        organizationId,
        {
          nextAction: markCompleted ? null : nextAction || null,
          nextActionDueAt:
            markCompleted || !nextActionDueAt
              ? null
              : new Date(nextActionDueAt).toISOString(),
          markCompleted,
        },
      )
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
      return calibraApi.backoffice.customerSuccess.updateBlocker(
        organizationId,
        {
          scope,
          mode,
          reason: mode === 'ADD' ? reason : undefined,
        },
      )
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

      return calibraApi.backoffice.customerSuccess.updateProfile(
        organizationId,
        {
          internalOwnerUserId: userId,
        },
      )
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
