// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import {
  MethodSpecCounts,
  MethodSpecPreview,
  type MethodSpec,
} from './method-spec-preview'

afterEach(cleanup)

// A formula-based method (e.g. weighing): every block populated + certificate.
const formulaSpec: MethodSpec = {
  dataFields: [
    {
      key: 'm_ref',
      label: 'Massa de referência',
      type: 'number',
      unit: 'g',
      required: true,
    },
  ],
  formulas: [
    {
      outputKey: 'erro',
      label: 'Erro de indicação',
      expression: 'indicacao - m_ref',
      unit: 'g',
      reporting: { role: 'primary_result' },
    },
  ],
  validations: [
    {
      leftExpression: 'abs(erro)',
      operator: '<=',
      rightExpression: 'tolerancia',
      message: 'Fora da tolerância',
      severity: 'error',
    },
  ],
  uncertaintyParams: [
    {
      name: 'u_resolucao',
      value: 0.01,
      distribution: 'rectangular',
      degreesOfFreedom: 50,
    },
  ],
  certificateContent: {
    procedureCode: 'POP-001',
    referenceStandards: ['EURAMET cg-18'],
    sections: [{ kind: 'bullets', items: ['nota'] }],
  },
}

// A method whose result comes from a GUM measurementModel (e.g. volume) has NO
// `formulas`; this component does not render measurementModels, so it must degrade
// gracefully (empty notes, no crash) rather than imply the spec is empty/broken.
const measurementModelOnlySpec: MethodSpec = {
  dataFields: [],
  formulas: [],
  validations: [],
  uncertaintyParams: [],
  certificateContent: null,
}

describe('MethodSpecPreview', () => {
  it('renders a formula-based spec: fields, formulas, criteria, uncertainty, certificate', () => {
    render(<MethodSpecPreview method={formulaSpec} />)

    expect(screen.getByText('Campos de entrada')).toBeTruthy()
    expect(screen.getByText('Massa de referência')).toBeTruthy()
    expect(screen.getByText('Fórmulas')).toBeTruthy()
    expect(screen.getByText('Erro de indicação')).toBeTruthy()
    expect(screen.getByText('indicacao - m_ref')).toBeTruthy()
    expect(screen.getByText('Critérios de aceitação')).toBeTruthy()
    expect(screen.getByText('Componentes de incerteza (tipo B)')).toBeTruthy()
    expect(screen.getByText('Conteúdo do certificado')).toBeTruthy()
    expect(screen.getByText('POP-001')).toBeTruthy()
  })

  it('renders a measurementModel-only / empty spec gracefully (empty notes, no certificate panel)', () => {
    render(<MethodSpecPreview method={measurementModelOnlySpec} />)

    expect(screen.getByText('Nenhum campo de entrada definido.')).toBeTruthy()
    expect(screen.getByText('Nenhuma fórmula definida.')).toBeTruthy()
    expect(screen.getByText('Nenhum critério definido.')).toBeTruthy()
    // The type-B block is omitted entirely when there are no components.
    expect(screen.queryByText('Componentes de incerteza (tipo B)')).toBeNull()
    // The certificate panel is hidden when there is no certificate content.
    expect(screen.queryByText('Conteúdo do certificado')).toBeNull()
  })
})

describe('MethodSpecCounts', () => {
  it('renders the four count tiles', () => {
    render(<MethodSpecCounts method={formulaSpec} />)

    expect(screen.getByText('Campos')).toBeTruthy()
    expect(screen.getByText('Fórmulas')).toBeTruthy()
    expect(screen.getByText('Critérios')).toBeTruthy()
    expect(screen.getByText('Incerteza B')).toBeTruthy()
  })
})
