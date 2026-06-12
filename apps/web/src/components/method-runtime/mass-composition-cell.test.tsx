// @vitest-environment jsdom

import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'

import { MassCompositionCell } from './mass-composition-cell'
import {
  buildMassCompositionValue,
  isMassCompositionValue,
  type MassCompositionConfig,
  type MassCompositionOption,
  type MassCompositionValue,
} from './mass-composition-utils'

function option(
  overrides: Partial<MassCompositionOption> = {},
): MassCompositionOption {
  const merged = {
    standardId: 1,
    standardName: 'JP01',
    certificateNumber: 'CERT-001',
    certifiedValueIndex: 0,
    nominal: '1 kg',
    value: 1,
    uncertainty: 0.001,
    unit: 'kg',
    coverageFactor: 2,
    ...overrides,
  }
  return { optionLabel: merged.nominal, ...merged }
}

const TWO_KG = option({ certifiedValueIndex: 0, nominal: '2 kg', value: 2 })
const ONE_KG = option({ certifiedValueIndex: 1, nominal: '1 kg', value: 1 })
const DEFAULT_OPTIONS = [TWO_KG, ONE_KG]

interface HarnessProps {
  options?: MassCompositionOption[]
  config?: MassCompositionConfig
  target?: { value: number; unit: 'mg' | 'g' | 'kg' } | null
  previousComposition?: MassCompositionValue | null
  initialValue?: MassCompositionValue | null
  onChange?: (value: MassCompositionValue | null) => void
}

function Harness({
  options = DEFAULT_OPTIONS,
  config,
  target = null,
  previousComposition = null,
  initialValue = null,
  onChange,
}: HarnessProps) {
  const [value, setValue] = useState<MassCompositionValue | null>(initialValue)
  return (
    <MassCompositionCell
      value={value}
      options={options}
      config={config}
      target={target}
      previousComposition={previousComposition}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

afterEach(() => {
  cleanup()
})

function openDialog() {
  // Before opening, the trigger is the only button rendered.
  fireEvent.click(screen.getAllByRole('button')[0])
}

function getTile(nominal: string): HTMLElement {
  const tile = screen
    .getAllByRole('button')
    .find(
      (node) =>
        node.textContent?.includes(nominal) &&
        node.className.includes('flex-col'),
    )
  if (!tile) throw new Error(`Tile not found: ${nominal}`)
  return tile
}

describe('MassCompositionCell', () => {
  it('adds a weight on tile click and increments on a second click', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    openDialog()

    fireEvent.click(getTile('2 kg'))
    let last = onChange.mock.calls.at(-1)?.[0]
    expect(isMassCompositionValue(last)).toBe(true)
    expect(last.items).toHaveLength(1)
    expect(last.items[0].quantity).toBe(1)

    fireEvent.click(getTile('2 kg'))
    last = onChange.mock.calls.at(-1)?.[0]
    expect(last.items[0].quantity).toBe(2)
  })

  it('filters tiles and adds the highlighted match on Enter', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    openDialog()

    const searchInput = screen.getByPlaceholderText(/buscar peso/i)
    fireEvent.change(searchInput, { target: { value: '2 kg' } })
    fireEvent.keyDown(searchInput, { key: 'Enter' })

    const last = onChange.mock.calls.at(-1)?.[0]
    expect(last.items).toHaveLength(1)
    expect(last.items[0].value).toBe(2)
    if (!(searchInput instanceof HTMLInputElement)) {
      throw new Error('search is not an input')
    }
    expect(searchInput.value).toBe('')
  })

  it('applies a quantity prefix from the search on Enter', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    openDialog()

    const searchInput = screen.getByPlaceholderText(/buscar peso/i)
    fireEvent.change(searchInput, { target: { value: '3x 1 kg' } })
    fireEvent.keyDown(searchInput, { key: 'Enter' })

    const last = onChange.mock.calls.at(-1)?.[0]
    expect(last.items[0].value).toBe(1)
    expect(last.items[0].quantity).toBe(3)
  })

  it('suggests a composition from the target', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} target={{ value: 2, unit: 'kg' }} />)
    openDialog()

    fireEvent.click(screen.getByRole('button', { name: /sugerir composição/i }))
    const last = onChange.mock.calls.at(-1)?.[0]
    expect(last.items).toHaveLength(1)
    expect(last.items[0].value).toBe(2)
  })

  it('disables suggestion without a target and shows the manual target input', () => {
    render(<Harness />)
    openDialog()

    expect(
      screen
        .getByRole('button', { name: /sugerir composição/i })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getByText(/alvo \(opcional\)/i)).toBeTruthy()
  })

  it('copies the previous row composition', () => {
    const previous = buildMassCompositionValue(
      [
        {
          standardId: 1,
          standardName: 'JP01',
          certificateNumber: 'CERT-001',
          certifiedValueIndex: 0,
          nominal: '2 kg',
          quantity: 2,
          value: 2,
          uncertainty: 0.001,
          unit: 'kg',
          coverageFactor: 2,
        },
      ],
      'kg',
    )
    const onChange = vi.fn()
    render(<Harness previousComposition={previous} onChange={onChange} />)
    openDialog()

    fireEvent.click(
      screen.getByRole('button', { name: /repetir linha anterior/i }),
    )
    const last = onChange.mock.calls.at(-1)?.[0]
    expect(last.items[0].quantity).toBe(2)
    expect(last.items[0].value).toBe(2)
  })

  it('hides the repeat button without a previous composition', () => {
    render(<Harness />)
    openDialog()
    expect(
      screen.queryByRole('button', { name: /repetir linha anterior/i }),
    ).toBeNull()
  })

  it('removes an item when the quantity drops below one', () => {
    const initial = buildMassCompositionValue(
      [
        {
          standardId: 1,
          standardName: 'JP01',
          certificateNumber: 'CERT-001',
          certifiedValueIndex: 0,
          nominal: '2 kg',
          quantity: 1,
          value: 2,
          uncertainty: 0.001,
          unit: 'kg',
          coverageFactor: 2,
        },
      ],
      'kg',
    )
    const onChange = vi.fn()
    render(<Harness initialValue={initial} onChange={onChange} />)
    openDialog()

    fireEvent.click(
      screen.getByRole('button', { name: /diminuir quantidade/i }),
    )
    expect(onChange.mock.calls.at(-1)?.[0]).toBeNull()
  })

  it('clears the composition from the footer', () => {
    const initial = buildMassCompositionValue(
      [
        {
          standardId: 1,
          standardName: 'JP01',
          certificateNumber: 'CERT-001',
          certifiedValueIndex: 0,
          nominal: '2 kg',
          quantity: 1,
          value: 2,
          uncertainty: 0.001,
          unit: 'kg',
          coverageFactor: 2,
        },
      ],
      'kg',
    )
    const onChange = vi.fn()
    render(<Harness initialValue={initial} onChange={onChange} />)
    openDialog()

    fireEvent.click(screen.getByRole('button', { name: /limpar composição/i }))
    expect(onChange.mock.calls.at(-1)?.[0]).toBeNull()
  })

  it('shows only composition profiles when configured', () => {
    const profile = option({
      certifiedValueIndex: 0,
      nominal: '2 kg',
      value: 2,
      compositionProfile: true,
      profileKey: '2 kg',
      profileClass: 'F1',
    })
    render(
      <Harness
        options={[profile, ONE_KG]}
        config={{ optionSource: 'composition_profiles' }}
      />,
    )
    openDialog()

    const grid = screen
      .getByPlaceholderText(/buscar perfil/i)
      .closest('div')?.parentElement
    expect(grid).not.toBeNull()
    expect(within(grid!).getAllByText(/perfil/i).length).toBeGreaterThan(0)
    expect(getTile('2 kg')).toBeTruthy()
  })

  it('keeps the trigger disabled when disabled', () => {
    render(
      <MassCompositionCell
        value={null}
        options={[TWO_KG]}
        onChange={() => {}}
        disabled
      />,
    )
    expect(
      screen
        .getByRole('button', { name: /compor pesos/i })
        .hasAttribute('disabled'),
    ).toBe(true)
  })
})
