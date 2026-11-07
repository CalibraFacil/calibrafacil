// @vitest-environment jsdom

import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { DecimalInput } from './decimal-input'

function Harness({ initial = null }: { initial?: number | null }) {
  const [value, setValue] = useState<number | null>(initial)
  return (
    <>
      <DecimalInput aria-label="valor" value={value} onValueChange={setValue} />
      <output data-testid="state">{String(value)}</output>
    </>
  )
}

function type(input: HTMLElement, text: string) {
  let typed = ''
  for (const char of text) {
    typed += char
    fireEvent.change(input, { target: { value: typed } })
  }
}

describe('DecimalInput', () => {
  afterEach(cleanup)

  it('keeps a typed 0 as 0, not null', () => {
    render(<Harness />)

    type(screen.getByLabelText('valor'), '0')

    expect(screen.getByTestId('state').textContent).toBe('0')
  })

  it('lets a decimal be typed with the comma without losing the separator', () => {
    render(<Harness />)
    const input = screen.getByLabelText('valor')

    type(input, '23,5')

    expect(input).toHaveProperty('value', '23,5')
    expect(screen.getByTestId('state').textContent).toBe('23.5')
  })

  it('refuses text that cannot become a number', () => {
    render(<Harness initial={21} />)
    const input = screen.getByLabelText('valor')

    fireEvent.change(input, { target: { value: '2a1' } })

    expect(input).toHaveProperty('value', '21')
  })

  it('shows the stored number with the decimal comma and clears to null', () => {
    render(<Harness initial={12.5} />)
    const input = screen.getByLabelText('valor')

    expect(input).toHaveProperty('value', '12,5')
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByTestId('state').textContent).toBe('null')
  })
})
