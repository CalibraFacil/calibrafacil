// @vitest-environment jsdom

import React from 'react'
import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  forgetDesktopBridge,
  renderOnDesktop,
} from '@/runtime/desktop-connectivity-test-support'

// The method review workflow (technical review, quality approval, return to
// draft) is online-only since Q13, but the method detail page stays readable
// offline. On a disconnected desktop those buttons must be disabled instead of
// failing with a network error. Only availability is under test: who may press
// them stays with the role gates and the API, so the role gate is passed through.

const methodMock = vi.hoisted((): { current: unknown } => ({ current: null }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('@/runtime/desktop', () => ({ isDesktopRuntime: () => true }))

vi.mock('@/utils/api', () => ({ calibraApi: { methods: {} } }))

vi.mock('@/components/permission-gate', () => ({
  RoleGate: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/features/methods/components/method-spec-preview', () => ({
  MethodSpecCounts: () => null,
  MethodSpecPreview: () => null,
}))

vi.mock('@/features/methods/queries', () => ({
  useMethodDetailData: () => ({
    data: methodMock.current,
    isLoading: false,
    error: null,
  }),
  useMethodAuditLogData: () => ({ data: { data: [] } }),
}))

import { MethodDetailPage } from './detail-page'

function method(status: string) {
  return {
    id: 7,
    name: 'Erro de massa',
    version: 2,
    status,
    createdAt: '2026-01-15T10:00:00.000Z',
    createdByName: 'Ana',
  }
}

const SCENARIOS = [
  {
    action: 'Revisar tecnicamente',
    status: 'PENDING_APPROVAL',
  },
  {
    action: 'Aprovar qualidade',
    status: 'TECHNICAL_REVIEWED',
  },
  {
    action: 'Retornar para rascunho',
    status: 'PENDING_APPROVAL',
  },
] as const

function renderPage(status: string, connectivity: 'online' | 'offline') {
  methodMock.current = method(status)
  return renderOnDesktop(<MethodDetailPage id="7" />, connectivity)
}

describe('method detail page on a disconnected desktop (Q13)', () => {
  beforeEach(forgetDesktopBridge)
  afterEach(() => {
    cleanup()
    forgetDesktopBridge()
  })

  it.each(SCENARIOS)(
    '"$action" is enabled while connected (control)',
    async ({ action, status }) => {
      renderPage(status, 'online')

      expect(
        (await screen.findByRole('button', { name: action })).hasAttribute(
          'disabled',
        ),
      ).toBe(false)
    },
  )

  it.each(SCENARIOS)(
    '"$action" is disabled with no connection',
    async ({ action, status }) => {
      renderPage(status, 'offline')

      expect(
        (await screen.findByRole('button', { name: action })).hasAttribute(
          'disabled',
        ),
      ).toBe(true)
    },
  )

  it('keeps the page itself readable offline', async () => {
    renderPage('PENDING_APPROVAL', 'offline')

    expect(await screen.findByText('Erro de massa')).toBeTruthy()
  })
})
