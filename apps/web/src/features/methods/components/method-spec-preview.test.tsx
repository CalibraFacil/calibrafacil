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

// A truly empty spec — every block degrades to its empty note, no certificate panel.
const emptySpec: MethodSpec = {
  dataFields: [],
  formulas: [],
  validations: [],
  uncertaintyParams: [],
  certificateContent: null,
}

// A GUM measurementModel method (e.g. volume): NO explicit `formulas` — the result
// comes from a measurement model, which must render as its own block.
const measurementModelSpec: MethodSpec = {
  dataFields: [{ key: 'I_L', label: 'Pesagem cheia', type: 'number', unit: 'g' }],
  formulas: [],
  measurementModels: [
    {
      key: 'volume_v0',
      label: 'Volume a 20 °C (V₀)',
      measurand: 'V0',
      expression: '(I_L - I_E) / (rho_w - rho_a)',
      outputUnit: 'mL',
    },
  ],
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
    // A formula-based method has no GUM block.
    expect(screen.queryByText('Modelo de medição (GUM)')).toBeNull()
  })

  it('renders a truly empty spec gracefully (empty notes, no GUM block, no certificate panel)', () => {
    render(<MethodSpecPreview method={emptySpec} />)

    expect(screen.getByText('Nenhum campo de entrada definido.')).toBeTruthy()
    expect(screen.getByText('Nenhuma fórmula definida.')).toBeTruthy()
    expect(screen.getByText('Nenhum critério definido.')).toBeTruthy()
    expect(screen.queryByText('Componentes de incerteza (tipo B)')).toBeNull()
    expect(screen.queryByText('Modelo de medição (GUM)')).toBeNull()
    expect(screen.queryByText('Conteúdo do certificado')).toBeNull()
  })

  it('renders a GUM measurementModel as its own block (not "Nenhuma fórmula definida")', () => {
    render(<MethodSpecPreview method={measurementModelSpec} />)

    expect(screen.getByText('Modelo de medição (GUM)')).toBeTruthy()
    expect(screen.getByText('Volume a 20 °C (V₀)')).toBeTruthy()
    expect(screen.getByText('(I_L - I_E) / (rho_w - rho_a)')).toBeTruthy()
    // formulas empty + a model present → the misleading "Nenhuma fórmula" note is gone.
    expect(screen.queryByText('Nenhuma fórmula definida.')).toBeNull()
    expect(
      screen.getByText(
        'Sem fórmulas explícitas — resultado via modelo de medição (GUM) abaixo.',
      ),
    ).toBeTruthy()
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
