import { describe, expect, it } from 'vitest'

import {
  parseMaterialEditForm,
  parseMaterialForm,
  type MaterialFormData,
} from './forms'

describe('materials feature forms', () => {
  it('builds and validates material create payloads (REQ-MATUI-002)', () => {
    const result = parseMaterialForm({
      ...validMaterialForm(),
      name: '  Sensor de carga 500kg  ',
      description: '  Peça de reposição para balança rodoviária  ',
      sku: '  SC-500  ',
      unit: '  un  ',
      unitCostCents: '120,50',
      unitPriceCents: '199,90',
      controlsStock: true,
      isActive: true,
    })

    expect(result).toEqual({
      success: true,
      data: {
        name: 'Sensor de carga 500kg',
        description: 'Peça de reposição para balança rodoviária',
        sku: 'SC-500',
        unit: 'un',
        unitCostCents: 12050,
        unitPriceCents: 19990,
        controlsStock: true,
        isActive: true,
      },
    })
  })

  it('parses pt-BR masked money input into integer cents (REQ-MATUI-002)', () => {
    const result = parseMaterialForm({
      ...validMaterialForm(),
      name: 'Rolamento 6202',
      unitCostCents: '1,05',
      unitPriceCents: '2,9',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.unitCostCents).toBe(105)
      expect(result.data.unitPriceCents).toBe(290)
    }
  })

  it('keeps blank commercial fields as null payload values with unit defaulted', () => {
    const result = parseMaterialForm(validMaterialForm())

    expect(result).toEqual({
      success: true,
      data: {
        name: 'Sensor de carga 500kg',
        unit: 'un',
        unitCostCents: null,
        unitPriceCents: null,
        controlsStock: false,
        isActive: true,
      },
    })
  })

  it('maps invalid material inputs to route fields (REQ-MATUI-002)', () => {
    const result = parseMaterialForm({
      ...validMaterialForm(),
      name: '',
      unitCostCents: '-5',
      unitPriceCents: 'abc',
    })

    expect(result).toEqual({
      success: false,
      message: 'Nome é obrigatório',
      fieldErrors: [
        { field: 'name', message: 'Nome é obrigatório' },
        { field: 'unitCostCents', message: 'Custo inválido' },
        { field: 'unitPriceCents', message: 'Preço inválido' },
      ],
    })
  })

  it('builds material update payloads with schema validation (REQ-MATUI-003)', () => {
    const result = parseMaterialEditForm({
      ...validMaterialForm(),
      name: 'Sensor revisado',
      description: '',
      unitCostCents: '99.90',
      unitPriceCents: '150.00',
      isActive: false,
    })

    expect(result).toEqual({
      success: true,
      data: {
        name: 'Sensor revisado',
        unit: 'un',
        unitCostCents: 9990,
        unitPriceCents: 15000,
        controlsStock: false,
        isActive: false,
      },
    })
  })
})

function validMaterialForm(): MaterialFormData {
  return {
    name: 'Sensor de carga 500kg',
    description: '',
    sku: '',
    unit: '',
    unitCostCents: '',
    unitPriceCents: '',
    controlsStock: false,
    isActive: true,
  }
}
