// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CurrencyInput } from './currency-input'

afterEach(cleanup)

function Harness({
  initialCents = 0,
  onValidityChange,
}: {
  initialCents?: number
  onValidityChange?: (valid: boolean) => void
}) {
  const [cents, setCents] = useState(initialCents)
  return (
    <>
      <CurrencyInput
        aria-label="Valor"
        valueCents={cents}
        onValueChange={setCents}
        onValidityChange={onValidityChange}
      />
      <output data-testid="cents">{cents}</output>
    </>
  )
}

function field() {
  return screen.getByLabelText('Valor')
}

function type(text: string) {
  fireEvent.change(field(), { target: { value: text } })
}

function fieldValue() {
  return field().getAttribute('value') ?? ''
}

describe('CurrencyInput', () => {
  it('reads a pt-BR amount with a thousands separator as that amount', () => {
    render(<Harness />)
    type('1.234,56')
    expect(screen.getByTestId('cents').textContent).toBe('123456')

    fireEvent.blur(field())
    expect(fieldValue()).toBe('1234,56')
    expect(screen.getByTestId('cents').textContent).toBe('123456')
  })

  it('reads a dot-decimal amount as the decimal it is', () => {
    render(<Harness />)
    type('12.50')
    expect(screen.getByTestId('cents').textContent).toBe('1250')
  })

  it('shows an error for an unreadable entry and neither zeroes nor rewrites it', () => {
    const onValidityChange = vi.fn()
    render(<Harness initialCents={5000} onValidityChange={onValidityChange} />)

    type('1.234.56')
    expect(screen.getByRole('alert').textContent).toMatch(/ambíguo/)
    expect(field().getAttribute('aria-invalid')).toBe('true')
    expect(onValidityChange).toHaveBeenLastCalledWith(false)
    // The parent keeps its last valid amount, not 0.
    expect(screen.getByTestId('cents').textContent).toBe('5000')

    fireEvent.blur(field())
    expect(fieldValue()).toBe('1.234.56')
    expect(screen.getByTestId('cents').textContent).toBe('5000')
  })

  it('clears the error once the text is fixed', () => {
    const onValidityChange = vi.fn()
    render(<Harness onValidityChange={onValidityChange} />)

    type('abc')
    expect(screen.queryByRole('alert')).not.toBeNull()

    type('12,5')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(field().getAttribute('aria-invalid')).toBeNull()
    expect(onValidityChange).toHaveBeenLastCalledWith(true)
    expect(screen.getByTestId('cents').textContent).toBe('1250')
  })

  it('treats a cleared field as 0 and shows 0,00 on blur', () => {
    render(<Harness initialCents={5000} />)
    type('')
    expect(screen.getByTestId('cents').textContent).toBe('0')
    fireEvent.blur(field())
    expect(fieldValue()).toBe('0,00')
  })
})
