import { describe, expect, it } from 'vitest'

import {
  contaAzulAppSavedMessage,
  contaAzulOAuthErrorMessage,
  parseContaAzulAppDraft,
} from './conta-azul-app-form'

describe('parseContaAzulAppDraft', () => {
  it('returns the trimmed credentials', () => {
    expect(
      parseContaAzulAppDraft({
        clientId: ' 4mh1k2client ',
        clientSecret: ' secret-value ',
      }),
    ).toEqual({
      ok: true,
      value: { clientId: '4mh1k2client', clientSecret: 'secret-value' },
    })
  })

  it('puts each problem next to its field', () => {
    expect(
      parseContaAzulAppDraft({ clientId: '', clientSecret: 'a b' }),
    ).toEqual({
      ok: false,
      errors: {
        clientId: 'Informe o Client ID.',
        clientSecret: 'O Client Secret não tem espaços.',
      },
    })
  })
})

describe('Conta Azul application messages', () => {
  it('says whether Conta Azul confirmed the pair', () => {
    expect(contaAzulAppSavedMessage('accepted')).toBe(
      'Aplicativo salvo e confirmado pelo Conta Azul.',
    )
    expect(contaAzulAppSavedMessage('unverified')).toMatch(
      /^Aplicativo salvo\. O Conta Azul não respondeu/,
    )
  })

  it('explains every callback failure and falls back for unknown ones', () => {
    expect(contaAzulOAuthErrorMessage('exchange_failed')).toMatch(
      /URL de redirecionamento/,
    )
    expect(contaAzulOAuthErrorMessage('app_missing')).toMatch(/Client ID/)
    expect(contaAzulOAuthErrorMessage('invalid_state')).toMatch(/expirou/)
    expect(contaAzulOAuthErrorMessage(null)).toBe(
      'Não foi possível conectar o Conta Azul. Tente de novo.',
    )
  })
})
