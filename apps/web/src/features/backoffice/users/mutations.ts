import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { calibraApi, resolveCloudApiUrl } from '@/utils/api'
import type { AssignablePlatformRole } from '@/features/backoffice/types'
import type { NewPlatformUserDraft } from './model'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function useUserMutations() {
  const queryClient = useQueryClient()
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['backoffice', 'users'] })

  const setRole = useMutation({
    mutationFn: (input: { userId: string; role: AssignablePlatformRole }) =>
      calibraApi.backoffice.updateUserRole(input.userId, input.role),
    onSuccess: async () => {
      toast.success('Papel de plataforma atualizado')
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, 'Falha ao atualizar papel')),
  })

  const ban = useMutation({
    mutationFn: (userId: string) => calibraApi.backoffice.banUser(userId),
    onSuccess: async () => {
      toast.success('Usuário banido')
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, 'Falha ao banir usuário')),
  })

  const unban = useMutation({
    mutationFn: (userId: string) => calibraApi.backoffice.unbanUser(userId),
    onSuccess: async () => {
      toast.success('Usuário reabilitado')
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, 'Falha ao reabilitar usuário')),
  })

  const impersonate = useMutation({
    mutationFn: (input: { userId: string; reason: string }) =>
      calibraApi.backoffice.impersonateUser<{ redirectPath: string }>(
        input.userId,
        input.reason,
      ),
    onSuccess: (data) => {
      window.location.assign(resolveCloudApiUrl(data.redirectPath))
    },
    onError: (error) =>
      toast.error(errorMessage(error, 'Falha ao iniciar impersonação')),
  })

  const createUser = useMutation({
    mutationFn: (draft: NewPlatformUserDraft) =>
      calibraApi.backoffice.createUser<{
        passwordSetupRequested: boolean
        passwordSetupMessage: string
      }>(draft),
    onSuccess: async (data) => {
      toast.success(
        data.passwordSetupRequested
          ? 'Usuário interno criado e email de definição de senha enviado'
          : data.passwordSetupMessage,
      )
      await invalidate()
    },
    onError: (error) =>
      toast.error(errorMessage(error, 'Falha ao criar usuário')),
  })

  const requestPasswordSetup = useMutation({
    mutationFn: (userId: string) =>
      calibraApi.backoffice.requestUserPasswordReset(userId),
    onSuccess: () => toast.success('Email de definição de senha solicitado'),
    onError: (error) =>
      toast.error(errorMessage(error, 'Falha ao solicitar definição de senha')),
  })

  return { setRole, ban, unban, impersonate, createUser, requestPasswordSetup }
}

export type UserMutations = ReturnType<typeof useUserMutations>
