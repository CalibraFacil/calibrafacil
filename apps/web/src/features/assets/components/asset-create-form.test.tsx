// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Smoke + behaviour coverage for the single-page asset form: the sections it
// renders, the live readiness line, the type-driven specifications section and
// the submit-time validation. Network hooks, the Base UI Select/Combobox
// shells and the date picker are stubbed with native controls (the repo's
// established pattern — see metrology-regime-fields.test.tsx).

type AssetTypeFixture = {
  id: number
  name: string
  slug: string
  definition: Array<{
    key: string
    label: string
    type: 'text' | 'number' | 'select' | 'weighing_ranges'
    required?: boolean
    unit?: string
  }>
}

const ASSET_TYPES: AssetTypeFixture[] = [
  { id: 1, name: 'Cronômetro', slug: 'cronometro', definition: [] },
  {
    id: 2,
    name: 'Manômetro',
    slug: 'manometro',
    definition: [
      { key: 'range', label: 'Faixa', type: 'text', required: true },
      { key: 'class', label: 'Classe', type: 'text' },
    ],
  },
]

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/utils/api', () => ({
  calibraApi: { assets: { create: mocks.create } },
  getApiBaseURL: () => '',
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}))

vi.mock('@/features/assets/queries', () => ({
  useAssetTypesData: () => ({ data: { data: ASSET_TYPES }, isLoading: false }),
  useNewAssetCustomersData: () => ({
    data: {
      data: [
        { id: 10, name: 'Tecnologia Ambiental Modelo', taxId: '00.000.000/0001-00' },
      ],
    },
    isLoading: false,
  }),
  useLegalMetrologyRegulationsData: () => ({ data: [] }),
}))

type NativeSelectProps = {
  value?: string
  onValueChange?: (value: string) => void
  children: ReactNode
}

function nativeSelectShell() {
  return {
    Root: ({ value, onValueChange, children }: NativeSelectProps) => (
      <select
        value={value ?? ''}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        <option value="">—</option>
        {children}
      </select>
    ),
    Item: ({ value, children }: { value: string; children: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
    Passthrough: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
}

vi.mock('@/components/ui/select', () => {
  const shell = nativeSelectShell()
  return {
    Select: shell.Root,
    SelectTrigger: () => null,
    SelectContent: shell.Passthrough,
    SelectItem: shell.Item,
  }
})

vi.mock('@/components/ui/combobox', () => {
  const shell = nativeSelectShell()
  return {
    Combobox: shell.Root,
    ComboboxInput: ({ id, value }: { id: string; value?: string }) => (
      <input id={id} value={value ?? ''} readOnly />
    ),
    ComboboxContent: shell.Passthrough,
    ComboboxList: shell.Passthrough,
    ComboboxEmpty: () => null,
    ComboboxItem: shell.Item,
  }
})

vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: ({ id }: { id: string }) => <input id={id} type="date" />,
}))

import { AssetCreateForm } from './asset-create-form'

function selectContaining(optionName: string | RegExp): HTMLSelectElement {
  const option = screen.getByRole('option', { name: optionName })
  const select = option.closest('select')
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`no <select> owns option "${optionName}"`)
  }
  return select
}

function renderForm(
  props: Partial<Parameters<typeof AssetCreateForm>[0]> = {},
) {
  const client = new QueryClient()
  const onSaved = vi.fn()
  const onCancel = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <AssetCreateForm onSaved={onSaved} onCancel={onCancel} {...props} />
    </QueryClientProvider>,
  )
  return { onSaved, onCancel }
}

beforeAll(() => {
  // jsdom has no layout engine; the failed-submit focus helper scrolls first.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AssetCreateForm', () => {
  it('renders one form with every section and a live readiness line', () => {
    renderForm()

    for (const title of [
      'Instrumento',
      'Identificação',
      'Regime metrológico',
      'Mais detalhes',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    }
    // No wizard: nothing counts steps and the specs section waits for a type.
    expect(screen.queryByText(/Passo \d+ de \d+/)).toBeNull()
    expect(screen.queryByText('Especificações técnicas')).toBeNull()
    expect(
      screen.getByText('Faltam 5 campos obrigatórios').parentElement
        ?.textContent,
    ).toContain('Tipo de instrumento, Cliente, Nome +2')
    expect(screen.getByRole('button', { name: /Criar ativo/ })).toBeTruthy()
  })

  it('reveals the type-specific specifications once a type is chosen', () => {
    renderForm()

    fireEvent.change(selectContaining('Manômetro'), { target: { value: '2' } })

    expect(
      screen.getByRole('heading', { name: 'Especificações técnicas' }),
    ).toBeTruthy()
    expect(screen.getByLabelText('Faixa *')).toBeTruthy()
    expect(screen.getByLabelText('Classe')).toBeTruthy()
    expect(screen.getByPlaceholderText('Ex.: Manômetro…')).toBeTruthy()
    expect(
      screen.getByText('Faltam 5 campos obrigatórios').parentElement
        ?.textContent,
    ).toContain('Cliente, Nome, Tag +2')

    // A type without specifications hides the section again.
    fireEvent.change(selectContaining('Cronômetro'), { target: { value: '1' } })
    expect(screen.queryByText('Especificações técnicas')).toBeNull()
  })

  it('reports readiness and submits the parsed payload', async () => {
    mocks.create.mockResolvedValue({ id: 99, name: 'Manômetro 0–10 bar' })
    renderForm()

    fireEvent.change(selectContaining('Manômetro'), { target: { value: '2' } })
    fireEvent.change(selectContaining(/Ambiental Modelo/), {
      target: { value: '10' },
    })
    fireEvent.change(screen.getByLabelText('Nome do ativo *'), {
      target: { value: 'Manômetro 0–10 bar' },
    })
    fireEvent.change(screen.getByLabelText('Tag / ID interno *'), {
      target: { value: 'MAN-001' },
    })
    fireEvent.change(screen.getByLabelText('Número de série *'), {
      target: { value: 'SN-77' },
    })
    fireEvent.change(screen.getByLabelText('Faixa *'), {
      target: { value: '0 a 10 bar' },
    })

    expect(screen.getByText('Pronto para criar')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Criar ativo/ }))

    expect(mocks.toastError).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({
      customerId: 10,
      assetTypeId: 2,
      name: 'Manômetro 0–10 bar',
      tag: 'MAN-001',
      serialNumber: 'SN-77',
      metrologyRegime: 'INDUSTRIAL',
      specifications: { range: '0 a 10 bar' },
    })
  })

  it('blocks an incomplete submit with inline errors instead of a step jump', () => {
    renderForm()

    fireEvent.click(screen.getByRole('button', { name: /Criar ativo/ }))

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('Cliente é obrigatório')
    expect(screen.getByText('Cliente é obrigatório')).toBeTruthy()
    expect(screen.getByText('Tipo de instrumento é obrigatório')).toBeTruthy()
    expect(screen.getByText('Nome é obrigatório')).toBeTruthy()
    expect(screen.getByText('Tag é obrigatória')).toBeTruthy()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('shows the locked customer as a chip when opened from a service order', () => {
    renderForm({
      lockCustomer: true,
      defaultCustomerId: 10,
      lockedCustomerName: 'Tecnologia Ambiental Modelo',
      variant: 'sheet',
    })

    expect(screen.getByText('Tecnologia Ambiental Modelo')).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Ambiental Modelo/ })).toBeNull()
    expect(
      screen.getByText('Faltam 4 campos obrigatórios').parentElement
        ?.textContent,
    ).toContain('Tipo de instrumento, Nome, Tag +1')
  })
})
