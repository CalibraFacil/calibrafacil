import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authClient, useSession } from '@calibra-facil/auth/client'
import { translateAuthErrorMessage } from '@calibra-facil/auth/error-messages'

import { calibraApi } from '@/utils/api'

// =============================================================================
// TYPES
// =============================================================================

interface User {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
}

interface SessionInfo {
  id: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
  userAgent?: string | null
  ipAddress?: string | null
}

interface SettingsContextValue {
  // User data from session
  user: User | null

  // Session info
  session: SessionInfo | null

  // Loading states
  isLoading: boolean
  isUpdating: boolean

  // Error state
  error: string | null
  clearError: () => void

  // Profile mutations
  updateProfile: (data: { name?: string; image?: string }) => Promise<void>

  // Session management
  sessions: Array<SessionInfo>
  sessionsLoading: boolean
  refreshSessions: () => Promise<void>
  revokeSession: (sessionId: string) => Promise<void>
  revokeOtherSessions: () => Promise<void>
  revokeAllSessions: () => Promise<void>

  // Danger zone
  deleteAccount: (password: string) => Promise<void>
}

// =============================================================================
// CONTEXT
// =============================================================================

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useSettings() {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider')
  }
  return context
}

// =============================================================================
// PROVIDER
// =============================================================================

export function SettingsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { data: sessionData, isPending } = useSession()

  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const sessionsQuery = useQuery({
    queryKey: ['settings', 'sessions'],
    queryFn: async (): Promise<Array<SessionInfo>> => {
      const result = await authClient.listSessions()
      return (result.data ?? []).map((s) => ({
        id: s.id,
        expiresAt: new Date(s.expiresAt),
        createdAt: new Date(s.createdAt),
        updatedAt: new Date(s.updatedAt),
        userAgent: s.userAgent ?? null,
        ipAddress: s.ipAddress ?? null,
      }))
    },
  })

  const refreshSessions = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['settings', 'sessions'] })
    await queryClient.refetchQueries({ queryKey: ['settings', 'sessions'] })
  }, [queryClient])
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data])
  const sessionsLoading = sessionsQuery.isPending || sessionsQuery.isFetching

  const updateProfile = useCallback(
    async (data: { name?: string; image?: string }) => {
      setIsUpdating(true)
      setError(null)
      try {
        const result = await authClient.updateUser(data)
        if (result.error) {
          throw new Error(
            translateAuthErrorMessage(
              result.error.message,
              'Falha ao atualizar perfil',
            ),
          )
        }
        // Session will auto-refresh from useSession
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Falha ao atualizar perfil'
        setError(message)
        throw err
      } finally {
        setIsUpdating(false)
      }
    },
    [],
  )

  const revokeSession = useCallback(
    async (sessionId: string) => {
      setIsUpdating(true)
      setError(null)
      // Remove from local state immediately (optimistic update)
      queryClient.setQueryData<Array<SessionInfo>>(
        ['settings', 'sessions'],
        (prev) => (prev ?? []).filter((s) => s.id !== sessionId),
      )
      try {
        await calibraApi.sessions.revoke(sessionId)
        await refreshSessions()
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Falha ao encerrar sessão'
        setError(message)
        // Refresh sessions to restore correct state
        await refreshSessions()
        throw err
      } finally {
        setIsUpdating(false)
      }
    },
    [queryClient, refreshSessions],
  )

  const revokeOtherSessions = useCallback(async () => {
    setIsUpdating(true)
    setError(null)
    try {
      const result = await authClient.revokeOtherSessions()
      if (result.error) {
        throw new Error(
          translateAuthErrorMessage(
            result.error.message,
            'Falha ao encerrar sessões',
          ),
        )
      }
      // Refresh sessions to show only current session
      await refreshSessions()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao encerrar sessões'
      setError(message)
      throw err
    } finally {
      setIsUpdating(false)
    }
  }, [refreshSessions])

  const revokeAllSessions = useCallback(async () => {
    setIsUpdating(true)
    setError(null)
    try {
      const result = await authClient.revokeSessions()
      if (result.error) {
        throw new Error(
          translateAuthErrorMessage(
            result.error.message,
            'Falha ao sair de todos os dispositivos',
          ),
        )
      }
      // Will redirect to sign-in, so no need to update state
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Falha ao sair de todos os dispositivos'
      setError(message)
      throw err
    } finally {
      setIsUpdating(false)
    }
  }, [])

  const deleteAccount = useCallback(async (password: string) => {
    setIsUpdating(true)
    setError(null)
    try {
      const result = await authClient.deleteUser({ password })
      if (result.error) {
        throw new Error(
          translateAuthErrorMessage(
            result.error.message,
            'Falha ao excluir conta',
          ),
        )
      }
      // Will redirect after deletion
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao excluir conta'
      setError(message)
      throw err
    } finally {
      setIsUpdating(false)
    }
  }, [])

  const value = useMemo<SettingsContextValue>(
    () => ({
      user: sessionData?.user
        ? {
            id: sessionData.user.id,
            name: sessionData.user.name,
            email: sessionData.user.email,
            emailVerified: sessionData.user.emailVerified,
            image: sessionData.user.image ?? null,
          }
        : null,
      session: sessionData?.session
        ? {
            id: sessionData.session.id,
            expiresAt: new Date(sessionData.session.expiresAt),
            createdAt: new Date(sessionData.session.createdAt),
            updatedAt: new Date(sessionData.session.updatedAt),
            userAgent: null,
            ipAddress: null,
          }
        : null,
      isLoading: isPending,
      isUpdating,
      error,
      clearError,
      updateProfile,
      sessions,
      sessionsLoading,
      refreshSessions,
      revokeSession,
      revokeOtherSessions,
      revokeAllSessions,
      deleteAccount,
    }),
    [
      sessionData,
      isPending,
      isUpdating,
      error,
      clearError,
      updateProfile,
      sessions,
      sessionsLoading,
      refreshSessions,
      revokeSession,
      revokeOtherSessions,
      revokeAllSessions,
      deleteAccount,
    ],
  )

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}
