import { describe, expect, it } from 'vitest'

import {
  parseServiceEditForm,
  parseServiceForm,
  type ServiceFormData,
} from './forms'

describe('service feature forms', () => {
  it('builds and validates service create payloads', () => {
    const result = parseServiceForm({
      ...validServiceForm(),
      name: '  Calibracao de balanca  ',
      description: '  Escopo rastreado  ',
      methodId: 12,
      assetTypeId: 34,
      price: '150,25',
      tat: '5',
    })

    expect(result).toEqual({
      success: true,
      data: {
        name: 'Calibracao de balanca',
        description: 'Escopo rastreado',
        methodId: 12,
        assetTypeId: 34,
        price: 15025,
        currency: 'BRL',
        tat: 5,
        isActive: true,
      },
    })
  })

  it('keeps blank commercial fields as null payload values', () => {
    const result = parseServiceForm(validServiceForm())

    expect(result).toEqual({
      success: true,
      data: {
        name: 'Calibracao de balanca',
        methodId: null,
        assetTypeId: null,
        price: null,
        currency: 'BRL',
        tat: null,
        isActive: true,
      },
    })
  })

  it('maps invalid service inputs to route fields', () => {
    const result = parseServiceForm({
      ...validServiceForm(),
      name: '',
      price: '-1',
      tat: '0',
    })

    expect(result).toEqual({
      success: false,
      message: 'Nome é obrigatório',
      fieldErrors: [
        { field: 'name', message: 'Nome é obrigatório' },
        { field: 'price', message: 'Preço inválido' },
        { field: 'tat', message: 'Prazo deve ser pelo menos 1 dia' },
      ],
    })
  })

  it('builds service update payloads with schema validation', () => {
    const result = parseServiceEditForm({
      ...validServiceForm(),
      name: 'Servico revisado',
      description: '',
      price: '99.90',
      tat: '2',
      isActive: false,
    })

    expect(result).toEqual({
      success: true,
      data: {
        name: 'Servico revisado',
        methodId: null,
        assetTypeId: null,
        price: 9990,
        currency: 'BRL',
        tat: 2,
        isActive: false,
      },
    })
  })
})

function validServiceForm(): ServiceFormData {
  return {
    name: 'Calibracao de balanca',
    description: '',
    methodId: null,
    assetTypeId: null,
    price: '',
    tat: '',
    isActive: true,
  }
}
