import { describe, expect, it } from 'vitest'

import {
  draftToEngineMethodDraft,
  draftToMethodSavePayload,
  methodDataToDraft,
} from './adapters'
import type { MethodDraft, MethodDraftInput } from './types'

function makeDraft(inputs: Array<MethodDraftInput>): MethodDraft {
  return {
    name: 'Method',
    version: 1,
    status: 'DRAFT',
    inputs,
    variables: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertainty: [],
    certificate: { referenceStandards: [], sections: [] },
  }
}

describe('method builder quantityKind adapters', () => {
  it('passes a scalar field quantityKind through to the engine draft', () => {
    const engine = draftToEngineMethodDraft(
      makeDraft([
        {
          key: 'u_padrao',
          label: 'Incerteza padrão',
          type: 'number',
          unit: '°C',
          quantityKind: 'uncertainty',
        },
      ]),
    )

    expect(engine.inputs[0]).toMatchObject({
      kind: 'scalar',
      key: 'u_padrao',
      quantityKind: 'uncertainty',
    })
  })

  it("defaults an unmarked scalar field to 'other'", () => {
    const engine = draftToEngineMethodDraft(
      makeDraft([{ key: 'leitura', label: 'Leitura', type: 'number' }]),
    )

    expect(engine.inputs[0]).toMatchObject({ quantityKind: 'other' })
  })

  it('passes a table column quantityKind through to the engine draft', () => {
    const engine = draftToEngineMethodDraft(
      makeDraft([
        {
          key: 'pontos',
          label: 'Pontos',
          type: 'table',
          columns: [
            { key: 'indicacao', label: 'Indicação', type: 'number' },
            {
              key: 'resolucao',
              label: 'Resolução',
              type: 'number',
              quantityKind: 'resolution',
            },
          ],
        },
      ]),
    )

    expect(engine.inputs[0]).toMatchObject({
      kind: 'table',
      columns: [
        { key: 'indicacao' },
        { key: 'resolucao', quantityKind: 'resolution' },
      ],
    })
  })

  it('round-trips quantityKind through load and save', () => {
    const draft = methodDataToDraft({
      name: 'Termômetro',
      dataFields: [
        {
          key: 'u_padrao',
          label: 'Incerteza padrão',
          type: 'number',
          unit: '°C',
          quantityKind: 'uncertainty',
        },
      ],
    })
    expect(draft.inputs[0]?.quantityKind).toBe('uncertainty')

    const payload = draftToMethodSavePayload(draft)
    expect(payload.dataFields[0]?.quantityKind).toBe('uncertainty')
  })
})
