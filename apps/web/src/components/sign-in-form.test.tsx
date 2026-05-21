// @vitest-environment jsdom

import type React from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it('shows lab sign-in errors without clearing desktop signed-out state or navigating', async () => {
    authMocks.signInEmail.mockResolvedValue({
      error: { message: 'Credenciais inválidas' },
    })

    render(<SignInForm redirect="/dashboard/jobs" />)

    fillCredentials('tecnico@lab.test', 'senha-incorreta')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText('Credenciais inválidas')).toBeTruthy()
    expect(authMocks.clearDesktopSignedOut).not.toHaveBeenCalled()
    expect(authMocks.navigate).not.toHaveBeenCalled()
  })

  it('routes allowed backoffice users to the requested backoffice redirect', async () => {
    authMocks.backofficeSignInEmail.mockResolvedValue({ error: null })
    authMocks.getBackofficeAccess.mockResolvedValue({
      allowed: true,
      bootstrapAvailable: false,
    })

    render(<SignInForm mode="backoffice" redirect="/backoffice/support" />)

    fillCredentials('operador@calibrafacil.test', 'senha-segura')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    await waitFor(() => {
      expect(authMocks.navigate).toHaveBeenCalledWith({
        to: '/backoffice/support',
      })
    })
    expect(authMocks.backofficeSignOut).not.toHaveBeenCalled()
  })

  it('routes backoffice users to bootstrap when internal access can be created', async () => {
    authMocks.backofficeSignInEmail.mockResolvedValue({ error: null })
    authMocks.getBackofficeAccess.mockResolvedValue({
      allowed: false,
      bootstrapAvailable: true,
    })

    render(<SignInForm mode="backoffice" />)

    fillCredentials('primeiro@calibrafacil.test', 'senha-segura')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    await waitFor(() => {
      expect(authMocks.navigate).toHaveBeenCalledWith({
        to: '/backoffice/bootstrap',
      })
    })
    expect(authMocks.backofficeSignOut).not.toHaveBeenCalled()
  })

  it('signs out backoffice users who do not have backoffice access', async () => {
    authMocks.backofficeSignInEmail.mockResolvedValue({ error: null })
    authMocks.getBackofficeAccess.mockResolvedValue({
      allowed: false,
      bootstrapAvailable: false,
    })

    render(<SignInForm mode="backoffice" />)

    fillCredentials('operador@calibrafacil.test', 'senha-segura')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(
      await screen.findByText('Sua conta não possui acesso ao backoffice'),
    ).toBeTruthy()
    expect(authMocks.backofficeSignOut).toHaveBeenCalledTimes(1)
    expect(authMocks.navigate).not.toHaveBeenCalled()
  })

  it('starts SSO with organization, optional email hint, and route redirect', async () => {
    authMocks.ssoStart.mockResolvedValue({})

    render(<SignInForm redirect="/dashboard/jobs" />)

    expect(
      screen.getByRole('button', { name: 'Entrar com SSO' }),
    ).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Slug da organização'), {
      target: { value: 'lab-acreditado' },
    })
    fireEvent.change(screen.getByLabelText('Email corporativo'), {
      target: { value: 'tecnico@lab.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com SSO' }))

    await waitFor(() => {
      expect(authMocks.ssoStart).toHaveBeenCalledWith({
        organizationSlug: 'lab-acreditado',
        email: 'tecnico@lab.test',
        redirectPath: '/dashboard/jobs',
      })
    })
    expect(
      await screen.findByText('Falha ao iniciar login via SSO'),
    ).toBeTruthy()
  })
})

function fillCredentials(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: email },
  })
  fireEvent.change(screen.getByLabelText('Senha'), {
    target: { value: password },
  })
}

function installBridge(bridge: { startSync: () => Promise<unknown> }) {
  Object.defineProperty(window, 'calibraBridge', {
    configurable: true,
    value: bridge,
  })
}
