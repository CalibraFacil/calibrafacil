import { describe, expect, it } from 'vitest'

import { getCepDigits, mapViaCepResponse, mergeViaCepAddress } from './viacep'

describe('ViaCEP helpers', () => {
  it('keeps only CEP digits', () => {
    expect(getCepDigits('01001-000')).toBe('01001000')
    expect(getCepDigits(' 01.001 000 ')).toBe('01001000')
  })

  it('maps a ViaCEP response to customer address fields', () => {
    expect(
      mapViaCepResponse({
        cep: '01001-000',
        logradouro: 'Praça da Sé',
        complemento: 'lado ímpar',
        bairro: 'Sé',
        localidade: 'São Paulo',
        uf: 'SP',
      }),
    ).toEqual({
      cep: '01001-000',
      street: 'Praça da Sé',
      complement: 'lado ímpar',
      neighbourhood: 'Sé',
      city: 'São Paulo',
      state: 'SP',
    })
  })

  it('returns null for ViaCEP not-found responses', () => {
    expect(mapViaCepResponse({ erro: true })).toBeNull()
  })

  it('fills only empty address fields while normalizing the CEP', () => {
    const merged = mergeViaCepAddress(
      {
        cep: '01001000',
        street: 'Rua digitada manualmente',
        complement: '',
        neighbourhood: '',
        city: 'Cidade manual',
        state: '',
      },
      {
        cep: '01001-000',
        street: 'Praça da Sé',
        complement: 'lado ímpar',
        neighbourhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
      },
    )

    expect(merged).toEqual({
      cep: '01001-000',
      street: 'Rua digitada manualmente',
      complement: 'lado ímpar',
      neighbourhood: 'Sé',
      city: 'Cidade manual',
      state: 'SP',
    })
  })
})
