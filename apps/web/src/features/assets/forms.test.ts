import { describe, expect, it } from 'vitest'

import {
  isAssetFormStatus,
  parseAssetEditForm,
  parseAssetForm,
  type AssetEditFormData,
  type AssetFormData,
} from './forms'

describe('asset feature forms', () => {
  it('builds and validates asset create payloads', () => {
    const result = parseAssetForm({
      ...validAssetForm(),
      manufacturer: '  Mettler Toledo  ',
      model: '  XPE205  ',
      comments: '  Bancada analitica  ',
      lastCalibrationDate: new Date('2026-05-20T00:00:00.000Z'),
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        customerId: 10,
        assetTypeId: 20,
        name: 'Balanca analitica',
        manufacturer: 'Mettler Toledo',
        model: 'XPE205',
        serialNumber: 'SN-001',
        tag: 'BAL-001',
        status: 'ACTIVE',
        comments: 'Bancada analitica',
      },
    })
    expect(result.success && result.data.lastCalibrationDate).toBe(
      '2026-05-20T00:00:00.000Z',
    )
  })

  it('maps shared schema issues and required field checks to route fields', () => {
    const result = parseAssetForm({
      ...validAssetForm(),
      customerId: null,
      assetTypeId: null,
      name: ' ',
      serialNumber: ' ',
      tag: ' ',
    })

    expect(result).toEqual({
      success: false,
      message: 'Cliente é obrigatório',
      fieldErrors: [
        { field: 'customerId', message: 'Cliente é obrigatório' },
        {
          field: 'assetTypeId',
          message: 'Tipo de instrumento é obrigatório',
        },
        { field: 'name', message: 'Nome é obrigatório' },
        {
          field: 'serialNumber',
          message: 'Número de série é obrigatório',
        },
        { field: 'tag', message: 'Tag é obrigatória' },
      ],
    })
  })

  it('validates mass base unit requirements outside the shared payload schema', () => {
    const result = parseAssetForm(validAssetForm(), {
      requiresMassBaseUnit: true,
    })

    expect(result).toEqual({
      success: false,
      message: 'Selecione a unidade base do instrumento',
      fieldErrors: [
        {
          field: 'baseMeasurementUnit',
          message: 'Selecione a unidade base do instrumento',
        },
      ],
    })
  })

  it('validates required dynamic specifications', () => {
    const result = parseAssetForm(
      {
        ...validAssetForm(),
        specifications: { capacity: '' },
      },
      {
        specificationFields: [
          {
            key: 'capacity',
            label: 'Capacidade',
            type: 'number',
            required: true,
          },
          {
            key: 'ranges',
            label: 'Faixas',
            type: 'weighing_ranges',
            required: true,
          },
        ],
      },
    )

    expect(result).toEqual({
      success: false,
      message: 'Capacidade é obrigatório',
      fieldErrors: [
        { field: 'spec_capacity', message: 'Capacidade é obrigatório' },
        { field: 'spec_ranges', message: 'Faixas é obrigatório' },
      ],
    })
  })

  it('includes valid dynamic specifications in the payload', () => {
    const result = parseAssetForm(
      {
        ...validAssetForm(),
        baseMeasurementUnit: 'kg',
        specifications: {
          capacity: 220,
          ranges: [
            {
              label: 'Faixa 1',
              min: 0,
              max: 220,
              rangeUnit: 'kg',
              resolution: 0.1,
              resolutionUnit: 'g',
            },
          ],
        },
      },
      {
        requiresMassBaseUnit: true,
        specificationFields: [
          {
            key: 'capacity',
            label: 'Capacidade',
            type: 'number',
            required: true,
          },
          {
            key: 'ranges',
            label: 'Faixas',
            type: 'weighing_ranges',
            required: true,
          },
        ],
      },
    )

    expect(result).toMatchObject({
      success: true,
      data: {
        baseMeasurementUnit: 'kg',
        specifications: {
          capacity: 220,
          ranges: [
            {
              label: 'Faixa 1',
              max: 220,
            },
          ],
        },
      },
    })
  })

  it('builds and validates asset update payloads', () => {
    const result = parseAssetEditForm({
      ...validAssetEditForm(),
      name: '  Balanca semi-analitica  ',
      manufacturer: '  Shimadzu  ',
      comments: '',
    })

    expect(result).toEqual({
      success: true,
      data: {
        name: 'Balanca semi-analitica',
        manufacturer: 'Shimadzu',
        serialNumber: 'SN-002',
        tag: 'BAL-002',
        status: 'MAINTENANCE',
        subjectToLegalMetrology: false,
      },
    })
  })

  it('round-trips the legal-metrology flag on create', () => {
    const off = parseAssetForm(validAssetForm())
    expect(off.success && off.data.subjectToLegalMetrology).toBe(false)

    const on = parseAssetForm({
      ...validAssetForm(),
      subjectToLegalMetrology: true,
    })
    expect(on.success && on.data.subjectToLegalMetrology).toBe(true)
  })

  it('round-trips the legal-metrology flag on update', () => {
    const result = parseAssetEditForm({
      ...validAssetEditForm(),
      subjectToLegalMetrology: true,
    })
    expect(result.success && result.data.subjectToLegalMetrology).toBe(true)
  })

  it('maps asset update specification errors to edit route fields', () => {
    const result = parseAssetEditForm(
      {
        ...validAssetEditForm(),
        name: '',
        serialNumber: '',
        tag: '',
        specifications: { capacity: '' },
      },
      {
        specificationFields: [
          {
            key: 'capacity',
            label: 'Capacidade',
            type: 'number',
            required: true,
          },
        ],
      },
    )

    expect(result).toEqual({
      success: false,
      message: 'Nome é obrigatório',
      fieldErrors: [
        { field: 'name', message: 'Nome é obrigatório' },
        {
          field: 'serialNumber',
          message: 'Número de série é obrigatório',
        },
        { field: 'tag', message: 'Tag é obrigatória' },
        { field: 'spec_capacity', message: 'Capacidade é obrigatório' },
      ],
    })
  })

  it('narrows status select values before updating route state', () => {
    expect(isAssetFormStatus('ACTIVE')).toBe(true)
    expect(isAssetFormStatus('UNKNOWN')).toBe(false)
  })

  // NOTE: the lab no longer authors a calibration periodicity / next-calibration
  // date — periodicity is the customer's decision in the portal (§7.8.4.3 +
  // ILAC-G24). The former "calibration periodicity presets" tests were removed
  // with the feature. Next-date derivation now lives in the portal API
  // (apps/api/src/lib/portal-asset-interval.ts + .spec.ts).
})

function validAssetForm(): AssetFormData {
  return {
    customerId: 10,
    assetTypeId: 20,
    name: 'Balanca analitica',
    manufacturer: '',
    model: '',
    serialNumber: 'SN-001',
    tag: 'BAL-001',
    status: 'ACTIVE',
    baseMeasurementUnit: null,
    lastCalibrationDate: undefined,
    comments: '',
    subjectToLegalMetrology: false,
    specifications: {},
  }
}

function validAssetEditForm(): AssetEditFormData {
  return {
    name: 'Balanca semi-analitica',
    manufacturer: '',
    model: '',
    serialNumber: 'SN-002',
    tag: 'BAL-002',
    status: 'MAINTENANCE',
    lastCalibrationDate: undefined,
    comments: '',
    subjectToLegalMetrology: false,
    specifications: {},
  }
}
