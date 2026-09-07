// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setActive: vi.fn(),
  standards: {
    data: [{ id: 12, name: 'Padrão', serialNumber: '123' }],
    isLoading: false,
    isFetching: false,
    isError: false,
  },
}))
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/dashboard/jobs/example' }),
  useNavigate: () => mocks.navigate,
}))
vi.mock('@calibra-facil/auth/client', () => ({
  signOut: vi.fn(),
  organization: { setActive: mocks.setActive },
  useActiveOrganization: () => ({ data: { id: 'one' } }),
  useListOrganizations: () => ({
    data: [
      { id: 'one', name: 'Laboratório atual', slug: 'one', type: 'LAB' },
      { id: 'two', name: 'Outro laboratório', slug: 'two', type: 'LAB' },
      { id: 'client', name: 'Cliente privado', slug: 'client', type: 'CLIENT' },
    ],
    isPending: false,
  }),
}))
vi.mock('@/features/command-palette/global-search', () => ({
  SEARCH_DEBOUNCE_MS: 0,
  SEARCH_MIN_LENGTH: 2,
  getSearchModeFromPage: (page: string) =>
    page.startsWith('search-') ? page.slice(7) : null,
  useCommandSearchAssetsData: () => ({ data: [] }),
  useCommandSearchClientsData: () => ({ data: [] }),
  useCommandSearchJobsData: () => ({ data: [] }),
  useCommandSearchStandardsData: () => mocks.standards,
}))
import { CommandPaletteProvider } from './command-context'
import { CommandPalette } from './command-palette'
import { getStoredDashboardOrganizationId } from '@/features/dashboard/dashboard-scope-storage'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.setActive.mockResolvedValue({ data: {} })
  mocks.standards.isError = false
  mocks.standards.isFetching = false
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function openPalette() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['previous-tenant'], 'private data')
  render(
    <QueryClientProvider client={client}>
      <CommandPaletteProvider>
        <CommandPalette />
      </CommandPaletteProvider>
    </QueryClientProvider>,
  )
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  return client
}

it('removes action shortcuts and placeholder context actions', async () => {
  openPalette()
  await screen.findByRole('dialog', { name: 'Paleta de Comandos' })
  expect(document.querySelector('kbd')).toBeNull()
  expect(screen.queryByText('Aprovar Ordem de Serviço')).toBeNull()
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  fireEvent.keyDown(document, { key: 'g' })
  fireEvent.keyDown(document, { key: 'c' })
  expect(mocks.navigate).not.toHaveBeenCalled()
})

it('switches organization, persists selection and clears previous tenant data', async () => {
  const client = openPalette()
  fireEvent.click(await screen.findByText('Trocar Organização'))
  expect(screen.queryByText('Cliente privado')).toBeNull()
  fireEvent.click(await screen.findByText('Outro laboratório'))
  await waitFor(() =>
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/dashboard' }),
  )
  expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: 'two' })
  expect(getStoredDashboardOrganizationId()).toBe('two')
  expect(client.getQueryData(['previous-tenant'])).toBeUndefined()
})

it('keeps the picker open and preserves scope when switching fails', async () => {
  mocks.setActive.mockResolvedValue({ error: { message: 'Sem permissão' } })
  const client = openPalette()
  fireEvent.click(await screen.findByText('Trocar Organização'))
  fireEvent.click(await screen.findByText('Outro laboratório'))
  await screen.findByText('Sem permissão')
  expect(mocks.navigate).not.toHaveBeenCalled()
  expect(getStoredDashboardOrganizationId()).toBeNull()
  expect(client.getQueryData(['previous-tenant'])).toBe('private data')
  expect(screen.getByRole('dialog')).toBeTruthy()
})

it('opens the selected standard and provides an initial search hint', async () => {
  openPalette()
  fireEvent.click(await screen.findByText('Buscar Padrão...'))
  expect(
    screen.getByText('Digite pelo menos 2 caracteres para buscar.'),
  ).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pa' } })
  fireEvent.click(await screen.findByText('Padrão'))
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/dashboard/standards/$id',
    params: { id: 'padrao-12' },
  })
})

it('reports search failures instead of claiming there are no results', async () => {
  mocks.standards.isError = true
  openPalette()
  fireEvent.click(await screen.findByText('Buscar Padrão...'))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pa' } })
  await screen.findByText('Não foi possível buscar. Tente novamente.')
  expect(screen.queryByText('Padrão')).toBeNull()
})

it('returns with Back and closes with Escape from a nested page', async () => {
  openPalette()
  fireEvent.click(await screen.findByText('Buscar Padrão...'))
  fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
  fireEvent.click(await screen.findByText('Buscar Cliente...'))
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
