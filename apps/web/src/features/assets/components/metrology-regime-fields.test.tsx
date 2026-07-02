// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LegalMetrologyRegulationCatalogEntry } from '@/features/assets/forms'
import type { MetrologyRegimeFormValues } from '@/features/assets/forms'

// The GLOBAL legal-metrology regulation catalog the regime form auto-fills from
// (deferred #3 of #423). We stub the network hook + the Radix Select shell (the repo's
// established pattern — see nc-new-route.test.tsx), then render the REAL component so the
// auto-fill patch + the secondary DOU caveat are exercised against real rendered output.

const CATALOG: LegalMetrologyRegulationCatalogEntry[] = [
  {
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
  },
  {
    id: 7,
    category: 'Medidores de gás',
    kind: 'per_technology',
    valueMonths: null,
    byTechnology: {
      diafragma: 120,
      ultrassonico: 180,
      turbina: 60,
      rotativo: 60,
    },
    anchor: 'first_verification',
    operationalizedByDelegate: true,
    regulationReference: 'Portaria Inmetro nº 156, de 30 de março de 2022',
    provenance: 'secondary',
    note: null,
  },
  {
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
  },
]

const queryMocks = vi.hoisted(() => {
  const state: { data: LegalMetrologyRegulationCatalogEntry[] | undefined } = {
    data: undefined,
  }
  return state
})

vi.mock('@/features/assets/queries', () => ({
  useLegalMetrologyRegulationsData: () => ({ data: queryMocks.data }),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string
    onValueChange?: (value: string) => void
    children: ReactNode
  }) => (
    <select
      value={value ?? ''}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: (_props: { children: ReactNode }) => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

import { MetrologyRegimeFields } from './metrology-regime-fields'

const INITIAL: MetrologyRegimeFormValues = {
  metrologyRegime: 'LEGAL',
  regulatedKind: 'fixed_months',
  regulatedValueMonths: '',
  regulatedAnchor: 'last_verification',
  regulationReference: '',
  regulatedOperationalizedByDelegate: false,
  regulatedTechnology: '',
  regulatedNote: '',
}

/** Stateful harness so an onChange patch is actually merged back into the rendered form. */
function Harness({
  onPatch,
}: {
  onPatch: (patch: Partial<MetrologyRegimeFormValues>) => void
}) {
  const [values, setValues] = useState<MetrologyRegimeFormValues>(INITIAL)
  return (
    <MetrologyRegimeFields
      values={values}
      onChange={(patch) => {
        onPatch(patch)
        setValues((current) => ({ ...current, ...patch }))
      }}
    />
  )
}

function selectContaining(optionName: string): HTMLSelectElement {
  const option = screen.getByRole('option', { name: optionName })
  const select = option.closest('select')
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`no <select> owns option "${optionName}"`)
  }
  return select
}

afterEach(() => cleanup())

describe('MetrologyRegimeFields — regulation catalog auto-fill', () => {
  it('REQ-CATALOG-004: selecting a fixed-months regulation patches the regime fields', () => {
    queryMocks.data = CATALOG
    const onPatch = vi.fn()
    render(<Harness onPatch={onPatch} />)

    fireEvent.change(selectContaining('Taxímetros'), { target: { value: '1' } })

    expect(onPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        metrologyRegime: 'LEGAL',
        regulatedKind: 'fixed_months',
        regulatedValueMonths: '24',
        regulatedAnchor: 'last_verification',
        regulationReference: 'Portaria Inmetro nº 124, de 24 de março de 2022',
        regulatedOperationalizedByDelegate: true,
      }),
    )

    // The patched reference is reflected in the (still-editable) input.
    const reference = screen.getByLabelText('Referência do regulamento')
    if (!(reference instanceof HTMLInputElement)) throw new Error('no input')
    expect(reference.value).toBe(
      'Portaria Inmetro nº 124, de 24 de março de 2022',
    )
    // A PRIMARY entry shows no DOU caveat.
    expect(screen.queryByText('(verificar artigo no DOU)')).toBeNull()
  })

  it('REQ-CATALOG-005: a secondary entry (gás) surfaces the DOU caveat + the per-technology picker', () => {
    queryMocks.data = CATALOG
    const onPatch = vi.fn()
    render(<Harness onPatch={onPatch} />)

    fireEvent.change(selectContaining('Medidores de gás'), {
      target: { value: '7' },
    })

    // REQ-CATALOG-005: the secondary caveat is rendered next to the reference.
    expect(screen.getByText('(verificar artigo no DOU)')).toBeTruthy()

    // REQ-CATALOG-004 (per_technology): the byTechnology picker lets the lab choose a
    // technology, which fills technology + its regulated months.
    fireEvent.change(selectContaining('diafragma — 120 meses'), {
      target: { value: 'diafragma' },
    })
    expect(onPatch).toHaveBeenCalledWith({
      regulatedTechnology: 'diafragma',
      regulatedValueMonths: '120',
    })
  })

  it('renders no catalog picker when the catalog is empty', () => {
    queryMocks.data = []
    render(<Harness onPatch={vi.fn()} />)
    expect(screen.queryByText('Regulamento (catálogo)')).toBeNull()
  })
})

describe('MetrologyRegimeFields — catalog scoped by asset type', () => {
  it('a mapped asset type (balança) only sees its own regulation category', () => {
    queryMocks.data = CATALOG
    render(
      <MetrologyRegimeFields
        values={INITIAL}
        onChange={vi.fn()}
        assetTypeSlug="balanca-digital"
      />,
    )

    expect(screen.getByRole('option', { name: 'Balanças (IPNA)' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Taxímetros' })).toBeNull()
    expect(
      screen.queryByRole('option', { name: 'Medidores de gás' }),
    ).toBeNull()
  })

  it('medidor-gas only sees the gás regulation', () => {
    queryMocks.data = CATALOG
    render(
      <MetrologyRegimeFields
        values={INITIAL}
        onChange={vi.fn()}
        assetTypeSlug="medidor-gas"
      />,
    )

    expect(
      screen.getByRole('option', { name: 'Medidores de gás' }),
    ).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Taxímetros' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Balanças (IPNA)' })).toBeNull()
  })

  it('an unmapped asset type sees the full catalog (suggestion-only design)', () => {
    queryMocks.data = CATALOG
    render(
      <MetrologyRegimeFields
        values={INITIAL}
        onChange={vi.fn()}
        assetTypeSlug="paquimetro"
      />,
    )

    expect(screen.getByRole('option', { name: 'Taxímetros' })).toBeTruthy()
    expect(
      screen.getByRole('option', { name: 'Medidores de gás' }),
    ).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Balanças (IPNA)' })).toBeTruthy()
  })

  it('no asset type selected → full catalog', () => {
    queryMocks.data = CATALOG
    render(<MetrologyRegimeFields values={INITIAL} onChange={vi.fn()} />)

    expect(screen.getByRole('option', { name: 'Taxímetros' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Balanças (IPNA)' })).toBeTruthy()
  })
})

describe('MetrologyRegimeFields — inline regulated-field errors', () => {
  // The flat lab-form fields are validated against RegulatedIntervalSchema in parseAssetForm;
  // each issue is mapped to a regulated field key (regulationReference / regulatedValueMonths /
  // regulatedTechnology / regulatedAnchor). REQ-POLISH-001: those field-keyed messages must be
  // surfaced inline, next to the offending field, not only as a form-level banner.
  const REGULATED_ERRORS = {
    regulationReference: 'A referência do regulamento (Portaria) é obrigatória',
    regulatedValueMonths: 'A periodicidade deve ser de no máximo 600 meses',
    regulatedAnchor: 'Âncora da contagem inválida',
    regulatedTechnology: 'A tecnologia do instrumento é obrigatória',
  } as const

  it('REQ-POLISH-001: renders an inline error for every regulated field that has one', () => {
    queryMocks.data = []
    render(
      <MetrologyRegimeFields
        values={{ ...INITIAL, regulatedKind: 'per_technology' }}
        onChange={vi.fn()}
        errors={REGULATED_ERRORS}
      />,
    )

    // Each field's message is rendered (per_technology renders all four fields).
    expect(screen.getByText(REGULATED_ERRORS.regulationReference)).toBeTruthy()
    expect(screen.getByText(REGULATED_ERRORS.regulatedValueMonths)).toBeTruthy()
    expect(screen.getByText(REGULATED_ERRORS.regulatedAnchor)).toBeTruthy()
    expect(screen.getByText(REGULATED_ERRORS.regulatedTechnology)).toBeTruthy()
  })

  it('REQ-POLISH-001: renders only the errors that are present', () => {
    queryMocks.data = []
    render(
      <MetrologyRegimeFields
        values={{ ...INITIAL, regulatedKind: 'per_technology' }}
        onChange={vi.fn()}
        errors={{ regulationReference: REGULATED_ERRORS.regulationReference }}
      />,
    )

    expect(screen.getByText(REGULATED_ERRORS.regulationReference)).toBeTruthy()
    expect(screen.queryByText(REGULATED_ERRORS.regulatedValueMonths)).toBeNull()
    expect(screen.queryByText(REGULATED_ERRORS.regulatedTechnology)).toBeNull()
  })

  it('REQ-POLISH-001: renders no error node when no errors are passed', () => {
    queryMocks.data = []
    render(
      <MetrologyRegimeFields
        values={{ ...INITIAL, regulatedKind: 'per_technology' }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
