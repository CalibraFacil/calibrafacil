import { describe, expect, it } from 'vitest'

import {
  addDraftCertificateSection,
  addDraftInput,
  addDraftMeasurementModel,
  addDraftVariable,
  firstNumericSource,
  removeDraftCertificateSection,
  setDraftInputType,
  updateDraftCertificateSection,
} from './draft-operations'
import type { MethodDraft } from './types'

function makeDraft(patch: Partial<MethodDraft> = {}): MethodDraft {
  return {
    name: 'Method',
    version: 1,
    status: 'DRAFT',
    inputs: [],
    variables: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertainty: [],
    certificate: {
      referenceStandards: [],
      sections: [],
    },
    ...patch,
  }
}

describe('method builder draft operations', () => {
  it('adds draft inputs with stable generated keys', () => {
    const draft = makeDraft({
      inputs: [{ key: 'measurement', label: 'Medição', type: 'number' }],
    })

    const nextDraft = addDraftInput(draft)

    expect(nextDraft.inputs).toHaveLength(2)
    expect(nextDraft.inputs[1]).toMatchObject({
      key: 'input_2',
      label: 'Novo campo',
      type: 'number',
      required: false,
    })
    expect(draft.inputs).toHaveLength(1)
  })

  it('converts inputs to table fields with a default numeric column', () => {
    const draft = makeDraft({
      inputs: [
        {
          key: 'load',
          label: 'Carga',
          type: 'number',
          source: 'asset_spec',
          assetSpecKey: 'capacity',
          allowOverride: true,
        },
      ],
    })

    const nextDraft = setDraftInputType(draft, 0, 'table')

    expect(nextDraft.inputs[0]).toMatchObject({
      key: 'load',
      label: 'Carga',
      type: 'table',
      source: 'manual',
      columns: [{ key: 'value', label: 'Valor', type: 'number' }],
    })
    expect(nextDraft.inputs[0]?.assetSpecKey).toBeUndefined()
    expect(nextDraft.inputs[0]?.allowOverride).toBeUndefined()
  })

  it('keeps quantityKind on number fields and clears it when leaving number', () => {
    const draft = makeDraft({
      inputs: [
        {
          key: 'u_padrao',
          label: 'Incerteza padrão',
          type: 'number',
          unit: '°C',
          quantityKind: 'uncertainty',
        },
      ],
    })

    // number -> number-ish edit keeps it; switching to text clears it.
    expect(setDraftInputType(draft, 0, 'number').inputs[0]?.quantityKind).toBe(
      'uncertainty',
    )
    expect(
      setDraftInputType(draft, 0, 'text').inputs[0]?.quantityKind,
    ).toBeUndefined()
    expect(
      setDraftInputType(draft, 0, 'table').inputs[0]?.quantityKind,
    ).toBeUndefined()
  })

  it('adds variables bound to the first available input', () => {
    const draft = makeDraft({
      inputs: [{ key: 'measurement', label: 'Medição', type: 'number' }],
    })

    expect(addDraftVariable(draft).variables[0]).toMatchObject({
      key: 'var_1',
      source: 'data_field',
      fieldKey: 'measurement',
    })
  })

  it('prefers the selected table numeric column for new measurement models', () => {
    const draft = makeDraft({
      inputs: [
        {
          key: 'readings',
          label: 'Leituras',
          type: 'table',
          columns: [
            { key: 'point', label: 'Ponto', type: 'text' },
            { key: 'value', label: 'Valor', type: 'number' },
          ],
        },
      ],
    })

    const nextDraft = addDraftMeasurementModel(draft)

    expect(nextDraft.measurementModels[0]).toMatchObject({
      key: 'gum_model_1',
      scope: { kind: 'table_row', tableKey: 'readings' },
      quantities: [
        {
          symbol: 'y',
          source: {
            kind: 'table_column',
            tableKey: 'readings',
            columnKey: 'value',
          },
        },
      ],
    })
  })

  it('falls back to formulas, scalar inputs, and constants for numeric sources', () => {
    expect(
      firstNumericSource(
        [],
        [{ outputKey: 'result', expression: 'x', scope: { kind: 'scalar' } }],
      ),
    ).toEqual({ kind: 'formula', key: 'result' })

    expect(
      firstNumericSource([{ key: 'x', label: 'X', type: 'number' }], []),
    ).toEqual({ kind: 'input', key: 'x' })

    expect(firstNumericSource([], [])).toEqual({ kind: 'constant', value: 0 })
  })

  it('adds, updates, and removes certificate sections without mutating input', () => {
    const draft = makeDraft()
    const withSection = addDraftCertificateSection(draft)
    const updated = updateDraftCertificateSection(withSection, 0, {
      kind: 'bullets',
      title: 'Notas',
      items: ['Item'],
    })
    const removed = removeDraftCertificateSection(updated, 0)

    expect(withSection.certificate?.sections).toEqual([
      { kind: 'paragraphs', title: 'Seção', paragraphs: [''] },
    ])
    expect(updated.certificate?.sections).toEqual([
      { kind: 'bullets', title: 'Notas', items: ['Item'] },
    ])
    expect(removed.certificate?.sections).toEqual([])
    expect(draft.certificate?.sections).toEqual([])
  })
})
