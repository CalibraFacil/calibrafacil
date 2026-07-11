import { describe, expect, it } from 'vitest'

import {
  parseChartConfigForm,
  parseControlChartForm,
  parseReadingForm,
} from './forms'

describe('spc feature forms', () => {
  it('builds and validates control chart create payloads', () => {
    const result = parseControlChartForm({
      standardId: '12',
      parameter: 'Ponto 100 g',
      chartType: 'i_mr',
      baselineWindow: '20',
      subgroupSize: '',
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        standardId: 12,
        parameter: 'Ponto 100 g',
        chartType: 'i_mr',
        params: { baselineWindow: 20 },
      },
    })
  })

  it('requires a reference standard for new charts', () => {
    const result = parseControlChartForm({
      standardId: '',
      parameter: 'Ponto 100 g',
      chartType: 'i_mr',
      baselineWindow: '',
      subgroupSize: '',
    })

    expect(result).toMatchObject({
      success: false,
      message: 'Selecione o padrão de referência',
    })
  })

  it('maps control chart schema issues to form fields', () => {
    const result = parseControlChartForm({
      standardId: '12',
      parameter: '',
      chartType: 'xbar_r',
      baselineWindow: '',
      subgroupSize: '4',
    })

    expect(result).toMatchObject({
      success: false,
      message: 'Parâmetro/ponto de medição é obrigatório',
      fieldErrors: [
        {
          field: 'parameter',
          message: 'Parâmetro/ponto de medição é obrigatório',
        },
      ],
    })
  })

  it('builds chart config update payloads', () => {
    const result = parseChartConfigForm({
      chartType: 'xbar_r',
      baselineWindow: '25',
      subgroupSize: '5',
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        chartType: 'xbar_r',
        params: { baselineWindow: 25, subgroupSize: 5 },
      },
    })
  })

  it('builds and validates check-standard reading payloads (happy path)', () => {
    const result = parseReadingForm(12, 'Ponto 100 g', {
      value: '100.003',
      uncertainty: '0.002',
      measuredAt: '2026-07-01T09:30',
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        standardId: 12,
        parameter: 'Ponto 100 g',
        value: 100.003,
        uncertainty: 0.002,
      },
    })
    expect(result.success && result.data.measuredAt).toContain('2026-07-01T')
  })

  it('rejects invalid measurement dates', () => {
    const result = parseReadingForm(12, 'Ponto 100 g', {
      value: '100.003',
      uncertainty: '',
      measuredAt: 'não-é-data',
    })

    expect(result).toMatchObject({
      success: false,
      message: 'Data da medição inválida',
      fieldErrors: [
        { field: 'measuredAt', message: 'Data da medição inválida' },
      ],
    })
  })

  it('rejects readings without a measured value', () => {
    const result = parseReadingForm(12, 'Ponto 100 g', {
      value: '',
      uncertainty: '',
      measuredAt: '2026-07-01T09:30',
    })

    expect(result).toMatchObject({
      success: false,
      message: 'Informe o valor medido',
      fieldErrors: [{ field: 'value', message: 'Informe o valor medido' }],
    })
  })
})
