// @vitest-environment jsdom

import type React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaimAccountPage } from './claim-account-page'

const claimMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getSetup: vi.fn(),
  completeSetup: vi.fn(),
  requestMagicLink: vi.fn(),
  requestOtp: vi.fn(),
  addPasskey: vi.fn(),
  signInPasskey: vi.fn(),
  signInEmailOtp: vi.fn(),
  useSession: vi.fn(),
  startDesktopInitialSync: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => claimMocks.navigate,
}))

vi.mock('@calibra-facil/auth/client', () => ({
  useSession: claimMocks.useSession,
  labAuthClient: {
    passkey: {
      addPasskey: claimMocks.addPasskey,
    },
    signIn: {
      passkey: claimMocks.signInPasskey,
      emailOtp: claimMocks.signInEmailOtp,
    },
  },
}))

vi.mock('@/components/sign-in-form', () => ({
  startDesktopInitialSync: claimMocks.startDesktopInitialSync,
}))

vi.mock('@/utils/api', () => ({
  calibraApi: {
    labSetup: {
      get: claimMocks.getSetup,
      complete: claimMocks.completeSetup,
      requestMagicLink: claimMocks.requestMagicLink,
      requestOtp: claimMocks.requestOtp,
    },
  },
}))

const readySetup = {
  status: 'ready',
  email: 'owner@lab.test',
  organizationName: 'Lab Acreditado',
  organizationSlug: 'lab-acreditado',
  expiresAt: '2030-01-01T00:00:00.000Z',
  passkeyPreferred: true,
  fallbackMethods: ['magic_link', 'email_otp'],
}

describe('ClaimAccountPage', () => {
  beforeEach(() => {
    // Fake timers (advancing with the real clock so async queries still resolve)
    // so input-otp's password-manager-badge setTimeout can be flushed on
    // teardown instead of firing after jsdom is gone (ReferenceError: window).
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
    installResizeObserver()
    claimMocks.getSetup.mockResolvedValue(readySetup)
    claimMocks.completeSetup.mockResolvedValue({
      claimed: true,
      organizationId: 'org-1',
      needsOnboarding: false,
    })
    claimMocks.addPasskey.mockResolvedValue({ error: null })
    claimMocks.signInPasskey.mockResolvedValue({ error: null })
    claimMocks.signInEmailOtp.mockResolvedValue({ error: null })
    claimMocks.requestMagicLink.mockResolvedValue({})
    claimMocks.requestOtp.mockResolvedValue({})
    claimMocks.useSession.mockReturnValue({ data: null, isPending: false })
  })

  afterEach(() => {
    cleanup()
    // Flush input-otp's pending timer while jsdom is still alive, then restore.
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
    Reflect.deleteProperty(globalThis, 'ResizeObserver')
    Reflect.deleteProperty(window, 'PublicKeyCredential')
  })

  it('registers a passkey with the setup token and completes the claim', async () => {
    installWebAuthnSupport()
    renderClaimPage('setup-token')

    fireEvent.click(
      await screen.findByRole('button', { name: 'Criar passkey e acessar' }),
    )

    await waitFor(() => {
      expect(claimMocks.addPasskey).toHaveBeenCalledWith({
        name: 'CalibraFácil',
        context: 'setup-token',
      })
    })
    expect(claimMocks.signInPasskey).toHaveBeenCalledTimes(1)
    expect(claimMocks.completeSetup).toHaveBeenCalledWith('setup-token')
    expect(claimMocks.startDesktopInitialSync).toHaveBeenCalledTimes(1)
    expect(claimMocks.navigate).toHaveBeenCalledWith({ to: '/dashboard' })
  })

  it('shows setup-token status messages for expired links', async () => {
    claimMocks.getSetup.mockResolvedValue({
      status: 'expired',
      passkeyPreferred: true,
      fallbackMethods: ['magic_link', 'email_otp'],
    })

    renderClaimPage('expired-token')

    expect(
      await screen.findByText(
        'Este link de acesso expirou. Solicite um novo link ao responsável pelo convite.',
      ),
    ).toBeTruthy()
    expect(claimMocks.addPasskey).not.toHaveBeenCalled()
  })

  it('shows a clear message when the setup token belongs to another email', async () => {
    claimMocks.getSetup.mockResolvedValue({
      status: 'email_mismatch',
      passkeyPreferred: true,
      fallbackMethods: ['magic_link', 'email_otp'],
    })

    renderClaimPage('mismatch-token')

    expect(
      await screen.findByText(
        'Este link pertence a outro email. Solicite um novo link para a conta correta.',
      ),
    ).toBeTruthy()
  })

  it('requests and completes email OTP fallback claims', async () => {
    claimMocks.completeSetup.mockResolvedValue({
      claimed: true,
      organizationId: 'org-1',
      needsOnboarding: true,
    })

    renderClaimPage('setup-token')

    fireEvent.click(
      await screen.findByRole('button', { name: 'Receber código' }),
    )

    await waitFor(() => {
      expect(claimMocks.requestOtp).toHaveBeenCalledWith('setup-token')
    })

    // The sixth digit submits on its own; no button click needed.
    fireEvent.change(await screen.findByLabelText('Código recebido'), {
      target: { value: '123456' },
    })

    await waitFor(() => {
      expect(claimMocks.signInEmailOtp).toHaveBeenCalledWith({
        email: 'owner@lab.test',
        otp: '123456',
      })
    })
    await waitFor(() => {
      expect(claimMocks.completeSetup).toHaveBeenCalledWith('setup-token')
    })
    expect(claimMocks.navigate).toHaveBeenCalledWith({
      to: '/onboarding/organization',
      search: {},
    })
  })

  it('completes the claim when a magic-link redirect returns with a session', async () => {
    claimMocks.useSession.mockReturnValue({
      data: {
        user: {
          id: 'user-1',
          email: 'owner@lab.test',
        },
        session: {
          id: 'session-1',
        },
      },
      isPending: false,
    })

    renderClaimPage('setup-token')

    expect(await screen.findByText('Concluindo acesso...')).toBeTruthy()

    await waitFor(() => {
      expect(claimMocks.completeSetup).toHaveBeenCalledWith('setup-token')
    })
    expect(claimMocks.startDesktopInitialSync).toHaveBeenCalledTimes(1)
    expect(claimMocks.navigate).toHaveBeenCalledWith({ to: '/dashboard' })
  })
})

function renderClaimPage(token: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ClaimAccountPage token={token} />
    </QueryClientProvider>,
  )
}

function installWebAuthnSupport() {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: true,
  })
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    value: PublicKeyCredentialStub,
  })
}

function PublicKeyCredentialStub() {}

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
