import { describe, expect, it, vi } from 'vitest'

vi.mock('@calibra-facil/math-engine', () => ({
  createCalculationEngine: () => ({
    evaluateFormula: () => {
      throw new Error('math engine is not used by detail model tests')
    },
  }),
  isCalculationEngineError: () => false,
}))

import {
  buildAcceptanceItems,
  buildAdjustmentSummaryRows,
  buildApprovedJobRecordModel,
  buildJobReviewModel,
  buildJobVerdictModel,
  desktopCloudActionError,
  formatDate,
  formatDateTime,
  formatExpandedUncertainty,
  formatReviewValue,
  getFinancialVariant,
  JOB_STATUS_LABELS,
  JOB_STATUS_VARIANTS,
  numberFromUnknown,
  numericValues,
} from './detail-model'

describe('job detail model', () => {
  it('keeps job status labels and badge variants in the feature layer', () => {
    expect(JOB_STATUS_LABELS.APPROVED).toBe('Aprovado')
    expect(JOB_STATUS_VARIANTS.REJECTED).toBe('destructive')
    expect(JOB_STATUS_VARIANTS.GENERATING_PDF).toBe('outline')
  })

  it('formats dates and financial badge variants', () => {
    expect(formatDate(null)).toBe('-')
    expect(formatDate('2026-05-20T10:30:00.000Z')).toContain('20/05/2026')
    expect(formatDateTime('2026-05-20T10:30:00.000Z')).toContain('20/05/2026')
    expect(getFinancialVariant('OVERDUE')).toBe('destructive')
    expect(getFinancialVariant('UNBILLED')).toBe('secondary')
  })

  it('formats review values and numeric coercions', () => {
    expect(formatReviewValue(null, 'g')).toBe('-')
    expect(
      formatReviewValue({
        kind: 'mass_standard_composition',
        targetUnit: 'g',
        label: 'Peso 1 g',
        items: [],
        totals: {
          certifiedValue: 1,
          expandedUncertainty: null,
          maxError: null,
          drift: null,
          buoyancy: null,
        },
        warnings: [],
      }),
    ).toBe('Peso 1 g')
    expect(formatReviewValue(1.25, 'g')).toBe('1.25 g')
    expect(numberFromUnknown('1,25')).toBe(1.25)
    expect(numberFromUnknown('abc')).toBeNull()
    expect(numericValues([[1, '2,5'], 'x', 3])).toEqual([1, 2.5, 3])
  })

  it('builds adjustment summary rows from indication data and results', () => {
    expect(
      buildAdjustmentSummaryRows({
        indicationRows: [
          {
            valor_padrao: '10 g',
            antes_leitura_1: 10.1,
            antes_leitura_2: 10.2,
            antes_leitura_3: 10.3,
            apos_leitura_1: 10,
            apos_leitura_2: 10,
            apos_leitura_3: 10.1,
          },
        ],
        displayReviewResults: {
          erro_indicacao_antes: [0.2],
          erro_indicacao_apos: [0.05],
          margem_conformidade_antes: ['-0,1'],
          margem_conformidade_apos: ['0,2'],
        },
      }),
    ).toEqual([
      {
        key: '0-10 g',
        point: '10 g',
        beforeReadings: [10.1, 10.2, 10.3],
        afterReadings: [10, 10, 10.1],
        beforeError: 0.2,
        afterError: 0.05,
        beforeMargin: -0.1,
        afterMargin: 0.2,
      },
    ])
  })

  it('summarizes acceptance statuses from review validation expressions', () => {
    const items = buildAcceptanceItems({
      validations: [
        {
          leftExpression: 'margem_conformidade_antes',
          operator: '>=',
          rightExpression: '0',
          message: 'Antes dentro da tolerância',
          severity: 'error',
        },
        {
          leftExpression: 'maior_desvio_excentricidade_apos',
          operator: '<=',
          rightExpression: 'tolerancia_maxima',
          message: 'Excentricidade dentro da tolerância',
          severity: 'error',
        },
        {
          leftExpression: 'temperatura',
          operator: '<=',
          rightExpression: 'limite',
          message: 'Temperatura próxima do limite',
          severity: 'warning',
        },
      ],
      displayReviewData: {
        tolerancia_maxima: 0.3,
      },
      displayReviewResults: {
        margem_conformidade_antes: [0.1, 0.2],
        maior_desvio_excentricidade_apos: [0.2, 0.4],
      },
    })

    expect(items).toMatchObject([
      { status: 'ok', message: 'Antes dentro da tolerância' },
      { status: 'error', message: 'Excentricidade dentro da tolerância' },
      { status: 'warning', message: 'Temperatura próxima do limite' },
    ])
  })

  it('builds the review model consumed by the job detail route', () => {
    const model = buildJobReviewModel({
      methodSnapshot: {
        dataFields: [
          {
            key: 'capacity',
            label: 'Capacidade',
            type: 'number',
            source: 'asset_spec',
            assetSpecKey: 'capacity',
            unit: 'g',
          },
          {
            key: 'pontos_indicacao',
            label: 'Pontos de indicação',
            type: 'table',
            columns: [
              { key: 'valor_padrao', label: 'Padrão', type: 'number' },
              { key: 'antes_leitura_1', label: 'Antes 1', type: 'number' },
              { key: 'apos_leitura_1', label: 'Após 1', type: 'number' },
            ],
          },
          {
            key: 'operador',
            label: 'Operador',
            type: 'text',
          },
        ],
        formulas: [
          { outputKey: 'resultado_auxiliar', label: 'Auxiliar' },
          { outputKey: 'erro_indicacao_antes', label: 'Erro antes' },
        ],
        validations: [
          {
            leftExpression: 'margem_conformidade_antes',
            operator: '>=',
            rightExpression: '0',
            message: 'Margem antes',
            severity: 'error',
          },
        ],
      },
      assetSnapshot: {
        specifications: { capacity: 1000 },
      },
      standardsSnapshot: [
        {
          id: 1,
          name: 'Peso padrão',
          certificateNumber: 'CERT',
          calibrationDate: '2026-01-01',
          uncertainty: null,
          uncertaintyUnit: null,
          coverageFactor: 2,
        },
      ],
      data: {
        operador: 'Ana',
        pontos_indicacao: [
          {
            valor_padrao: 10,
            antes_leitura_1: 10.1,
            apos_leitura_1: 10,
          },
        ],
      },
      results: {
        margem_conformidade_antes: [0.1],
        erro_indicacao_antes: [0.2],
        resultado_auxiliar: 5,
      },
      environmentalSnapshot: { withinLimits: false },
    })

    expect(model.reviewHasData).toBe(true)
    expect(model.reviewHasResults).toBe(true)
    expect(model.criticalReviewFields.map((field) => field.key)).toEqual([
      'pontos_indicacao',
    ])
    expect(model.reviewContextItems).toEqual([
      { key: 'capacity', label: 'Capacidade', value: '1000 g' },
      { key: 'operador', label: 'Operador', value: 'Ana' },
    ])
    expect(
      model.orderedReviewFormulas.map((formula) => formula.outputKey),
    ).toEqual(['erro_indicacao_antes', 'resultado_auxiliar'])
    expect(model.adjustmentSummaryRows[0]).toMatchObject({
      point: 10,
      beforeError: 0.2,
      beforeMargin: 0.1,
    })
    expect(model.quickAlertItems).toEqual([
      expect.objectContaining({ status: 'ok', message: 'Margem antes' }),
      expect.objectContaining({
        key: 'environmental-limits',
        status: 'warning',
      }),
    ])
    expect(model.reviewStandards).toHaveLength(1)
  })

  it('builds the approved record model consumed by the approved job component', () => {
    const model = buildApprovedJobRecordModel({
      id: 7,
      jobId: 'JOB-7',
      status: 'APPROVED',
      customerName: 'Cliente',
      assetName: 'Balança',
      assetTag: 'BAL-1',
      serviceName: 'Calibração',
      methodSnapshot: {
        methodId: 1,
        methodName: 'Massa',
        methodVersion: 3,
        dataFields: [
          {
            key: 'capacity',
            label: 'Capacidade',
            type: 'number',
            source: 'asset_spec',
            assetSpecKey: 'capacity',
            unit: 'g',
          },
          {
            key: 'pontos_indicacao',
            label: 'Pontos de indicação',
            type: 'table',
          },
          {
            key: 'observacoes',
            label: 'Observações',
            type: 'text',
          },
          {
            key: 'leituras_auxiliares',
            label: 'Leituras auxiliares',
            type: 'table',
          },
        ],
        formulas: [{ outputKey: 'erro', label: 'Erro', unit: 'g' }],
        validations: [
          {
            leftExpression: 'erro',
            operator: '<=',
            rightExpression: 'tolerancia',
            message: 'Erro dentro da tolerância',
            severity: 'error',
          },
        ],
      },
      data: {
        observacoes: 'Sem ressalvas',
        pontos_indicacao: [{ valor_padrao: 10 }],
        leituras_auxiliares: [{ leitura: 1 }],
      },
      results: { erro: 0.01 },
      standardsSnapshot: [],
      assetSnapshot: {
        baseMeasurementUnit: 'g',
        specifications: { capacity: 220 },
      },
      technicianName: 'Técnica',
      approvedBy: 'approver-1',
      approverName: 'Aprovadora',
      approvedAt: '2026-05-20T10:00:00.000Z',
      performedAt: '2026-05-20T09:00:00.000Z',
      createdAt: '2026-05-19T10:00:00.000Z',
    })

    expect(model.approvedContextItems).toEqual([
      { key: 'capacity', label: 'Capacidade', value: '220 g' },
      { key: 'observacoes', label: 'Observações', value: 'Sem ressalvas' },
      expect.objectContaining({ key: 'createdAt', label: 'Criado' }),
      expect.objectContaining({ key: 'performedAt', label: 'Executado' }),
      expect.objectContaining({ key: 'approvedAt', label: 'Aprovado' }),
    ])
    expect(model.measurementFields.map((field) => field.key)).toEqual([
      'pontos_indicacao',
    ])
    expect(model.displayResults?.erro).toBe(0.01)
    expect(model.validations).toEqual([
      expect.objectContaining({ message: 'Erro dentro da tolerância' }),
    ])
  })

  it('formats the worst-case expanded uncertainty from stored results', () => {
    expect(
      formatExpandedUncertainty(
        { incerteza_expandida_apos: [0.4, '0,9', -0.2] },
        [{ outputKey: 'incerteza_expandida_apos', unit: 'mg' }],
        () => 'mg',
      ),
    ).toBe('±0.9 mg')
    expect(
      formatExpandedUncertainty(
        { incerteza_expandida_antes: [1.5] },
        [{ outputKey: 'incerteza_expandida_antes' }],
        () => undefined,
      ),
    ).toBe('±1.5')
    expect(formatExpandedUncertainty({}, [], () => undefined)).toBeNull()
  })

  it('derives the approval verdict from criteria and tolerance margins', () => {
    const row = (afterMargin: number | null, beforeMargin: number | null) => ({
      key: `${afterMargin}-${beforeMargin}`,
      point: 10,
      beforeReadings: [],
      afterReadings: [],
      beforeError: null,
      afterError: null,
      beforeMargin,
      afterMargin,
    })
    const base = {
      acceptanceItems: [],
      adjustmentSummaryRows: [row(0.2, 0.1), row(0.05, -0.3)],
      reviewHasData: true,
      reviewHasResults: true,
      standardsCount: 2,
      environmentWithinLimits: true,
      expandedUncertainty: '±0.02 g',
    }

    const conforme = buildJobVerdictModel(base)
    expect(conforme.level).toBe('conforme')
    expect(conforme.pointsTotal).toBe(2)
    expect(conforme.pointsWithin).toBe(2)

    expect(
      buildJobVerdictModel({ ...base, reviewHasResults: false }).level,
    ).toBe('incompleto')
    expect(
      buildJobVerdictModel({
        ...base,
        adjustmentSummaryRows: [row(-0.1, 0.2)],
      }).level,
    ).toBe('nao_conforme')
    expect(
      buildJobVerdictModel({
        ...base,
        acceptanceItems: [
          {
            key: 'c1',
            message: 'critério reprovado',
            severity: 'error',
            status: 'error',
          },
        ],
      }).level,
    ).toBe('nao_conforme')
    expect(
      buildJobVerdictModel({ ...base, environmentWithinLimits: false }).level,
    ).toBe('atencao')
  })

  it('keeps the desktop cloud-action error message centralized', () => {
    expect(desktopCloudActionError().message).toContain(
      'Esta ação exige validação online',
    )
  })
})
