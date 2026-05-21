// @vitest-environment jsdom

import type React from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SignInForm, startDesktopInitialSync } from './sign-in-form'

const authMocks = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  backofficeSignInEmail: vi.fn(),
  backofficeSignOut: vi.fn(),
  clearDesktopSignedOut: vi.fn(),
  getBackofficeAccess: vi.fn(),
  navigate: vi.fn(),
  ssoStart: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => authMocks.navigate,
}))

vi.mock('@calibra-facil/auth/client', () => ({
  signIn: {
    email: authMocks.signInEmail,
  },
  backofficeSignIn: {
    email: authMocks.backofficeSignInEmail,
  },
  backofficeSignOut: authMocks.backofficeSignOut,
}))

vi.mock('@/features/backoffice/queries', () => ({
  getBackofficeAccess: authMocks.getBackofficeAccess,
}))

vi.mock('@/runtime/desktop-auth', () => ({
  clearDesktopSignedOut: authMocks.clearDesktopSignedOut,
}))

vi.mock('@/utils/api', () => ({
  calibraApi: {
    sso: {
      start: authMocks.ssoStart,
    },
  },
}))

describe('startDesktopInitialSync', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.restoreAllMocks()
    delete (window as typeof window & { calibraBridge?: unknown }).calibraBridge
  })

  it('starts desktop sync through the bridge after lab sign-in', () => {
    const startSync = vi.fn(async () => undefined)
    installBridge({ startSync })

    startDesktopInitialSync()

    expect(startSync).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the desktop bridge is unavailable', () => {
    expect(() => startDesktopInitialSync()).not.toThrow()
  })

  it('does not surface sync startup failures to the sign-in flow', async () => {
    const startSync = vi.fn(async () => {
      throw new Error('sync failed')
    })
    installBridge({ startSync })

    startDesktopInitialSync()
    await Promise.resolve()

    expect(startSync).toHaveBeenCalledTimes(1)
  })
})

describe('SignInForm workflow', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    delete (window as typeof window & { calibraBridge?: unknown }).calibraBridge
  })

  it('signs lab users in, clears desktop signed-out state, starts sync, and navigates to the redirect', async () => {
    const startSync = vi.fn(async () => undefined)
    installBridge({ startSync })
    authMocks.signInEmail.mockResolvedValue({ error: null })

    render(<SignInForm redirect="/dashboard/jobs" />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'tecnico@lab.test' },
    })
    fireEvent.change(screen.getByLabelText('Senha'), {
      target: { value: 'senha-segura' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    await waitFor(() => {
      expect(authMocks.signInEmail).toHaveBeenCalledWith({
        email: 'tecnico@lab.test',
        password: 'senha-segura',
      })
    })
    expect(authMocks.clearDesktopSignedOut).toHaveBeenCalledTimes(1)
    expect(startSync).toHaveBeenCalledTimes(1)
    expect(authMocks.navigate).toHaveBeenCalledWith({
      to: '/dashboard/jobs',
    })
  })

  it('signs out backoffice users who do not have backoffice access', async () => {
    authMocks.backofficeSignInEmail.mockResolvedValue({ error: null })
    authMocks.getBackofficeAccess.mockResolvedValue({
      allowed: false,
      bootstrapAvailable: false,
    })

    render(<SignInForm mode="backoffice" />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'operador@calibrafacil.test' },
    })
    fireEvent.change(screen.getByLabelText('Senha'), {
      target: { value: 'senha-segura' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(
      await screen.findByText('Sua conta não possui acesso ao backoffice'),
    ).toBeTruthy()
    expect(authMocks.backofficeSignOut).toHaveBeenCalledTimes(1)
    expect(authMocks.navigate).not.toHaveBeenCalled()
  })
})

function installBridge(bridge: { startSync: () => Promise<unknown> }) {
  Object.defineProperty(window, 'calibraBridge', {
    configurable: true,
    value: bridge,
  })
}
