// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Input } from '@/components/ui/input'
import { FormField } from './form-field'

describe('FormField', () => {
  it('associates the label with a simple control', () => {
    render(
      <FormField label="Nome">
        <Input />
      </FormField>,
    )

    expect(screen.getByLabelText('Nome')).toBeTruthy()
  })

  it('links errors through aria-describedby', () => {
    render(
      <FormField label="Descrição" error="Descrição é obrigatória">
        <Input />
      </FormField>,
    )

    const input = screen.getByLabelText('Descrição')
    const error = screen.getByRole('alert')

    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(error.id)
  })
})
