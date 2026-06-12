// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import {
  MeasurementNumberCell,
  type MeasurementPickerOption,
} from './measurement-number-cell'

afterEach(() => {
  cleanup()
})

function getInput(): HTMLInputElement {
  const input = screen.getAllByRole('textbox')[0]
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('expected an input')
  }
  return input
}

describe('MeasurementNumberCell', () => {
  it('displays the canonical grams value converted to the display unit', () => {
    render(
      <MeasurementNumberCell
        value={500000}
        onCommit={() => {}}
        columnUnit="g"
        displayUnit="kg"
      />,
    )
    expect(getInput().value).toBe('500')
  })

  it('commits entry in the display unit back to canonical grams', () => {
    const onCommit = vi.fn()
    render(
      <MeasurementNumberCell
        value={null}
        onCommit={onCommit}
        columnUnit="g"
        displayUnit="kg"
      />,
    )
    const input = getInput()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '500.5' } })
    expect(onCommit).toHaveBeenLastCalledWith(500500)
  })

  it('does not convert when display unit equals the column unit', () => {
    const onCommit = vi.fn()
    render(
      <MeasurementNumberCell
        value={null}
        onCommit={onCommit}
        columnUnit="g"
        displayUnit="g"
      />,
    )
    const input = getInput()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '250' } })
    expect(onCommit).toHaveBeenLastCalledWith(250)
  })

  it('blocks more decimal places than the resolution allows', () => {
    const onCommit = vi.fn()
    render(
      <MeasurementNumberCell
        value={null}
        onCommit={onCommit}
        columnUnit="g"
        displayUnit="kg"
        maxDecimals={1}
      />,
    )
    const input = getInput()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '500.5' } })
    expect(input.value).toBe('500.5')
    // Extra decimals are rejected: the draft does not advance.
    fireEvent.change(input, { target: { value: '500.55' } })
    expect(input.value).toBe('500.5')
    expect(onCommit).toHaveBeenLastCalledWith(500500)
  })

  it('accepts a comma as the decimal separator', () => {
    const onCommit = vi.fn()
    render(
      <MeasurementNumberCell
        value={null}
        onCommit={onCommit}
        columnUnit="g"
        displayUnit="kg"
      />,
    )
    const input = getInput()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '1,5' } })
    expect(onCommit).toHaveBeenLastCalledWith(1500)
  })

  it('strips floating-point noise from converted commits', () => {
    const onCommit = vi.fn()
    render(
      <MeasurementNumberCell
        value={null}
        onCommit={onCommit}
        columnUnit="g"
        displayUnit="mg"
      />,
    )
    const input = getInput()
    fireEvent.focus(input)
    // 1.3 mg -> 0.0013 g would otherwise store 0.0013000000000000002.
    fireEvent.change(input, { target: { value: '1.3' } })
    expect(onCommit).toHaveBeenLastCalledWith(0.0013)
  })

  it('commits null when cleared', () => {
    const onCommit = vi.fn()
    render(
      <MeasurementNumberCell
        value={1000}
        onCommit={onCommit}
        columnUnit="g"
        displayUnit="kg"
      />,
    )
    const input = getInput()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    expect(onCommit).toHaveBeenLastCalledWith(null)
  })

  it('converts a picked certified value to canonical grams', () => {
    const onCommit = vi.fn()
    const options: MeasurementPickerOption[] = [
      {
        label: '500 kg',
        value: 500,
        uncertainty: 0.01,
        unit: 'kg',
        standardName: 'JP01',
      },
    ]
    render(
      <MeasurementNumberCell
        value={null}
        onCommit={onCommit}
        columnUnit="g"
        displayUnit="kg"
        certifiedValueOptions={options}
      />,
    )
    fireEvent.click(screen.getByTitle('Inserir valor certificado'))
    fireEvent.click(screen.getByText('500 kg'))
    expect(onCommit).toHaveBeenLastCalledWith(500000)
  })
})
