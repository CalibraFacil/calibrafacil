// @vitest-environment jsdom

import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SyncConflictsPage } from '@/routes/dashboard/sync/conflicts'

const mocks = vi.hoisted(() => ({
  refreshSyncStatus: vi.fn(async () => undefined),
  listConflicts: vi.fn(),
  resolveConflict: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()

  return {
    ...actual,
    createFileRoute: () => (options: unknown) => ({ options }),
    lazyRouteComponent: () => null,
    Link: ({
      children,
      params,
      search,
      to,
    }: {
      children?: React.ReactNode
      params?: unknown
      search?: unknown
      to: string
    }) => (
      <a
        data-params={JSON.stringify(params ?? null)}
        data-search={JSON.stringify(search ?? null)}
        data-to={to}
        href={to}
      >
        {children}
      </a>
    ),
  }
})

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@calibra-facil/ui/badge', () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))

vi.mock('@calibra-facil/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    render: renderProp,
  }: {
    children?: React.ReactNode
    disabled?: boolean
    onClick?: () => void
    render?: React.ReactElement
  }) => {
    if (renderProp) {
      return React.cloneElement(renderProp, {}, children)
    }

    return (
      <button disabled={disabled} type="button" onClick={onClick}>
        {children}
      </button>
    )
  },
}))

vi.mock('@calibra-facil/ui/card', () => ({
  Card: ({ children }: { children?: React.ReactNode }) => (
    <section>{children}</section>
  ),
  CardContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardDescription: ({ children }: { children?: React.ReactNode }) => (
    <p>{children}</p>
  ),
  CardHeader: ({ children }: { children?: React.ReactNode }) => (
    <header>{children}</header>
  ),
  CardTitle: ({ children }: { children?: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}))

vi.mock('@calibra-facil/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}))

vi.mock('@/runtime/sync-status', () => ({
  useSyncStatus: () => ({
    isDesktop: true,
    refresh: mocks.refreshSyncStatus,
  }),
}))

vi.mock('@/utils/api', () => ({
  calibraApi: {
    sync: {
      listConflicts: mocks.listConflicts,
      resolveConflict: mocks.resolveConflict,
    },
  },
}))

describe('SyncConflictsPage', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows entity-aware diffs, edit-first navigation, and clears resolved conflicts', async () => {
    mocks.listConflicts
      .mockResolvedValueOnce({
        data: [
          {
            id: 'conflict:customer:local-1:event-1',
            eventId: 'event-1',
            entityType: 'customer',
            entityId: 'customer:local-1',
            conflictType: 'concurrent_update',
            status: 'open',
            createdAt: '2026-05-10T12:00:00.000Z',
            localPayload: {
              operation: 'update_customer',
              name: 'Laboratório Exemplo',
              email: 'lab@exemplo.test',
            },
            remotePayload: {
              operation: 'update_customer',
              name: 'Laboratório Exemplo Ltda',
              email: 'lab@exemplo.test',
            },
          },
        ],
      })
      .mockResolvedValueOnce({ data: [] })
    mocks.resolveConflict.mockResolvedValue({
      data: {
        id: 'conflict:customer:local-1:event-1',
        status: 'ignored',
        resolvedAt: '2026-05-10T12:05:00.000Z',
      },
    })

    renderConflictsPage()

    expect(await screen.findByText('Cliente · customer:local-1')).toBeTruthy()
    expect(screen.getByText('Campo')).toBeTruthy()
    expect(screen.getByText('Alteração local')).toBeTruthy()
    expect(screen.getByText('Estado na nuvem')).toBeTruthy()
    expect(screen.getByText('Nome')).toBeTruthy()
    expect(screen.getByText('Laboratório Exemplo')).toBeTruthy()
    expect(screen.getByText('Laboratório Exemplo Ltda')).toBeTruthy()
    expect(screen.getByText('Payload bruto · Local')).toBeTruthy()

    const editLink = screen.getByRole('link', {
      name: 'Editar antes de tentar',
    })
    expect(editLink.getAttribute('data-to')).toBe('/dashboard/clients/$id/info')
    expect(editLink.getAttribute('data-params')).toBe(
      JSON.stringify({ id: 'customer:local-1' }),
    )
    expect(editLink.getAttribute('data-search')).toBe(
      JSON.stringify({
        syncConflictId: 'conflict:customer:local-1:event-1',
        returnTo: '/dashboard/sync/conflicts',
      }),
    )

    // REQ-E1-3: giving the local change up is a discard, asked for in pt-BR and recorded.
    fireEvent.click(
      screen.getByRole('button', { name: 'Descartar minha alteração' }),
    )
    expect(screen.getByText('Descartar sua alteração local?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Descartar alteração' }))

    await waitFor(() => {
      expect(mocks.resolveConflict).toHaveBeenCalledWith(
        'conflict:customer:local-1:event-1',
        'discarded_by_user',
        undefined,
      )
    })
    expect(mocks.refreshSyncStatus).toHaveBeenCalled()
    expect(
      await screen.findByText('Nenhum conflito aberto no banco local.'),
    ).toBeTruthy()
  })

  it('REQ-E1-3: discarding calibration readings needs a written reason, which is sent with the discard', async () => {
    mocks.listConflicts
      .mockResolvedValueOnce({
        data: [
          {
            id: 'conflict:calibration_job:job-1:event-9',
            eventId: 'event-9',
            entityType: 'calibration_job',
            entityId: 'job:local-1',
            conflictType: 'stale_version',
            status: 'open',
            regulated: true,
            createdAt: '2026-05-10T12:00:00.000Z',
            localPayload: { status: 'REVIEW' },
            remotePayload: { aggregateVersion: 3 },
          },
        ],
      })
      .mockResolvedValueOnce({ data: [] })
    mocks.resolveConflict.mockResolvedValue({
      data: {
        id: 'conflict:calibration_job:job-1:event-9',
        status: 'discarded_by_user',
      },
    })

    renderConflictsPage()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Descartar minha alteração' }),
    )
    expect(
      screen.getByText('Descartar as leituras desta calibração?'),
    ).toBeTruthy()

    const confirm = screen.getByRole('button', { name: 'Descartar leituras' })
    expect(confirm.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Padrão trocado após a leitura' },
    })
    expect(confirm.hasAttribute('disabled')).toBe(false)
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(mocks.resolveConflict).toHaveBeenCalledWith(
        'conflict:calibration_job:job-1:event-9',
        'discarded_by_user',
        'Padrão trocado após a leitura',
      )
    })
  })
})

function renderConflictsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SyncConflictsPage />
    </QueryClientProvider>,
  )
}
