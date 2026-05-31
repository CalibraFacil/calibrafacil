import { describe, expect, it } from 'vitest'

import {
  parseCapaForm,
  parseNonConformanceForm,
  type CapaFormData,
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
})

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
