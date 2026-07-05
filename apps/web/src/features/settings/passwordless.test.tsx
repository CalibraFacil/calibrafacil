// @vitest-environment jsdom

// SEC-09 (#669): the lab settings UI must not surface any password affordance
// (change-password form, "password login is active" status). These render the
// real page components and assert the affordances are ABSENT from the output.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuthenticationSettingsPage } from './authentication-page'
import { SecuritySettingsPage } from './security-page'

const settingsMocks = vi.hoisted(() => ({
  useSettings: vi.fn(),
  useActiveOrganization: vi.fn(),
}))

vi.mock('@/contexts/settings-context', () => ({
  useSettings: settingsMocks.useSettings,
}))

vi.mock('@calibra-facil/auth/client', () => ({
  useActiveOrganization: settingsMocks.useActiveOrganization,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SEC-09 lab settings — no password affordances', () => {
  it('REQ-PWDLESS-004: authentication settings does not present a password sign-in method', () => {
    settingsMocks.useSettings.mockReturnValue({
      user: { email: 'tecnico@lab.test', emailVerified: true },
      isLoading: false,
    })
    // A CLIENT org keeps the render narrow (no SSO/API cards); the "Senha"
    // access-method row is org-type-independent, so this still proves removal.
    settingsMocks.useActiveOrganization.mockReturnValue({
      data: { id: 'org-1', type: 'CLIENT' },
      isPending: false,
    })

    render(<AuthenticationSettingsPage />)

    expect(screen.queryByText('Faça login com email e senha')).toBeNull()
    expect(screen.queryByText('Senha')).toBeNull()
    // The email verification method row must still be present.
    expect(screen.getByText('Verificação de Email')).toBeTruthy()
  })

  it('REQ-PWDLESS-004: security settings does not offer a change-password form', () => {
    settingsMocks.useSettings.mockReturnValue({
      session: { id: 'sess-1' },
      sessions: [],
      sessionsLoading: false,
      revokeSession: vi.fn(),
      revokeOtherSessions: vi.fn(),
      isUpdating: false,
    })

    render(<SecuritySettingsPage />)

    expect(screen.queryByText('Alterar Senha')).toBeNull()
    expect(screen.queryByLabelText('Senha atual')).toBeNull()
    expect(screen.queryByLabelText('Nova senha')).toBeNull()
    // The active-sessions management must still be present.
    expect(screen.getByText('Sessões Ativas')).toBeTruthy()
  })
})
