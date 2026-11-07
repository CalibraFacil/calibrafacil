import { describe, expect, it } from 'vitest'

import { draftToMethodSavePayload, methodDataToDraft } from './adapters'

describe('method builder quantityKind adapters', () => {
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
