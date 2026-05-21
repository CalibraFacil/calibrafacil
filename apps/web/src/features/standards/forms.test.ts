import { describe, expect, it } from 'vitest'

import {
  createStandardCertifiedValueDraft,
  createStandardFormData,
  createStandardRenewFormData,
  hasCertifiedValues,
  parseStandardEditForm,
  parseStandardForm,
  parseStandardRenewForm,
  STANDARD_STATUS_LABELS,
  type StandardFormData,
  type StandardRenewFormData,
} from './forms'
import type { StandardDetail } from './types'

describe('standard feature forms', () => {
  it('builds single-value create payloads through the shared schema', () => {
    const result = parseStandardForm(
      {
        ...validStandardForm(),
        type: 'Peso',
        referenceValue: '10',
        uncertainty: '0.01',
        uncertaintyUnit: 'g',
      },
      { isMultiValue: false },
    )

    expect(result).toEqual({
      success: true,
      data: {
        name: 'Peso classe F1',
        type: 'Peso',
        serialNumber: 'SN-STD-1',
        certificateNumber: 'CERT-001',
        calibrationDate: '2026-05-20',
        nextCalibrationDate: '2027-05-20',
        referenceValue: 10,
        uncertainty: 0.01,
        uncertaintyUnit: 'g',
        coverageFactor: 2,
        distribution: 'normal',
        status: 'ACTIVE',
      },
    })
  })

  it('builds multi-value update payloads and clears single-value fields', () => {
    const result = parseStandardEditForm(
      {
        ...validStandardForm(),
        certifiedValues: [
          {
            nominal: '1 g',
            value: '1.0001',
            uncertainty: '0.0002',
            unit: 'g',
            maxError: '',
            drift: '0.00001',
            buoyancy: '',
            coverageFactor: '2',
          },
        ],
      },
      { isMultiValue: true },
    )

    expect(result).toMatchObject({
      success: true,
      data: {
        certifiedValues: [
          {
            nominal: '1 g',
            value: 1.0001,
            uncertainty: 0.0002,
            unit: 'g',
            maxError: null,
            drift: 0.00001,
            buoyancy: null,
            coverageFactor: 2,
          },
        ],
        referenceValue: null,
        uncertainty: null,
        uncertaintyUnit: null,
      },
    })
  })

  it('maps required standard fields to form errors', () => {
    const result = parseStandardForm(
      {
        ...validStandardForm(),
        name: '',
        serialNumber: '',
        certificateNumber: '',
        calibrationDate: '',
        nextCalibrationDate: '',
      },
      { isMultiValue: false },
    )

    expect(result).toMatchObject({
      success: false,
      message: 'Nome é obrigatório',
      fieldErrors: [
        { field: 'name', message: 'Nome é obrigatório' },
        {
          field: 'serialNumber',
          message: 'Número de série é obrigatório',
        },
        {
          field: 'certificateNumber',
          message: 'Número do certificado é obrigatório',
        },
        {
          field: 'calibrationDate',
          message: 'Data de calibração é obrigatória',
        },
        {
          field: 'nextCalibrationDate',
          message: 'Próxima calibração é obrigatória',
        },
      ],
    })
  })

  it('builds renewal payloads through the shared schema', () => {
    const result = parseStandardRenewForm(validRenewForm(), {
      isMultiValue: false,
    })

    expect(result).toEqual({
      success: true,
      data: {
        certificateNumber: 'CERT-002',
        calibratedBy: 'RBC',
        calibrationDate: '2026-05-20',
        nextCalibrationDate: '2027-05-20',
        reason: 'Renovacao anual',
        coverageFactor: 2,
        referenceValue: 10,
        uncertainty: 0.01,
        uncertaintyUnit: 'g',
      },
    })
  })

  it('creates route form drafts from empty and existing standard records', () => {
    expect(createStandardFormData()).toMatchObject({
      coverageFactor: '2.0',
      distribution: 'normal',
      certifiedValues: [],
      status: 'ACTIVE',
    })

    const formData = createStandardFormData({
      ...validStandardDetail(),
      calibrationDate: '2026-05-20T15:30:00.000Z',
      nextCalibrationDate: '2027-05-20T15:30:00.000Z',
      certifiedValues: [
        {
          nominal: '1 g',
          value: 1.0001,
          uncertainty: 0.0002,
          unit: 'g',
          maxError: null,
          drift: 0.00001,
          buoyancy: null,
          coverageFactor: 2,
        },
      ],
    })

    expect(formData).toMatchObject({
      calibrationDate: '2026-05-20',
      nextCalibrationDate: '2027-05-20',
      referenceValue: '10',
      uncertainty: '0.01',
      certifiedValues: [
        {
          nominal: '1 g',
          value: '1.0001',
          uncertainty: '0.0002',
          unit: 'g',
          maxError: '',
          drift: '0.00001',
          buoyancy: '',
          coverageFactor: '2',
        },
      ],
    })
  })

  it('creates certified-value and renewal drafts for route state', () => {
    const formData = validStandardForm()

    expect(createStandardCertifiedValueDraft({ unit: 'g' })).toMatchObject({
      nominal: '',
      value: '',
      uncertainty: '',
      unit: 'g',
    })
    expect(createStandardRenewFormData(formData)).toEqual({
      certificateNumber: '',
      calibratedBy: formData.calibratedBy,
      calibrationDate: '',
      nextCalibrationDate: '',
      referenceValue: formData.referenceValue,
      uncertainty: formData.uncertainty,
      uncertaintyUnit: formData.uncertaintyUnit,
      coverageFactor: formData.coverageFactor,
      certifiedValues: formData.certifiedValues,
      reason: '',
    })
    expect(hasCertifiedValues(validStandardDetail())).toBe(false)
    expect(
      hasCertifiedValues({
        ...validStandardDetail(),
        certifiedValues: [
          { nominal: '1 g', value: 1, uncertainty: 0.1, unit: 'g' },
        ],
      }),
    ).toBe(true)
    expect(STANDARD_STATUS_LABELS.OUT_OF_TOLERANCE).toBe('Fora de Tolerância')
  })
})

function validStandardForm(): StandardFormData {
  return {
    name: 'Peso classe F1',
    type: '',
    serialNumber: 'SN-STD-1',
    manufacturer: '',
    model: '',
    certificateNumber: 'CERT-001',
    calibratedBy: '',
    calibrationDate: '2026-05-20',
    nextCalibrationDate: '2027-05-20',
    referenceValue: '10',
    uncertainty: '0.01',
    uncertaintyUnit: 'g',
    coverageFactor: '2',
    distribution: 'normal',
    drift: '',
    certifiedValues: [],
    status: 'ACTIVE',
  }
}

function validRenewForm(): StandardRenewFormData {
  return {
    certificateNumber: 'CERT-002',
    calibratedBy: 'RBC',
    calibrationDate: '2026-05-20',
    nextCalibrationDate: '2027-05-20',
    referenceValue: '10',
    uncertainty: '0.01',
    uncertaintyUnit: 'g',
    coverageFactor: '2',
    certifiedValues: [],
    reason: 'Renovacao anual',
  }
}

function validStandardDetail(): StandardDetail {
  return {
    id: 1,
    name: 'Peso classe F1',
    type: 'Peso',
    serialNumber: 'SN-STD-1',
    manufacturer: null,
    model: null,
    certificateNumber: 'CERT-001',
    calibratedBy: 'RBC',
    calibrationDate: '2026-05-20',
    nextCalibrationDate: '2027-05-20',
    referenceValue: 10,
    uncertainty: 0.01,
    uncertaintyUnit: 'g',
    coverageFactor: 2,
    distribution: 'normal',
    drift: null,
    certifiedValues: null,
    status: 'ACTIVE',
    isExpired: false,
    daysUntilExpiry: 365,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }
}
