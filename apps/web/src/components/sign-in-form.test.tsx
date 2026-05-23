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
  signInMagicLink: vi.fn(),
  signInPasskey: vi.fn(),
  sendVerificationOtp: vi.fn(),
  signInEmailOtp: vi.fn(),
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
    magicLink: authMocks.signInMagicLink,
  },
  labAuthClient: {
    signIn: {
      passkey: authMocks.signInPasskey,
      emailOtp: authMocks.signInEmailOtp,
    },
    emailOtp: {
      sendVerificationOtp: authMocks.sendVerificationOtp,
    },
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
    Reflect.deleteProperty(window, 'calibraBridge')
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
    installResizeObserver()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    Reflect.deleteProperty(globalThis, 'ResizeObserver')
    Reflect.deleteProperty(window, 'calibraBridge')
  })

  it('signs lab users in with passkey, clears desktop signed-out state, starts sync, and navigates to the redirect', async () => {
    const startSync = vi.fn(async () => undefined)
    installBridge({ startSync })
    authMocks.signInPasskey.mockResolvedValue({ error: null })

    render(<SignInForm redirect="/dashboard/jobs" />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'tecnico@lab.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com passkey' }))

    await waitFor(() => {
      expect(authMocks.signInPasskey).toHaveBeenCalledTimes(1)
    })
    expect(authMocks.clearDesktopSignedOut).toHaveBeenCalledTimes(1)
    expect(startSync).toHaveBeenCalledTimes(1)
    expect(authMocks.navigate).toHaveBeenCalledWith({
      to: '/dashboard/jobs',
    })
  })

  it('shows lab sign-in errors without clearing desktop signed-out state or navigating', async () => {
    authMocks.signInPasskey.mockResolvedValue({
      error: { message: 'AUTHENTICATION_FAILED' },
    })

    render(<SignInForm redirect="/dashboard/jobs" />)

    fireEvent.click(screen.getByRole('button', { name: 'Entrar com passkey' }))

    expect(
      await screen.findByText('Não foi possível autenticar com a passkey.'),
    ).toBeTruthy()
    expect(authMocks.clearDesktopSignedOut).not.toHaveBeenCalled()
    expect(authMocks.navigate).not.toHaveBeenCalled()
  })

  it('keeps lab sign-in passwordless and hides password recovery', () => {
    render(<SignInForm />)

    expect(screen.queryByLabelText('Senha')).toBeNull()
    expect(screen.queryByText('Esqueceu sua senha?')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Entrar com passkey' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Link mágico' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Código por email' }),
    ).toBeTruthy()
  })

  it('requests restricted lab magic links with neutral UI copy', async () => {
    authMocks.signInMagicLink.mockResolvedValue({ error: null })

    render(<SignInForm redirect="/dashboard/jobs" />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'tecnico@lab.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Link mágico' }))

    await waitFor(() => {
      expect(authMocks.signInMagicLink).toHaveBeenCalledWith({
        email: 'tecnico@lab.test',
        callbackURL: `${window.location.origin}/dashboard/jobs`,
        errorCallbackURL: `${window.location.origin}/sign-in`,
      })
    })
    expect(
      await screen.findByText(
        'Se o email tiver acesso LAB, enviaremos o link em instantes.',
      ),
    ).toBeTruthy()
  })

  it('requests and completes lab email OTP sign-in', async () => {
    authMocks.sendVerificationOtp.mockResolvedValue({ error: null })
    authMocks.signInEmailOtp.mockResolvedValue({ error: null })

    render(<SignInForm redirect="/dashboard/jobs" />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'tecnico@lab.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Código por email' }))

    await waitFor(() => {
      expect(authMocks.sendVerificationOtp).toHaveBeenCalledWith({
        email: 'tecnico@lab.test',
        type: 'sign-in',
      })
    })

    fireEvent.change(await screen.findByLabelText('Código recebido'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com código' }))

    await waitFor(() => {
      expect(authMocks.signInEmailOtp).toHaveBeenCalledWith({
        email: 'tecnico@lab.test',
        otp: '123456',
      })
    })
    expect(authMocks.navigate).toHaveBeenCalledWith({
      to: '/dashboard/jobs',
    })
  })

  it('translates invalid credential errors from the auth provider', async () => {
    authMocks.backofficeSignInEmail.mockResolvedValue({
      error: { message: 'Invalid email or password' },
    })

    render(<SignInForm mode="backoffice" redirect="/backoffice" />)

    fillCredentials('tecnico@lab.test', 'senha-incorreta')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(
      await screen.findByText(
        'Email ou senha inválidos. Verifique os dados e tente novamente.',
      ),
    ).toBeTruthy()
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

function installResizeObserver() {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: ResizeObserverStub,
  })
}
