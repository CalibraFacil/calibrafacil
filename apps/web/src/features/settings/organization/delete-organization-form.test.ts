import { describe, expect, it } from 'vitest'

import { parseSoftDeleteOrganizationForm } from './delete-organization-form'

const base = {
  organizationName: 'Laboratório Exemplo',
  confirmName: 'Laboratório Exemplo',
  reason: 'Encerramento das atividades do laboratório',
}

describe('parseSoftDeleteOrganizationForm', () => {
  it('REQ-RET-3: builds the payload once the name is typed and a reason is given', () => {
    expect(
      parseSoftDeleteOrganizationForm({
        ...base,
        confirmName: '  Laboratório Exemplo ',
        reason: '  Encerramento das atividades do laboratório ',
      }),
    ).toEqual({
      ok: true,
      value: {
        confirmName: 'Laboratório Exemplo',
        reason: 'Encerramento das atividades do laboratório',
      },
    })
  })

  it('REQ-RET-3: refuses a confirmation that is not the organization name', () => {
    const result = parseSoftDeleteOrganizationForm({
      ...base,
      confirmName: 'laboratório exemplo',
    })
    expect(result).toEqual({
      ok: false,
      error: 'O nome digitado não confere com o nome da organização',
    })
  })

  it('REQ-RET-3: refuses a missing or too short reason, saying why', () => {
    for (const reason of ['', '   ', 'curto']) {
      const result = parseSoftDeleteOrganizationForm({ ...base, reason })
      expect(result.ok, reason).toBe(false)
      if (!result.ok) {
        expect(result.error, reason).toContain('motivo')
      }
    }
  })
})
