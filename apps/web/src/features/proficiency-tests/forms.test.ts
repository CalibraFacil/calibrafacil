import { describe, expect, it } from 'vitest'

import {
  emptyPtResultPointForm,
  parsePtPlanItemForm,
  parsePtResultsForm,
  parsePtRoundForm,
  type PtResultPointFormData,
  type PtRoundFormData,
} from './forms'

describe('proficiency-tests feature forms', () => {
  it('builds and validates PT round create payloads', () => {
    const result = parsePtRoundForm(
      validPtRoundForm(),
      new Date('2026-02-01T00:00:00.000Z'),
      new Date('2026-04-10T00:00:00.000Z'),
    )

    expect(result).toMatchObject({
      success: true,
      data: {
        activityType: 'proficiency_test',
        provider: 'Rede Metrológica RS',
        ptRound: 'EP-MASSA-2026-01',
        scopePart: 'Massa — pesos classe M1',
      },
    })
    expect(result.success && result.data.registrationDate).toContain(
      '2026-02-01T',
    )
    expect(result.success && result.data.standardId).toBe(7)
  })

  it('maps PT round schema issues to form fields', () => {
    const result = parsePtRoundForm(
      { ...validPtRoundForm(), provider: 'a', scopePart: '' },
      undefined,
      undefined,
    )

    expect(result).toMatchObject({
      success: false,
      fieldErrors: [
        { field: 'provider', message: 'Provedor é obrigatório' },
        { field: 'scopePart', message: 'Parte do escopo é obrigatória' },
      ],
    })
  })

  it('builds and validates PT results payloads (happy path)', () => {
    const result = parsePtResultsForm(
      {
        results: [
          {
            ...emptyPtResultPointForm(),
            label: '1 kg nominal',
            unit: 'mg',
            scoreType: 'en',
            labValue: '1000.02',
            labUncertainty: '0.05',
            refValue: '1000.00',
            refUncertainty: '0.02',
          },
        ],
      },
      new Date('2026-06-15T00:00:00.000Z'),
    )

    expect(result).toMatchObject({
      success: true,
      data: {
        results: [
          {
            label: '1 kg nominal',
            unit: 'mg',
            scoreType: 'en',
            labValue: 1000.02,
            labUncertainty: 0.05,
            refValue: 1000,
            refUncertainty: 0.02,
          },
        ],
      },
    })
    expect(result.success && result.data.resultReportedAt).toContain(
      '2026-06-15T',
    )
  })

  it('requires lab uncertainty for En scores', () => {
    const result = parsePtResultsForm(
      {
        results: [
          {
            ...validEnResultPoint(),
            labUncertainty: '',
          },
        ],
      },
      new Date('2026-06-15T00:00:00.000Z'),
    )

    expect(result).toMatchObject({
      success: false,
      message: 'Incerteza do laboratório é obrigatória para En/ζ',
      fieldErrors: [
        {
          field: 'results',
          message: 'Incerteza do laboratório é obrigatória para En/ζ',
        },
      ],
    })
  })

  it('requires sigma_pt for z scores', () => {
    const result = parsePtResultsForm(
      {
        results: [
          {
            ...emptyPtResultPointForm(),
            label: 'Ponto 100 mm',
            scoreType: 'z',
            labValue: '100.01',
            refValue: '100.00',
          },
        ],
      },
      new Date('2026-06-15T00:00:00.000Z'),
    )

    expect(result).toMatchObject({
      success: false,
      message: 'σ_pt é obrigatório para escores z/z′',
      fieldErrors: [
        {
          field: 'results',
          message: 'σ_pt é obrigatório para escores z/z′',
        },
      ],
    })
  })

  it('requires the provider report date', () => {
    const result = parsePtResultsForm(
      { results: [validEnResultPoint()] },
      undefined,
    )

    expect(result).toMatchObject({
      success: false,
      message: 'Data do relatório do provedor é obrigatória',
    })
  })

  it('rejects points missing measured values before schema coercion', () => {
    const result = parsePtResultsForm(
      {
        results: [{ ...validEnResultPoint(), labValue: '' }],
      },
      new Date('2026-06-15T00:00:00.000Z'),
    )

    expect(result).toMatchObject({
      success: false,
      message:
        'Informe o valor do laboratório e o valor de referência no ponto 1',
    })
  })

  it('builds PT plan item payloads with the default 48-month cycle', () => {
    const result = parsePtPlanItemForm(
      {
        scopePart: 'Massa — pesos classe M1',
        riskJustification: '',
        frequencyMonths: '',
      },
      new Date('2025-03-01T00:00:00.000Z'),
    )

    expect(result).toMatchObject({
      success: true,
      data: {
        scopePart: 'Massa — pesos classe M1',
        frequencyMonths: 48,
      },
    })
    expect(result.success && result.data.riskJustification).toBeUndefined()
  })

  it('maps PT plan schema issues to form fields', () => {
    const result = parsePtPlanItemForm(
      {
        scopePart: 'Massa',
        riskJustification: '',
        frequencyMonths: '240',
      },
      undefined,
    )

    expect(result).toMatchObject({
      success: false,
      message: 'Frequência máxima de 120 meses',
      fieldErrors: [
        { field: 'frequencyMonths', message: 'Frequência máxima de 120 meses' },
      ],
    })
  })
})

function validPtRoundForm(): PtRoundFormData {
  return {
    activityType: 'proficiency_test',
    provider: 'Rede Metrológica RS',
    providerAccreditation: '',
    ptRound: 'EP-MASSA-2026-01',
    scopePart: 'Massa — pesos classe M1',
    metrologyKind: 'massa',
    standardId: '7',
    notes: '',
  }
}

function validEnResultPoint(): PtResultPointFormData {
  return {
    ...emptyPtResultPointForm(),
    label: '1 kg nominal',
    scoreType: 'en',
    labValue: '1000.02',
    labUncertainty: '0.05',
    refValue: '1000.00',
    refUncertainty: '0.02',
  }
}
