// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NotificationCenter } from './notification-center'

const mocks = vi.hoisted(() => ({
  scope: { activeOrganizationId: 'org-a', isContextSwitching: false },
  listRecent: vi.fn(),
  getUnreadCount: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}))
vi.mock('@/utils/api', () => ({ calibraApi: { notifications: mocks } }))
vi.mock('@/contexts/dashboard-context', () => ({
  useDashboardContextState: () => mocks.scope,
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, ...props }: ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props} />
  ),
}))
const notification = {
  id: 1,
  title: 'Certificado disponível',
  message: 'O certificado CAL-2026-0142 está pronto.',
  type: 'CERTIFICATE_READY',
  status: 'UNREAD',
  priority: 'HIGH',
  createdAt: new Date().toISOString(),
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.scope = { activeOrganizationId: 'org-a', isContextSwitching: false }
  mocks.getUnreadCount.mockResolvedValue({ count: 1 })
  mocks.listRecent.mockResolvedValue({
    data: [notification],
    pagination: { page: 1, limit: 15, total: 16, totalPages: 2 },
  })
  mocks.markRead.mockResolvedValue({})
  mocks.markAllRead.mockResolvedValue({})
})
afterEach(cleanup)
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <NotificationCenter />
    </QueryClientProvider>,
  )
  return { ...view, client }
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: /Notificações/ }))
  await screen.findByText(notification.title)
}
it('loads on open, filters on the server and pages through history', async () => {
  setup()
  expect(mocks.listRecent).not.toHaveBeenCalled()
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
  await waitFor(() =>
    expect(mocks.listRecent).toHaveBeenCalledWith({ page: 2, limit: 15 }),
  )
  fireEvent.click(screen.getByRole('tab', { name: /Não lidas/ }))
  await waitFor(() =>
    expect(mocks.listRecent).toHaveBeenCalledWith({
      page: 1,
      limit: 15,
      status: 'UNREAD',
    }),
  )
})
it('marks a notification read and refreshes the organization inbox', async () => {
  const { client } = setup()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  await open()
  fireEvent.click(
    screen.getByRole('button', { name: /Certificado disponível/ }),
  )
  await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith([1]))
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['notifications', 'org-a'],
    }),
  )
})
it('recovers from a load failure without showing an empty inbox', async () => {
  mocks.listRecent.mockRejectedValueOnce(new Error('offline'))
  setup()
  fireEvent.click(screen.getByRole('button', { name: /Notificações/ }))
  fireEvent.click(
    await screen.findByRole('button', { name: 'Tentar novamente' }),
  )
  await screen.findByText(notification.title)
})
it('closes and disables the inbox while changing organizations', async () => {
  const { rerender, client } = setup()
  await open()
  mocks.scope = { activeOrganizationId: 'org-b', isContextSwitching: true }
  rerender(
    <QueryClientProvider client={client}>
      <NotificationCenter />
    </QueryClientProvider>,
  )
  expect(screen.queryByText(notification.title)).toBeNull()
  expect(
    screen
      .getByRole('button', { name: 'Notificações' })
      .hasAttribute('disabled'),
  ).toBe(true)
})
it('marks all read and presents the unread empty state', async () => {
  setup()
  await open()
  mocks.listRecent.mockResolvedValue({
    data: [],
    pagination: { page: 1, limit: 15, total: 0, totalPages: 0 },
  })
  mocks.getUnreadCount.mockResolvedValue({ count: 0 })
  fireEvent.click(
    screen.getByRole('button', { name: 'Marcar todas como lidas' }),
  )
  await waitFor(() => expect(mocks.markAllRead).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('tab', { name: /Não lidas/ }))
  await screen.findByText('Tudo em dia')
})
