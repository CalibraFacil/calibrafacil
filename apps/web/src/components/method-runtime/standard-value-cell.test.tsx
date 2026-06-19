// @vitest-environment jsdom

import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { TableInputRenderer } from './table-input-renderer'
import type { MethodInputField } from './types'
import type { StandardCertifiedValueOption } from './standard-value-utils'

const FORCE_OPTION: StandardCertifiedValueOption = {
  standardId: 7,
  standardName: 'Célula de carga',
  certificateNumber: 'CERT-FORCE-1',
  certifiedValueIndex: 0,
  nominal: '100 N',
  value: 100.02,
  uncertainty: 0.05,
  coverageFactor: 2.1,
  drift: 0.01,
  unit: 'N',
  optionLabel: '100 N - Célula de carga (CERT-FORCE-1)',
}

const DEFAULT_OPTIONS: StandardCertifiedValueOption[] = [FORCE_OPTION]

const FIELD: MethodInputField = {
  key: 'leituras',
  label: 'Leituras',
  type: 'table',
  columns: [
    { key: 'ponto', label: 'Ponto', type: 'text' },
    {
      key: 'valor_padrao',
      label: 'Valor do padrão',
      type: 'number',
      unit: 'N',
      role: 'standard_value',
      standardValue: {
        matchBy: 'nominal',
        targetColumns: {
          value: 'valor_padrao',
          expandedUncertainty: 'incerteza_padrao',
          coverageFactor: 'k_referencia',
          drift: 'deriva',
        },
      },
    },
    { key: 'incerteza_padrao', label: 'U', type: 'number', unit: 'N' },
    { key: 'k_referencia', label: 'k', type: 'number' },
    { key: 'deriva', label: 'Deriva', type: 'number', unit: 'N' },
  ],
}

function Harness({
  options = DEFAULT_OPTIONS,
  onChange,
}: {
  options?: StandardCertifiedValueOption[]
  onChange?: (rows: Array<Record<string, unknown>>) => void
}) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([
    { ponto: '100 N', valor_padrao: null },
  ])
  return (
    <TableInputRenderer
      field={FIELD}
      value={rows}
      onChange={(next) => {
        setRows(next)
        onChange?.(next)
      }}
      standardCertifiedValueOptions={options}
    />
  )
}

afterEach(() => {
  cleanup()
})

describe('TableInputRenderer standard_value branch', () => {
  it('fills value / U / k / drift from a picked certified value (non-mass unit N)', () => {
    const calls: Array<Array<Record<string, unknown>>> = []
    render(<Harness onChange={(rows) => calls.push(rows)} />)

    // Open the certified-value picker (the icon button beside the input).
    fireEvent.click(
      screen.getByRole('button', { name: 'Preencher a partir do padrão' }),
    )

    // Pick the matching option (the popover button shows nominal + "· k").
    const optionButton = screen
      .getAllByRole('button')
      .find((node) => node.textContent?.includes('· k 2.1'))
    if (!optionButton) throw new Error('Option button not found')
    fireEvent.click(optionButton)

    const lastRows = calls.at(-1)
    expect(lastRows?.[0]).toEqual({
      ponto: '100 N',
      valor_padrao: 100.02,
      incerteza_padrao: 0.05,
      k_referencia: 2.1,
      deriva: 0.01,
    })
  })

  it('keeps the column manually editable as a fallback', () => {
    const calls: Array<Array<Record<string, unknown>>> = []
    render(<Harness options={[]} onChange={(rows) => calls.push(rows)} />)

    // With no options there is no picker button — only the manual inputs.
    expect(
      screen.queryByRole('button', { name: 'Preencher a partir do padrão' }),
    ).toBeNull()

    const inputs = screen.getAllByRole('textbox')
    // The standard_value column input accepts a typed (manual) value.
    fireEvent.change(inputs[1], { target: { value: '42' } })
    expect(calls.at(-1)?.[0]?.valor_padrao).toBe(42)
  })
})
