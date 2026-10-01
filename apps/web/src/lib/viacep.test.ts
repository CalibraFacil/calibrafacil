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
      neighbourhood: 'Sé',
      city: 'São Paulo',
      state: 'SP',
    })
  })

  it('returns null for ViaCEP not-found responses', () => {
    expect(mapViaCepResponse({ erro: true })).toBeNull()
  })

  it('replaces address fields while normalizing the CEP', () => {
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
        neighbourhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
      },
    )

    expect(merged).toEqual({
      cep: '01001-000',
      street: 'Praça da Sé',
      complement: '',
      neighbourhood: 'Sé',
      city: 'São Paulo',
      state: 'SP',
    })
  })

  it('replaces address fields when the CEP changes', () => {
    const secondLookup = {
      cep: '92200-000',
      street: 'Rua Dois',
      neighbourhood: 'Bairro Dois',
      city: 'Canoas',
      state: 'RS',
    }

    expect(
      mergeViaCepAddress(
        {
          cep: '90000000',
          street: 'Rua Um',
          complement: '',
          neighbourhood: 'Bairro Um',
          city: 'Canoas',
          state: 'RS',
        },
        secondLookup,
      ),
    ).toEqual({
      cep: '92200-000',
      street: 'Rua Dois',
      complement: '',
      neighbourhood: 'Bairro Dois',
      city: 'Canoas',
      state: 'RS',
    })
  })

  it('keeps the user complement when applying ViaCEP data', () => {
    expect(
      mergeViaCepAddress(
        {
          cep: '90000000',
          street: '',
          complement: 'Sala 101',
          neighbourhood: '',
          city: '',
          state: '',
        },
        {
          cep: '90000-000',
          street: 'Rua Exemplo',
          neighbourhood: 'Centro',
          city: 'Porto Alegre',
          state: 'RS',
        },
      ).complement,
    ).toBe('Sala 101')
  })
})
