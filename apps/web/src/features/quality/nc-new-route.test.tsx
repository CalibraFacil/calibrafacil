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
  createNonConformance: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => navigate,
}))

vi.mock('@/utils/api', () => ({
  calibraApi: {
    nonConformances: {
      create: apiMocks.createNonConformance,
    },
  },
}))

vi.mock('@/features/quality/queries', () => ({
  useNonConformanceJobsData: () => ({
    data: {
      data: [{ id: 42, jobId: 'CAL-42', status: 'APPROVED' }],
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
    <div>
      <button
        type="button"
        onClick={() => onChange?.(new Date('2026-05-20T00:00:00.000Z'))}
      >
        {placeholder}
      </button>
      <button type="button" onClick={() => onChange?.(undefined)}>
        Limpar data
      </button>
    </div>
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

import { NewNCPage } from '@/features/quality/nc-new-page'

describe('new NC route workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.createNonConformance.mockResolvedValue({
      id: 12,
      ncNumber: 'NC-12',
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('submits a schema-validated NC payload and navigates to the detail page', async () => {
    renderRoute()

    fireEvent.click(screen.getByRole('radio', { name: /Equipamento/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Selecione a data' }))
    fireEvent.change(screen.getByLabelText('Hora'), {
      target: { value: '14:35' },
    })
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '42' },
    })
    fireEvent.change(
      screen.getByPlaceholderText(
        'Descreva detalhadamente a não conformidade detectada, incluindo: o que foi observado, onde, como foi detectado e potencial impacto...',
      ),
      {
        target: {
          value: 'Equipamento apresentou resultado fora da tolerância',
        },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Registrar NC' }))

    await waitFor(() =>
      expect(apiMocks.createNonConformance).toHaveBeenCalled(),
    )
    expect(apiMocks.createNonConformance).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'equipment',
        description: 'Equipamento apresentou resultado fora da tolerância',
        jobId: 42,
      }),
    )
    expect(
      apiMocks.createNonConformance.mock.calls[0]?.[0].detectedAt,
    ).toContain('2026-05-20T')
    expect(toastMocks.success).toHaveBeenCalledWith(
      'NC NC-12 registrada com sucesso',
    )
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/nc/$id',
      params: { id: '12' },
    })
  })

  it('surfaces schema validation errors before calling the API', async () => {
    renderRoute()

    fireEvent.click(screen.getByRole('button', { name: 'Limpar data' }))
    fireEvent.change(
      screen.getByPlaceholderText(
        'Descreva detalhadamente a não conformidade detectada, incluindo: o que foi observado, onde, como foi detectado e potencial impacto...',
      ),
      {
        target: {
          value: 'Equipamento apresentou resultado fora da tolerância',
        },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Registrar NC' }))

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        'Data de detecção é obrigatória',
      ),
    )
    expect(apiMocks.createNonConformance).not.toHaveBeenCalled()
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
      <NewNCPage />
    </QueryClientProvider>,
  )
}
