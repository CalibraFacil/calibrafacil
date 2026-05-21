import { describe, expect, it } from 'vitest'

import {
  buildJobApprovalInput,
  isJobApprovalBlockedByEnvironment,
} from './approval-model'

describe('job approval model', () => {
  it('builds the certificate issuance approval payload', () => {
    expect(
      buildJobApprovalInput('  Condicoes aceitas pelo responsavel  '),
    ).toEqual({
      reason: 'Aprovado',
      environmentalJustification: 'Condicoes aceitas pelo responsavel',
    })
    expect(buildJobApprovalInput('   ')).toEqual({
      reason: 'Aprovado',
      environmentalJustification: undefined,
    })
  })

  it('requires an environmental justification before approval when limits failed', () => {
    expect(
      isJobApprovalBlockedByEnvironment(
        {
          environmentalSnapshot: {
            withinLimits: false,
            outOfLimitsJustification: null,
          },
        },
        '',
      ),
    ).toBe(true)

    expect(
      isJobApprovalBlockedByEnvironment(
        {
          environmentalSnapshot: {
            withinLimits: false,
            outOfLimitsJustification: null,
          },
        },
        'Aprovado por avaliacao tecnica',
      ),
    ).toBe(false)

    expect(
      isJobApprovalBlockedByEnvironment(
        {
          environmentalSnapshot: {
            withinLimits: false,
            outOfLimitsJustification: 'Justificado na execucao',
          },
        },
        '',
      ),
    ).toBe(false)
  })
})
