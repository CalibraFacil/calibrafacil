import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { labPasskey } from '@calibra-facil/auth/client'

import { type UserPasskey } from './types'

export const PASSKEYS_QUERY_KEY = ['lab-passkeys']

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return null
}

export async function fetchUserPasskeys(): Promise<UserPasskey[]> {
  const result = await labPasskey.listUserPasskeys()

  if (result.error) {
    throw new Error(
      result.error.message ?? 'Não foi possível carregar suas passkeys.',
    )
  }

  return (result.data ?? []).map((passkey) => ({
    id: passkey.id,
    name: passkey.name ?? null,
    deviceType: passkey.deviceType ?? null,
    backedUp: Boolean(passkey.backedUp),
    createdAt: toIsoString(passkey.createdAt),
    aaguid: passkey.aaguid ?? null,
  }))
}

export function passkeysQueryOptions() {
  return queryOptions({
    queryKey: PASSKEYS_QUERY_KEY,
    queryFn: fetchUserPasskeys,
  })
}

export function useUserPasskeys() {
  return useQuery(passkeysQueryOptions())
}

// Register a new passkey against the current session. No authenticatorAttachment
// or context token — a logged-in addPasskey resolves to the session user, so the
// OS offers every provider (Apple, Google, 1Password, Bitwarden, security keys).
export function useAddPasskey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (name: string) => {
      const result = await labPasskey.addPasskey({ name })
      if (result?.error) {
        throw new Error(
          result.error.message ?? 'Não foi possível criar a passkey.',
        )
      }
      return result?.data ?? null
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY }),
  })
}

export function useRenamePasskey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; name: string }) => {
      const result = await labPasskey.updatePasskey({
        id: input.id,
        name: input.name,
      })
      if (result.error) {
        throw new Error(
          result.error.message ?? 'Não foi possível renomear a passkey.',
        )
      }
      return result.data
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY }),
  })
}

export function useDeletePasskey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await labPasskey.deletePasskey({ id })
      if (result.error) {
        throw new Error(
          result.error.message ?? 'Não foi possível remover a passkey.',
        )
      }
      return result.data
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY }),
  })
}
