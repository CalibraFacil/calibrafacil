import { describe, expect, it } from 'vitest'

import {
  buildRegulatedIntervalFromForm,
  DEFAULT_REGULATED_FORM_FIELDS,
  isAssetFormStatus,
  listMissingAssetRequirements,
  parseAssetEditForm,
  parseAssetForm,
  regulatedFormFieldsFromAsset,
  type AssetEditFormData,
  type AssetFormData,
} from './forms'

describe('asset feature forms', () => {
  it('lists the missing required inputs in visual order', () => {
    const empty: AssetFormData = {
      ...validAssetForm(),
      customerId: null,
      assetTypeId: null,
      name: '',
      tag: '   ',
      serialNumber: '',
      baseMeasurementUnit: null,
      specifications: {},
    }

    expect(listMissingAssetRequirements(empty)).toEqual([
      { field: 'assetTypeId', label: 'Tipo de instrumento' },
      { field: 'customerId', label: 'Cliente' },
      { field: 'name', label: 'Nome' },
      { field: 'tag', label: 'Tag' },
      { field: 'serialNumber', label: 'Número de série' },
    ])

    expect(
      listMissingAssetRequirements(empty, {
        requiresMassBaseUnit: true,
        specificationFields: [
          { key: 'capacity', label: 'Capacidade', required: true },
          { key: 'notes', label: 'Notas', required: false },
        ],
      }).map((item) => item.label),
    ).toEqual([
      'Tipo de instrumento',
      'Cliente',
      'Nome',
      'Tag',
      'Número de série',
      'Unidade base',
      'Capacidade',
    ])
  })

  it('reports nothing missing once every required input is filled', () => {
    expect(
      listMissingAssetRequirements(
        {
          ...validAssetForm(),
          baseMeasurementUnit: 'kg',
          specifications: { capacity: 10 },
        },
        {
          requiresMassBaseUnit: true,
          specificationFields: [
            { key: 'capacity', label: 'Capacidade', required: true },
          ],
        },
      ),
    ).toEqual([])
  })

  it('keeps the readiness list in sync with parseAssetForm required rules', () => {
    const form: AssetFormData = { ...validAssetForm(), name: '', tag: '' }
    const parsed = parseAssetForm(form)
    const missing = listMissingAssetRequirements(form).map((item) => item.field)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      for (const error of parsed.fieldErrors) {
        expect(missing).toContain(error.field)
      }
    }
  })

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

  it('REQ-INSTALL-004: carries the installation date through create as an ISO string', () => {
    const result = parseAssetForm({
      ...validAssetForm(),
      installedAt: new Date('2021-07-15T00:00:00.000Z'),
    })
    expect(result.success && result.data.installedAt).toBe(
      '2021-07-15T00:00:00.000Z',
    )
  })

  it('REQ-INSTALL-004: omits installedAt from the create payload when unset', () => {
    const result = parseAssetForm(validAssetForm())
    expect(result.success && result.data.installedAt).toBeUndefined()
  })

  it('REQ-INSTALL-004: carries the installation date through update as an ISO string', () => {
    const result = parseAssetEditForm({
      ...validAssetEditForm(),
      installedAt: new Date('2020-03-01T00:00:00.000Z'),
    })
    expect(result.success && result.data.installedAt).toBe(
      '2020-03-01T00:00:00.000Z',
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
        // No deprecated boolean in the payload: with the `.default(false)` removed, an
        // omitted regime leaves the API to keep the asset's current regime (so a
        // non-regime update never silently resets a LEGAL asset to INDUSTRIAL).
        metrologyRegime: 'INDUSTRIAL',
      },
    })
  })

  it('REQ-MLR-063: sets the regime LEGAL with a regulated interval on create', () => {
    const industrial = parseAssetForm(validAssetForm())
    expect(industrial.success && industrial.data.metrologyRegime).toBe(
      'INDUSTRIAL',
    )
    expect(
      industrial.success && industrial.data.regulatedInterval,
    ).toBeUndefined()

    const legal = parseAssetForm({
      ...validAssetForm(),
      metrologyRegime: 'LEGAL',
      regulatedKind: 'fixed_months',
      regulatedValueMonths: '12',
      regulatedAnchor: 'calendar_year',
      regulationReference: 'Portaria Inmetro nº 157/2022',
      regulatedOperationalizedByDelegate: true,
    })
    expect(legal.success && legal.data.metrologyRegime).toBe('LEGAL')
    expect(legal.success && legal.data.regulatedInterval).toEqual({
      kind: 'fixed_months',
      valueMonths: 12,
      anchor: 'calendar_year',
      regulationReference: 'Portaria Inmetro nº 157/2022',
      operationalizedByDelegate: true,
    })
  })

  it('REQ-MLR-063: rejects a LEGAL asset with an incomplete regulated interval', () => {
    const result = parseAssetForm({
      ...validAssetForm(),
      metrologyRegime: 'LEGAL',
      regulatedKind: 'fixed_months',
      regulatedValueMonths: '',
      regulationReference: '',
    })
    expect(result.success).toBe(false)
    expect(
      !result.success &&
        result.fieldErrors.some((e) => e.field === 'regulationReference'),
    ).toBe(true)
  })

  it('REQ-MLR-063: carries the regime + regulated interval through update', () => {
    const result = parseAssetEditForm({
      ...validAssetEditForm(),
      metrologyRegime: 'LEGAL',
      regulatedKind: 'per_technology',
      regulatedValueMonths: '120',
      regulatedAnchor: 'first_verification',
      regulatedTechnology: 'diafragma',
      regulationReference: 'Portaria Inmetro nº 156/2022',
    })
    expect(result.success && result.data.metrologyRegime).toBe('LEGAL')
    expect(result.success && result.data.regulatedInterval).toEqual({
      kind: 'per_technology',
      valueMonths: 120,
      anchor: 'first_verification',
      technology: 'diafragma',
      regulationReference: 'Portaria Inmetro nº 156/2022',
      operationalizedByDelegate: false,
    })
  })

  it('assembles + round-trips the regulated interval form fields', () => {
    expect(
      buildRegulatedIntervalFromForm({
        metrologyRegime: 'INDUSTRIAL',
        ...DEFAULT_REGULATED_FORM_FIELDS,
      }),
    ).toBeNull()

    const fields = regulatedFormFieldsFromAsset({
      metrologyRegime: 'LEGAL',
      regulatedInterval: {
        kind: 'not_nationally_fixed',
        regulationReference: 'Portaria Inmetro nº 493/2021',
        operationalizedByDelegate: false,
        note: 'ANEEL Res. 414/2010 é regime distinto.',
      },
    })
    expect(fields.metrologyRegime).toBe('LEGAL')
    expect(fields.regulatedKind).toBe('not_nationally_fixed')
    expect(buildRegulatedIntervalFromForm(fields)).toEqual({
      kind: 'not_nationally_fixed',
      regulationReference: 'Portaria Inmetro nº 493/2021',
      operationalizedByDelegate: false,
      note: 'ANEEL Res. 414/2010 é regime distinto.',
    })
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
    installedAt: undefined,
    comments: '',
    metrologyRegime: 'INDUSTRIAL',
    ...DEFAULT_REGULATED_FORM_FIELDS,
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
    installedAt: undefined,
    comments: '',
    metrologyRegime: 'INDUSTRIAL',
    ...DEFAULT_REGULATED_FORM_FIELDS,
    specifications: {},
  }
}
