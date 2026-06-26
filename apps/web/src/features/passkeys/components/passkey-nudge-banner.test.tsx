// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface BannerTestState {
  webAuthnSupported: boolean
  session: { data: { user: { id: string | undefined } } }
  query: { isSuccess: boolean; data: Array<{ id: string }> | undefined }
  addMutateAsync: ReturnType<typeof vi.fn>
  addPending: boolean
  toastSuccess: ReturnType<typeof vi.fn>
  toastError: ReturnType<typeof vi.fn>
}

const state = vi.hoisted<BannerTestState>(() => ({
  webAuthnSupported: true,
  session: { data: { user: { id: 'user-1' } } },
  query: { isSuccess: true, data: [] },
  addMutateAsync: vi.fn(),
  addPending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../webauthn', () => ({
  isWebAuthnSupported: () => state.webAuthnSupported,
}))
vi.mock('@calibra-facil/auth/client', () => ({
  useSession: () => state.session,
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => state.query,
}))
vi.mock('../queries', () => ({
  passkeysQueryOptions: () => ({ queryKey: ['lab-passkeys'] }),
  useAddPasskey: () => ({
    mutateAsync: state.addMutateAsync,
    isPending: state.addPending,
  }),
}))
vi.mock('sonner', () => ({
  toast: { success: state.toastSuccess, error: state.toastError },
}))

import { PasskeyNudgeBanner } from './passkey-nudge-banner'

const DISMISS_KEY = 'cf:passkey-nudge-dismissed:user-1'

function resetState() {
  state.webAuthnSupported = true
  state.session = { data: { user: { id: 'user-1' } } }
  state.query = { isSuccess: true, data: [] }
  state.addPending = false
}

beforeEach(() => {
  resetState()
  window.sessionStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

// The card renders through a portal to <body>, so visibility is asserted via
// document-wide screen queries (queryByText) rather than the render container.
describe('PasskeyNudgeBanner visibility', () => {
  it('shows when WebAuthn is supported, a user is signed in, and there are no passkeys', () => {
    render(<PasskeyNudgeBanner />)
    expect(screen.getByText('Criar passkey')).toBeTruthy()
    expect(screen.getByText('Entre mais rápido com uma passkey')).toBeTruthy()
  })

  it('renders nothing when WebAuthn is unsupported', () => {
    state.webAuthnSupported = false
    render(<PasskeyNudgeBanner />)
    expect(screen.queryByText('Criar passkey')).toBeNull()
  })

  it('renders nothing when the session has no user yet', () => {
    state.session = { data: { user: { id: undefined } } }
    render(<PasskeyNudgeBanner />)
    expect(screen.queryByText('Criar passkey')).toBeNull()
  })

  it('renders nothing while the passkeys query is still loading', () => {
    state.query = { isSuccess: false, data: undefined }
    render(<PasskeyNudgeBanner />)
    expect(screen.queryByText('Criar passkey')).toBeNull()
  })

  it('renders nothing when the user already has a passkey', () => {
    state.query = { isSuccess: true, data: [{ id: 'pk-1' }] }
    render(<PasskeyNudgeBanner />)
    expect(screen.queryByText('Criar passkey')).toBeNull()
  })

  it('renders nothing when previously dismissed this session', () => {
    window.sessionStorage.setItem(DISMISS_KEY, '1')
    render(<PasskeyNudgeBanner />)
    expect(screen.queryByText('Criar passkey')).toBeNull()
  })
})

describe('PasskeyNudgeBanner actions', () => {
  it('creates a passkey when the primary action is clicked', async () => {
    state.addMutateAsync.mockResolvedValue(null)
    render(<PasskeyNudgeBanner />)

    fireEvent.click(screen.getByText('Criar passkey'))

    await waitFor(() => {
      expect(state.addMutateAsync).toHaveBeenCalledTimes(1)
    })
    expect(state.toastSuccess).toHaveBeenCalled()
  })

  it('dismisses for the session and hides when the close button is clicked', () => {
    render(<PasskeyNudgeBanner />)

    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))

    expect(window.sessionStorage.getItem(DISMISS_KEY)).toBe('1')
    expect(screen.queryByText('Criar passkey')).toBeNull()
  })
})
