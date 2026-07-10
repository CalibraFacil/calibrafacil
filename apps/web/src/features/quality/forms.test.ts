import { describe, expect, it } from 'vitest'

import {
  parseCapaForm,
  parseImpactAssessmentForm,
  parseNonConformanceForm,
  type CapaFormData,
  type ImpactAssessmentFormData,
} from './forms'

describe('quality feature forms', () => {
  it('builds and validates non-conformance create payloads', () => {
    const result = parseNonConformanceForm(
      {
        type: 'work',
        description: 'Resultado fora do critério de aceitação',
        jobId: '42',
      },
      new Date('2026-05-20T00:00:00.000Z'),
      '14:35',
    )

    expect(result).toMatchObject({
      success: true,
      data: {
        type: 'work',
        description: 'Resultado fora do critério de aceitação',
        jobId: 42,
      },
    })
    expect(result.success && result.data.detectedAt).toContain('2026-05-20T')
  })

  it('accepts the §7.10 out_of_tolerance non-conformance type', () => {
    const result = parseNonConformanceForm(
      {
        type: 'out_of_tolerance',
        description: 'Resultado como encontrado fora de tolerância',
        jobId: '',
      },
      new Date('2026-05-20T00:00:00.000Z'),
      '10:00',
    )

    expect(result).toMatchObject({
      success: true,
      data: {
        type: 'out_of_tolerance',
        description: 'Resultado como encontrado fora de tolerância',
      },
    })
  })

  it('maps non-conformance schema issues to route form fields', () => {
    const result = parseNonConformanceForm(
      {
        type: 'equipment',
        description: 'curta',
        jobId: '',
      },
      new Date('2026-05-20T00:00:00.000Z'),
      '09:00',
    )

    expect(result).toEqual({
      success: false,
      message: 'Descrição deve ter pelo menos 10 caracteres',
      fieldErrors: [
        {
          field: 'description',
          message: 'Descrição deve ter pelo menos 10 caracteres',
        },
      ],
    })
  })

  it('builds and validates CAPA create payloads', () => {
    const form = validCapaForm()
    const result = parseCapaForm(
      form,
      new Date('2026-05-20T00:00:00.000Z'),
      new Date('2026-06-20T00:00:00.000Z'),
    )

    expect(result).toMatchObject({
      success: true,
      data: {
        title: form.title,
        description: form.description,
        source: 'nc_detection',
        type: 'corrective',
        severity: 'minor',
        category: 'procedure',
        actionPlan: form.actionPlan,
        responsibleId: 'user-1',
      },
    })
  })

  it('maps CAPA schema issues to route form fields', () => {
    const result = parseCapaForm(
      {
        ...validCapaForm(),
        actionPlan: 'curto',
        responsibleId: '',
      },
      new Date('2026-05-20T00:00:00.000Z'),
      new Date('2026-06-20T00:00:00.000Z'),
    )

    expect(result).toMatchObject({
      success: false,
      message: 'Plano de ação deve ter pelo menos 10 caracteres',
      fieldErrors: [
        {
          field: 'actionPlan',
          message: 'Plano de ação deve ter pelo menos 10 caracteres',
        },
        {
          field: 'responsibleId',
          message: 'Responsável é obrigatório',
        },
      ],
    })
  })
  it('builds and validates §7.10 impact assessment payloads', () => {
    const result = parseImpactAssessmentForm({
      ...emptyImpactAssessmentForm(),
      deviationSummary: 'Desvio de +0.02 mm no ponto de 25 mm, como encontrado',
      deviationMagnitude: '0.02',
      customerTolerance: '0.5',
      toleranceUnit: 'mm',
      affectedFrom: '2026-01-05',
      affectedTo: '2026-06-01',
      items: [
        {
          description: 'Lote de blocos padrão classe 1',
          disposition: 'recheck',
          note: 'Reavaliar contra padrão de referência',
        },
        {
          description: 'Medições de rotina em linha',
          disposition: 'no_impact',
          note: '',
        },
      ],
      conclusion: 'no_significant_impact',
      correctiveActionNote: 'Ajuste do padrão de trabalho realizado',
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        deviationSummary:
          'Desvio de +0.02 mm no ponto de 25 mm, como encontrado',
        deviationMagnitude: 0.02,
        customerTolerance: 0.5,
        toleranceUnit: 'mm',
        affectedFrom: '2026-01-05',
        affectedTo: '2026-06-01',
        items: [
          {
            description: 'Lote de blocos padrão classe 1',
            disposition: 'recheck',
            note: 'Reavaliar contra padrão de referência',
          },
          {
            description: 'Medições de rotina em linha',
            disposition: 'no_impact',
          },
        ],
        conclusion: 'no_significant_impact',
        correctiveActionNote: 'Ajuste do padrão de trabalho realizado',
      },
    })
  })

  it('omits optional impact assessment fields left blank', () => {
    const result = parseImpactAssessmentForm({
      ...emptyImpactAssessmentForm(),
      deviationSummary: 'Desvio pontual acima do critério de aceitação',
    })

    expect(result).toMatchObject({ success: true })
    if (result.success) {
      expect(result.data.deviationMagnitude).toBeUndefined()
      expect(result.data.customerTolerance).toBeUndefined()
      expect(result.data.affectedFrom).toBeUndefined()
      expect(result.data.conclusion).toBeUndefined()
      expect(result.data.items).toEqual([])
    }
  })

  it('maps impact assessment schema issues to form fields', () => {
    const result = parseImpactAssessmentForm({
      ...emptyImpactAssessmentForm(),
      deviationSummary: 'curto',
      items: [{ description: 'ab', disposition: 'no_impact', note: '' }],
    })

    expect(result).toMatchObject({
      success: false,
      message: 'Descreva a natureza e magnitude do desvio',
      fieldErrors: [
        {
          field: 'deviationSummary',
          message: 'Descreva a natureza e magnitude do desvio',
        },
        {
          field: 'items',
          message: 'Descreva o item/medição afetada',
        },
      ],
    })
  })
})

function emptyImpactAssessmentForm(): ImpactAssessmentFormData {
  return {
    deviationSummary: '',
    deviationMagnitude: '',
    customerTolerance: '',
    toleranceUnit: '',
    affectedFrom: '',
    affectedTo: '',
    items: [],
    conclusion: '',
    correctiveActionNote: '',
  }
}

function validCapaForm(): CapaFormData {
  return {
    title: 'Ajustar procedimento',
    description: 'Procedimento atual permite execução ambígua',
    source: 'nc_detection',
    sourceReference: '',
    type: 'corrective',
    severity: 'minor',
    category: 'procedure',
    actionPlan: 'Revisar procedimento e treinar equipe técnica',
    responsibleId: 'user-1',
    rootCauseAnalysis: '',
    rootCauseAnalysisMethod: '',
    preventiveMeasures: '',
  }
}
