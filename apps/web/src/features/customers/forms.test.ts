import { describe, expect, it } from 'vitest'

import { parseCustomerForm, type CustomerFormData } from './forms'

describe('customer feature forms', () => {
  it('builds and validates customer create payloads', () => {
    const result = parseCustomerForm({
      ...validCustomerForm(),
      name: '  Empresa ACME  ',
      tradeName: '  ACME  ',
      taxId: '  12.345.678/0001-90  ',
      email: '  contato@acme.test  ',
      phone: '  (11) 99999-9999  ',
      address: {
        cep: '  01001-000  ',
        street: '  Praca da Se  ',
        number: '  100  ',
        complement: '  Sala 4  ',
        neighbourhood: '  Se  ',
        city: '  Sao Paulo  ',
        state: '  SP  ',
      },
    })

    expect(result).toEqual({
      success: true,
      data: {
        name: 'Empresa ACME',
        tradeName: 'ACME',
        taxId: '12.345.678/0001-90',
        email: 'contato@acme.test',
        phone: '(11) 99999-9999',
        address: {
          cep: '01001-000',
          street: 'Praca da Se',
          number: '100',
          complement: 'Sala 4',
          neighbourhood: 'Se',
          city: 'Sao Paulo',
          state: 'SP',
        },
      },
    })
  })

  it('omits empty optional fields and empty address blocks', () => {
    const result = parseCustomerForm(validCustomerForm())

    expect(result).toEqual({
      success: true,
      data: {
        name: 'Empresa ACME',
      },
    })
  })

  it('omits an empty trade name but keeps a provided one', () => {
    const withTradeName = parseCustomerForm({
      ...validCustomerForm(),
      tradeName: '  ACME  ',
    })
    expect(withTradeName).toEqual({
      success: true,
      data: { name: 'Empresa ACME', tradeName: 'ACME' },
    })

    const blankTradeName = parseCustomerForm({
      ...validCustomerForm(),
      tradeName: '   ',
    })
    expect(blankTradeName).toEqual({
      success: true,
      data: { name: 'Empresa ACME' },
    })
  })

  it('maps customer schema issues to route fields', () => {
    const result = parseCustomerForm({
      ...validCustomerForm(),
      name: 'A',
      email: 'email-invalido',
    })

    expect(result).toEqual({
      success: false,
      message: 'Nome deve ter pelo menos 2 caracteres',
      fieldErrors: [
        {
          field: 'name',
          message: 'Nome deve ter pelo menos 2 caracteres',
        },
        {
          field: 'email',
          message: 'Revise o endereço de email antes de enviar o convite.',
        },
      ],
    })
  })

  it('keeps the existing empty-name message before schema validation', () => {
    const result = parseCustomerForm({
      ...validCustomerForm(),
      name: ' ',
    })

    expect(result).toEqual({
      success: false,
      message: 'Informe o nome ou razão social do cliente.',
      fieldErrors: [
        {
          field: 'name',
          message: 'Informe o nome ou razão social do cliente.',
        },
      ],
    })
  })
})

function validCustomerForm(): CustomerFormData {
  return {
    name: 'Empresa ACME',
    tradeName: '',
    taxId: '',
    email: '',
    phone: '',
    address: {
      cep: '',
      street: '',
      number: '',
      complement: '',
      neighbourhood: '',
      city: '',
      state: '',
    },
  }
}
