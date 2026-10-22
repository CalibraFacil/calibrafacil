// @vitest-environment jsdom

import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()

  return {
    ...actual,
    Link: ({ children, to }: { children?: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  }
})

import { isDesktopOfflineRoute } from './desktop-offline-routes'
import { CloudOnlyOfflineState, SyncStatusProvider } from './sync-status'

function renderState(title: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SyncStatusProvider isDesktop={false}>
        <CloudOnlyOfflineState title={title} />
      </SyncStatusProvider>
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe('CloudOnlyOfflineState (REQ-OFF-4)', () => {
  it('tells the user in pt-BR that the area is online-only and what still works offline', () => {
    renderState('Disponível apenas online')

    expect(screen.getByRole('heading').textContent).toBe(
      'Disponível apenas online',
    )
    // The badge repeats the status next to the title.
    expect(screen.getAllByText('Disponível apenas online')).toHaveLength(2)
    expect(
      screen.getByText(/Esta área precisa da conexão com a nuvem/),
    ).toBeTruthy()

    const offlineAreas = screen
      .getByRole('navigation', { name: 'Disponível offline' })
      .querySelectorAll('a')
    expect(
      [...offlineAreas].map((link) => [
        link.textContent,
        link.getAttribute('href'),
      ]),
    ).toEqual([
      ['Calibrações', '/dashboard/jobs'],
      ['Ordens de serviço', '/dashboard/service-orders'],
      ['Ativos', '/dashboard/assets'],
      ['Clientes', '/dashboard/clients'],
    ])
    // Never point a user at an area that is not available offline either.
    for (const link of offlineAreas) {
      expect(isDesktopOfflineRoute(link.getAttribute('href') ?? '')).toBe(true)
    }
  })

  it('says the local cache has not been downloaded yet when there was no sync', () => {
    renderState('Painel')

    expect(screen.getByText(/O cache local ainda não foi baixado/)).toBeTruthy()
  })
})
