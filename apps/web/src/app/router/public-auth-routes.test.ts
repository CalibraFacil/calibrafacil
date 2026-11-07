import { describe, expect, it } from 'vitest'

import { parseSignUpForm } from '@/features/auth/sign-up-forms'

/**
 * Self-serve sign-up: a laboratory can open its own account from the pricing
 * page. The rule underneath it is that an account is only opened for a
 * laboratory that owns its e-mail domain, and it still costs a click on a link
 * sent to that mailbox.
 */
describe('self-serve sign-up form', () => {
  const corporate = {
    name: 'Ana Souza',
    email: 'ana@laboratorio-exemplo.com.br',
    labName: 'Laboratório Exemplo',
    cnpj: '11.222.333/0001-81',
    phone: '',
  }

  it('accepts a laboratory that owns its e-mail domain', () => {
    const result = parseSignUpForm(corporate, { website: '' })

    expect(result).toMatchObject({
      success: true,
      data: { email: 'ana@laboratorio-exemplo.com.br', cnpj: '11222333000181' },
    })
  })

  it('refuses a public mailbox in the browser, as the API does', () => {
    const result = parseSignUpForm(
      { ...corporate, email: 'ana@gmail.com' },
      { website: '' },
    )

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.fieldErrors.map((item) => item.field)).toEqual(['email'])
  })

  it('refuses a CNPJ with a wrong check digit', () => {
    const result = parseSignUpForm(
      { ...corporate, cnpj: '11.222.333/0001-82' },
      { website: '' },
    )

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.fieldErrors.map((item) => item.field)).toEqual(['cnpj'])
  })
})
