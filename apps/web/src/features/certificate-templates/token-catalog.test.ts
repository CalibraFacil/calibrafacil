import { describe, expect, it } from 'vitest'

import { XLSX_TOKEN_CATALOG, xlsxTokenGroups } from './token-catalog'

describe('certificate template token catalog', () => {
  it('keeps token paths unique and grouped with an all option', () => {
    const paths = XLSX_TOKEN_CATALOG.map((token) => token.path)

    expect(new Set(paths).size).toBe(paths.length)
    expect(xlsxTokenGroups[0]).toEqual({ value: 'all', label: 'Todos' })
    expect(xlsxTokenGroups).toContainEqual({
      value: 'customer',
      label: 'Cliente',
    })
    expect(xlsxTokenGroups).toContainEqual({
      value: 'tables',
      label: 'Tabelas',
    })
  })

  it('exposes operational certificate tokens used by the route library', () => {
    expect(
      XLSX_TOKEN_CATALOG.find(
        (token) => token.path === 'graphics.eccentricityIndicator',
      ),
    ).toMatchObject({
      group: 'graphics',
      label: 'Indicador de excentricidade',
      kind: 'Imagem',
    })
    expect(
      XLSX_TOKEN_CATALOG.find((token) => token.path === 'uncertaintyBudget'),
    ).toMatchObject({
      group: 'tables',
      kind: 'Lista',
    })
    expect(
      XLSX_TOKEN_CATALOG.find(
        (token) => token.path === 'organization.accreditationSealPng',
      ),
    ).toMatchObject({
      group: 'organization',
      label: 'Selo de acreditação',
      kind: 'Imagem',
    })
  })
})
