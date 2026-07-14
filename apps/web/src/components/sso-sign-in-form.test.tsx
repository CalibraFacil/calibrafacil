// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SsoSignInForm } from './sso-sign-in-form'

const ssoMocks = vi.hoisted(() => ({
  ssoStart: vi.fn(),
  clearDesktopSignedOut: vi.fn(),
  locationAssign: vi.fn(),
}))

vi.mock('@/utils/api', () => ({
  calibraApi: {
    sso: {
      start: ssoMocks.ssoStart,
    },
  },
}))

vi.mock('@/runtime/desktop-auth', () => ({
  clearDesktopSignedOut: ssoMocks.clearDesktopSignedOut,
}))

describe('SsoSignInForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: ssoMocks.locationAssign },
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('starts SSO with organization, optional email hint, and route redirect', async () => {
    ssoMocks.ssoStart.mockResolvedValue({})

    render(<SsoSignInForm redirect="/dashboard/jobs" />)

    expect(
      screen.getByRole('button', { name: 'Entrar com SSO' }),
    ).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Slug da organização'), {
      target: { value: 'lab-acreditado' },
    })
    fireEvent.change(screen.getByLabelText(/Email corporativo/), {
      target: { value: 'tecnico@lab.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com SSO' }))

    await waitFor(() => {
      expect(ssoMocks.ssoStart).toHaveBeenCalledWith({
        organizationSlug: 'lab-acreditado',
        email: 'tecnico@lab.test',
        redirectPath: '/dashboard/jobs',
      })
    })
    expect(
      await screen.findByText('Falha ao iniciar login via SSO'),
    ).toBeTruthy()
    expect(ssoMocks.locationAssign).not.toHaveBeenCalled()
  })

  it('redirects to the identity provider and clears desktop signed-out state on success', async () => {
    ssoMocks.ssoStart.mockResolvedValue({ url: 'https://idp.test/auth' })

    render(<SsoSignInForm />)

    fireEvent.change(screen.getByLabelText('Slug da organização'), {
      target: { value: 'lab-acreditado' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com SSO' }))

    await waitFor(() => {
      expect(ssoMocks.locationAssign).toHaveBeenCalledWith(
        'https://idp.test/auth',
      )
    })
    expect(ssoMocks.clearDesktopSignedOut).toHaveBeenCalledTimes(1)
  })

  it('offers a way back to the credentials scene', () => {
    const onBack = vi.fn()

    render(<SsoSignInForm onBack={onBack} />)

    fireEvent.click(
      screen.getByRole('button', { name: /Voltar para passkey ou email/ }),
    )

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
