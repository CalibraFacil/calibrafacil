import * as React from 'react'
import { authClient, useSession } from '@calibra-facil/auth/client'

import { api } from '@/utils/api'

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
  token: string
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

  // Password mutations
  changePassword: (data: {
    currentPassword: string
    newPassword: string
    revokeOtherSessions?: boolean
  }) => Promise<void>

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

const SettingsContext = React.createContext<SettingsContextValue | null>(null)

export function useSettings() {
  const context = React.useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider')
  }
  return context
}

// =============================================================================
// PROVIDER
// =============================================================================

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { data: sessionData, isPending } = useSession()

  const [isUpdating, setIsUpdating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [sessions, setSessions] = React.useState<Array<SessionInfo>>([])
  const [sessionsLoading, setSessionsLoading] = React.useState(false)

  // Fetch sessions on mount
  React.useEffect(() => {
    refreshSessions()
  }, [])

  const clearError = React.useCallback(() => {
    setError(null)
  }, [])

  const refreshSessions = React.useCallback(async () => {
    setSessionsLoading(true)
    try {
      const result = await authClient.listSessions()
      if (result.data) {
        setSessions(
          result.data.map((s) => ({
            id: s.id,
            token: s.token,
            expiresAt: new Date(s.expiresAt),
            createdAt: new Date(s.createdAt),
            updatedAt: new Date(s.updatedAt),
            userAgent: s.userAgent ?? null,
            ipAddress: s.ipAddress ?? null,
          })),
        )
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err)
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  const updateProfile = React.useCallback(
    async (data: { name?: string; image?: string }) => {
      setIsUpdating(true)
      setError(null)
      try {
        const result = await authClient.updateUser(data)
        if (result.error) {
          throw new Error(result.error.message ?? 'Falha ao atualizar perfil')
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

  const changePassword = React.useCallback(
    async (data: {
      currentPassword: string
      newPassword: string
      revokeOtherSessions?: boolean
    }) => {
      setIsUpdating(true)
      setError(null)
      try {
        const result = await authClient.changePassword({
          currentPassword: data.currentPassword,
          newPassword: data.newPassword,
          revokeOtherSessions: data.revokeOtherSessions,
        })
        if (result.error) {
          throw new Error(result.error.message ?? 'Falha ao alterar senha')
        }
        // Refresh sessions if other sessions were revoked
        if (data.revokeOtherSessions) {
          await refreshSessions()
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Falha ao alterar senha'
        setError(message)
        throw err
      } finally {
        setIsUpdating(false)
      }
    },
    [refreshSessions],
  )

  const revokeSession = React.useCallback(
    async (sessionId: string) => {
      setIsUpdating(true)
      setError(null)
      // Remove from local state immediately (optimistic update)
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      try {
        const res = await api.api.sessions.revoke.$post({
          json: { sessionId },
        })
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          const message =
            data &&
            typeof data === 'object' &&
            'error' in data &&
            typeof data.error === 'string'
              ? data.error
              : 'Falha ao encerrar sessão'
          throw new Error(message)
        }
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
    [refreshSessions],
  )

  const revokeOtherSessions = React.useCallback(async () => {
    setIsUpdating(true)
    setError(null)
    try {
      const result = await authClient.revokeOtherSessions()
      if (result.error) {
        throw new Error(result.error.message ?? 'Falha ao encerrar sessões')
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

  const revokeAllSessions = React.useCallback(async () => {
    setIsUpdating(true)
    setError(null)
    try {
      const result = await authClient.revokeSessions()
      if (result.error) {
        throw new Error(
          result.error.message ?? 'Falha ao sair de todos os dispositivos',
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

  const deleteAccount = React.useCallback(async (password: string) => {
    setIsUpdating(true)
    setError(null)
    try {
      const result = await authClient.deleteUser({ password })
      if (result.error) {
        throw new Error(result.error.message ?? 'Falha ao excluir conta')
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

  const value = React.useMemo<SettingsContextValue>(
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
            token: sessionData.session.token,
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
      changePassword,
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
      changePassword,
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
