import { describe, expect, it } from 'vitest'

import {
  isSecondaryRegulationProvenance,
  REGULATION_CATALOG_SECONDARY_CAVEAT,
  regulationCatalogToRegimePatch,
  regulationTechnologyPatch,
  type LegalMetrologyRegulationCatalogEntry,
} from './forms'

// Pure-logic coverage for the regime-form auto-fill from the legal-metrology regulation
// catalog (deferred #3 of #423). REQ-CATALOG-004 (the patch populates the regime fields)
// + REQ-CATALOG-005 (a secondary entry surfaces the DOU caveat).

const TAXIMETRO: LegalMetrologyRegulationCatalogEntry = {
  id: 1,
  category: 'Taxímetros',
  kind: 'fixed_months',
  valueMonths: 24,
  byTechnology: null,
  anchor: 'last_verification',
  operationalizedByDelegate: true,
  regulationReference: 'Portaria Inmetro nº 124, de 24 de março de 2022',
  provenance: 'primary',
  note: null,
}

const BALANCA: LegalMetrologyRegulationCatalogEntry = {
  id: 5,
  category: 'Balanças (IPNA)',
  kind: 'fixed_months',
  valueMonths: 12,
  byTechnology: null,
  anchor: 'calendar_year',
  operationalizedByDelegate: true,
  regulationReference: 'Portaria Inmetro nº 157, de 30 de março de 2022',
  provenance: 'primary',
  note: null,
}

const HIDROMETRO: LegalMetrologyRegulationCatalogEntry = {
  id: 8,
  category: 'Hidrômetros',
  kind: 'max_months_from_install',
  valueMonths: 84,
  byTechnology: null,
  anchor: 'install_year',
  operationalizedByDelegate: true,
  regulationReference: 'Portaria Inmetro nº 155, de 30 de março de 2022',
  provenance: 'secondary',
  note: null,
}

const GAS: LegalMetrologyRegulationCatalogEntry = {
  id: 7,
  category: 'Medidores de gás',
  kind: 'per_technology',
  valueMonths: null,
  byTechnology: { diafragma: 120, ultrassonico: 180, turbina: 60, rotativo: 60 },
  anchor: 'first_verification',
  operationalizedByDelegate: true,
  regulationReference: 'Portaria Inmetro nº 156, de 30 de março de 2022',
  provenance: 'secondary',
  note: null,
}

const ENERGIA: LegalMetrologyRegulationCatalogEntry = {
  id: 9,
  category: 'Medidores de energia elétrica',
  kind: 'not_nationally_fixed',
  valueMonths: null,
  byTechnology: null,
  anchor: null,
  operationalizedByDelegate: false,
  regulationReference:
    'Inmetro: aprovação de modelo + verificação inicial (ANEEL REN 414/2010 é regime distinto)',
  provenance: 'primary',
  note: null,
}

describe('regulationCatalogToRegimePatch — REQ-CATALOG-004', () => {
  it('populates kind, valueMonths, anchor, reference and delegate from a fixed_months entry', () => {
    const patch = regulationCatalogToRegimePatch(TAXIMETRO)
    expect(patch).toMatchObject({
      metrologyRegime: 'LEGAL',
      regulatedKind: 'fixed_months',
      regulatedValueMonths: '24',
      regulatedAnchor: 'last_verification',
      regulationReference: 'Portaria Inmetro nº 124, de 24 de março de 2022',
      regulatedOperationalizedByDelegate: true,
    })
  })

  it('carries the calendar_year anchor for IPNA balances', () => {
    expect(regulationCatalogToRegimePatch(BALANCA).regulatedAnchor).toBe(
      'calendar_year',
    )
  })

  it('populates the install ceiling (max_months_from_install) with its months + anchor', () => {
    const patch = regulationCatalogToRegimePatch(HIDROMETRO)
    expect(patch).toMatchObject({
      regulatedKind: 'max_months_from_install',
      regulatedValueMonths: '84',
      regulatedAnchor: 'install_year',
    })
  })

  it('for per_technology, sets kind/anchor/reference/delegate and clears the technology + months for the lab to pick', () => {
    const patch = regulationCatalogToRegimePatch(GAS)
    expect(patch).toMatchObject({
      regulatedKind: 'per_technology',
      regulatedAnchor: 'first_verification',
      regulationReference: 'Portaria Inmetro nº 156, de 30 de março de 2022',
      regulatedOperationalizedByDelegate: true,
      regulatedTechnology: '',
      regulatedValueMonths: '',
    })
  })

  it('per_technology pick fills the chosen technology and its regulated months', () => {
    expect(regulationTechnologyPatch(GAS, 'diafragma')).toEqual({
      regulatedTechnology: 'diafragma',
      regulatedValueMonths: '120',
    })
    expect(regulationTechnologyPatch(GAS, 'turbina')).toEqual({
      regulatedTechnology: 'turbina',
      regulatedValueMonths: '60',
    })
  })

  it('does not set a scalar months or anchor for not_nationally_fixed (energia elétrica)', () => {
    const patch = regulationCatalogToRegimePatch(ENERGIA)
    expect(patch.regulatedKind).toBe('not_nationally_fixed')
    expect(patch.regulationReference).toContain('ANEEL REN 414/2010')
    expect(patch.regulatedOperationalizedByDelegate).toBe(false)
    expect('regulatedValueMonths' in patch).toBe(false)
    expect('regulatedAnchor' in patch).toBe(false)
  })
})

describe('secondary-provenance caveat — REQ-CATALOG-005', () => {
  it('flags gás + hidrômetro as secondary and the primary rows as not', () => {
    expect(isSecondaryRegulationProvenance(GAS)).toBe(true)
    expect(isSecondaryRegulationProvenance(HIDROMETRO)).toBe(true)
    expect(isSecondaryRegulationProvenance(TAXIMETRO)).toBe(false)
    expect(isSecondaryRegulationProvenance(ENERGIA)).toBe(false)
  })

  it('exposes the verbatim DOU caveat string', () => {
    expect(REGULATION_CATALOG_SECONDARY_CAVEAT).toBe('(verificar artigo no DOU)')
  })
})
