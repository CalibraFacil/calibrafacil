// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CertificateReleaseStatus } from '@calibra-facil/shared'

vi.mock('@/utils/api', () => ({
  calibraApi: {
    finance: {
      getCertificateRelease: vi.fn(async () => null),
      releaseCertificateByException: vi.fn(),
    },
  },
}))

import {
  CERTIFICATE_RELEASE_LABEL,
  CertificateReleaseBadge,
  CertificateReleaseControl,
} from './certificate-release'

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

afterEach(() => cleanup())

describe('CertificateReleaseBadge', () => {
  const statuses: CertificateReleaseStatus[] = [
    'RELEASED',
    'HELD_FOR_BILLING',
    'HELD_FOR_PAYMENT',
    'RELEASED_BY_EXCEPTION',
  ]

  it.each(statuses)('renders the pt-BR label for %s', (status) => {
    renderWithClient(<CertificateReleaseBadge status={status} />)
    expect(screen.getByText(CERTIFICATE_RELEASE_LABEL[status])).toBeTruthy()
  })

  it('does not leak provider, ERP, or policy vocabulary in the DOM', () => {
    for (const status of statuses) {
      const { container } = renderWithClient(
        <CertificateReleaseBadge status={status} />,
      )
      const html = container.innerHTML
      expect(html).not.toMatch(/Conta Azul|ContaAzul|conta_azul|ERP/i)
      expect(html).not.toMatch(/release_after|trusted_customer|manual_only/)
      cleanup()
    }
  })
})

describe('CertificateReleaseControl', () => {
  it('renders nothing for non-approved jobs', () => {
    const { container } = renderWithClient(
      <CertificateReleaseControl
        calibrationJobId={1}
        jobStatus="IN_PROGRESS"
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('isHeldStatus returns true for held statuses only', async () => {
    const mod = await import('./certificate-release')
    expect(mod.isHeldStatus('HELD_FOR_BILLING')).toBe(true)
    expect(mod.isHeldStatus('HELD_FOR_PAYMENT')).toBe(true)
    expect(mod.isHeldStatus('RELEASED')).toBe(false)
    expect(mod.isHeldStatus('RELEASED_BY_EXCEPTION')).toBe(false)
  })
})
