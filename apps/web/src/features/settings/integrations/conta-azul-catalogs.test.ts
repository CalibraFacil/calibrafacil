import { describe, expect, it } from 'vitest'

import { formatCatalogItemLabel } from './conta-azul-catalogs'

const item = {
  id: 'service-1',
  name: 'Calibração',
  code: 'SRV-1',
  active: true,
  metadata: { type: 'PRESTADO' },
}

describe('formatCatalogItemLabel', () => {
  it('shows the kind Conta Azul reports in the item metadata', () => {
    expect(formatCatalogItemLabel(item)).toBe('SRV-1 · Calibração · PRESTADO')
  })

  it('marks an inactive item and leaves out the kind of an item without one', () => {
    expect(formatCatalogItemLabel({ ...item, active: false })).toBe(
      'SRV-1 · Calibração · inativo',
    )
    expect(
      formatCatalogItemLabel({ ...item, code: null, metadata: null }),
    ).toBe('Calibração')
  })
})
