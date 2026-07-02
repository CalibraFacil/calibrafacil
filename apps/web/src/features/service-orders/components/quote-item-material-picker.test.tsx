// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MaterialsListData } from '@calibra-facil/client-runtime'

const queryMocks = vi.hoisted(() => ({
  useServiceOrderMaterialsData: vi.fn(),
}))

vi.mock('../queries', () => queryMocks)

import { QuoteItemMaterialPicker } from './quote-item-material-picker'

const MATERIAL: MaterialsListData['data'][number] = {
  id: 42,
  name: 'Correia dentada',
  description: null,
  sku: 'CB-100',
  unit: 'pç',
  unitCostCents: 800,
  unitPriceCents: 1990,
  controlsStock: true,
  stockQuantity: null,
  stockSyncedAt: null,
  isActive: true,
  createdAt: null,
  updatedAt: null,
}

function mockMaterials(data: MaterialsListData['data'], isLoading = false) {
  queryMocks.useServiceOrderMaterialsData.mockReturnValue({
    data: { data },
    isLoading,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // base-ui Combobox popup relies on browser APIs jsdom lacks.
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
})

describe('QuoteItemMaterialPicker', () => {
  it('REQ-SOPICK-001: offers a material typeahead alongside free-text', () => {
    mockMaterials([MATERIAL])

    render(
      <QuoteItemMaterialPicker
        materialId={null}
        onSelectMaterial={vi.fn()}
        onClearMaterial={vi.fn()}
      />,
    )

    expect(screen.getByPlaceholderText('Buscar material...')).toBeInstanceOf(
      HTMLInputElement,
    )
  })

  it('REQ-SOPICK-002: selecting a material emits the chosen catalog row', () => {
    const onSelectMaterial = vi.fn()
    mockMaterials([MATERIAL])

    render(
      <QuoteItemMaterialPicker
        materialId={null}
        onSelectMaterial={onSelectMaterial}
        onClearMaterial={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText('Buscar material...')
    fireEvent.change(input, { target: { value: 'correia' } })
    // Open the base-ui popup so the catalog options render.
    fireEvent.click(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    fireEvent.click(screen.getByText('Correia dentada'))

    expect(onSelectMaterial).toHaveBeenCalledWith(MATERIAL)
  })

  it('REQ-SOPICK-003: typing after a selection drops back to free-text', () => {
    const onClearMaterial = vi.fn()
    mockMaterials([MATERIAL])

    render(
      <QuoteItemMaterialPicker
        materialId={42}
        onSelectMaterial={vi.fn()}
        onClearMaterial={onClearMaterial}
      />,
    )

    const input = screen.getByPlaceholderText('Buscar material...')
    fireEvent.change(input, { target: { value: 'nova peça' } })

    expect(onClearMaterial).toHaveBeenCalled()
  })

  it('REQ-SOPICK-005: an empty catalog (desktop/offline) keeps the input usable with no error', () => {
    mockMaterials([])

    render(
      <QuoteItemMaterialPicker
        materialId={null}
        onSelectMaterial={vi.fn()}
        onClearMaterial={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText('Buscar material...')
    expect(input).toBeInstanceOf(HTMLInputElement)
    // Free-text typing still works and surfaces no error in the row.
    expect(() =>
      fireEvent.change(input, { target: { value: 'peça avulsa' } }),
    ).not.toThrow()
  })
})
