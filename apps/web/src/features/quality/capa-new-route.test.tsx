// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()

const apiMocks = vi.hoisted(() => ({
  createCapa: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  lazyRouteComponent: () => undefined,
  useNavigate: () => navigate,
}))

vi.mock('@/utils/api', () => ({
  calibraApi: {
    capas: {
      create: apiMocks.createCapa,
    },
  },
}))

vi.mock('@/features/quality/queries', () => ({
  useCapaResponsibleMembersData: () => ({
    data: {
      data: [{ id: 'user-1', name: 'Ana Técnica', role: 'TECHNICIAN' }],
    },
  }),
}))

vi.mock('@/runtime/sync-status', () => ({
  CloudOnlyOfflineState: ({ title }: { title: string }) => <div>{title}</div>,
  useDesktopCloudOnlyUnavailable: () => false,
}))

vi.mock('sonner', () => ({
  toast: toastMocks,
}))

vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: ({
    onChange,
    placeholder,
  }: {
    onChange?: (date: Date | undefined) => void
    placeholder?: string
  }) => (
    <button
      type="button"
      onClick={() => onChange?.(new Date('2026-06-20T00:00:00.000Z'))}
    >
      {placeholder}
    </button>
  ),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string
    onValueChange?: (value: string) => void
    children: ReactNode
  }) => (
    <select
      value={value ?? ''}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: (_props: { children: ReactNode }) => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

import { NewCAPAPage } from '@/features/quality/capa-new-page'

describe('new CAPA route workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.createCapa.mockResolvedValue({ id: 77, capaNumber: 'CAPA-77' })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('submits a schema-validated CAPA payload and navigates to the detail page', async () => {
    renderRoute()

    fireEvent.change(
      screen.getByPlaceholderText('Título resumido da ação corretiva'),
      {
        target: { value: 'Ajustar procedimento' },
      },
    )
    fireEvent.change(
      screen.getByPlaceholderText(
        'Descreva detalhadamente o problema encontrado, incluindo evidências e impacto...',
      ),
      {
        target: {
          value: 'Procedimento atual permite execução ambígua em campo',
        },
      },
    )
    fireEvent.change(
      screen.getByPlaceholderText(
        'Descreva as ações a serem tomadas para corrigir o problema e prevenir recorrência...',
      ),
      {
        target: {
          value: 'Revisar procedimento e treinar equipe técnica',
        },
      },
    )
    fireEvent.change(screen.getAllByRole('combobox')[3]!, {
      target: { value: 'user-1' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Selecione a data alvo' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Criar CAPA' }))

    await waitFor(() => expect(apiMocks.createCapa).toHaveBeenCalled())
    expect(apiMocks.createCapa).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ajustar procedimento',
        description: 'Procedimento atual permite execução ambígua em campo',
        source: 'nc_detection',
        type: 'corrective',
        severity: 'minor',
        category: 'procedure',
        actionPlan: 'Revisar procedimento e treinar equipe técnica',
        responsibleId: 'user-1',
      }),
    )
    expect(toastMocks.success).toHaveBeenCalledWith(
      'CAPA-77 criada com sucesso',
    )
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/capa/$id',
      params: { id: '77' },
    })
  })

  it('surfaces schema validation errors before calling the API', async () => {
    renderRoute()

    fireEvent.change(
      screen.getByPlaceholderText('Título resumido da ação corretiva'),
      {
        target: { value: 'Ajustar procedimento' },
      },
    )
    fireEvent.change(
      screen.getByPlaceholderText(
        'Descreva detalhadamente o problema encontrado, incluindo evidências e impacto...',
      ),
      {
        target: {
          value: 'Procedimento atual permite execução ambígua em campo',
        },
      },
    )
    fireEvent.change(
      screen.getByPlaceholderText(
        'Descreva as ações a serem tomadas para corrigir o problema e prevenir recorrência...',
      ),
      {
        target: {
          value: 'Revisar procedimento e treinar equipe técnica',
        },
      },
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Selecione a data alvo' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Criar CAPA' }))

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        'Responsável é obrigatório',
      ),
    )
    expect(apiMocks.createCapa).not.toHaveBeenCalled()
  })
})

function renderRoute() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <NewCAPAPage />
    </QueryClientProvider>,
  )
}
