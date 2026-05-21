import { describe, expect, it } from 'vitest'

import { parseCompetenceRequestForm } from './forms'

describe('personnel feature forms', () => {
  it('builds competence request payloads', () => {
    const result = parseCompetenceRequestForm({
      userId: 'user-1',
      assetTypeId: '12',
      scopeDescription: '  Calibracao de massas  ',
    })

    expect(result).toEqual({
      success: true,
      data: {
        userId: 'user-1',
        assetTypeId: 12,
        scopeDescription: 'Calibracao de massas',
      },
    })
  })

  it('maps shared schema issues to form errors', () => {
    const result = parseCompetenceRequestForm({
      userId: '',
      assetTypeId: '',
      scopeDescription: 'abc',
    })

    expect(result).toEqual({
      success: false,
      message: 'Técnico é obrigatório',
      fieldErrors: [
        { field: 'userId', message: 'Selecione um técnico' },
        {
          field: 'scopeDescription',
          message: 'Descrição do escopo deve ter pelo menos 5 caracteres',
        },
      ],
    })
  })
})
