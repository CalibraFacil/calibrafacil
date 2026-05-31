import { describe, expect, it } from 'vitest'

import { getProviderCapabilities } from '@calibra-facil/shared'

import { getContaAzulCapabilityChips } from './conta-azul-constants'

describe('Conta Azul capability chips', () => {
  it('derives connected-provider chips from the readiness capabilities payload', () => {
    expect(
      getContaAzulCapabilityChips(getProviderCapabilities('conta_azul')).map(
        ({ label, value }) => ({ label, value }),
      ),
    ).toEqual([
      { label: 'Recebíveis', value: 'Enviar e acompanhar' },
      { label: 'Documentos fiscais', value: 'Consulta' },
      { label: 'Atualização', value: 'Polling, sem webhooks' },
      { label: 'Categorias', value: 'Suportado' },
      { label: 'Centros de custo', value: 'Suportado' },
    ])
  })
})
