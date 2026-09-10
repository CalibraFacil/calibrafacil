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

  // REQ-APPR-001 [HIGH RISK]: the environment gate. An out-of-limits
  // environment with no recorded justification (neither on the snapshot nor
  // typed at approval) MUST block approval; an in-limits environment must NEVER
  // block. Both directions + boundaries are asserted so inverting any branch of
  // the comparison (`!withinLimits`, the justification checks) goes RED.
  describe('REQ-APPR-001 environment gate blocks/allows correctly', () => {
    it('blocks ONLY when out-of-limits AND no justification anywhere (both directions)', () => {
      // --- TRUE direction: out-of-limits, no justification recorded, none typed.
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

      // --- FALSE direction: environment WITHIN limits -> never blocked, even
      // with no justification at all. This is the branch the existing two cases
      // never exercised; inverting `!withinLimits` flips this to true.
      expect(
        isJobApprovalBlockedByEnvironment(
          {
            environmentalSnapshot: {
              withinLimits: true,
              outOfLimitsJustification: null,
            },
          },
          '',
        ),
      ).toBe(false)

      // Within limits stays unblocked regardless of a typed justification.
      expect(
        isJobApprovalBlockedByEnvironment(
          {
            environmentalSnapshot: {
              withinLimits: true,
              outOfLimitsJustification: null,
            },
          },
          'Texto qualquer',
        ),
      ).toBe(false)
    })

    it('treats whitespace-only typed justification as absent (boundary)', () => {
      // A justification of only spaces/tabs must NOT satisfy the gate: still
      // blocked. Guards the `.trim()` on the typed justification.
      expect(
        isJobApprovalBlockedByEnvironment(
          {
            environmentalSnapshot: {
              withinLimits: false,
              outOfLimitsJustification: null,
            },
          },
          '   \t  ',
        ),
      ).toBe(true)

      // A single non-space character is enough to unblock (boundary the other
      // way).
      expect(
        isJobApprovalBlockedByEnvironment(
          {
            environmentalSnapshot: {
              withinLimits: false,
              outOfLimitsJustification: null,
            },
          },
          'x',
        ),
      ).toBe(false)
    })

    it('never blocks when there is no environmental snapshot to evaluate', () => {
      // No snapshot at all -> nothing to gate on -> not blocked.
      expect(isJobApprovalBlockedByEnvironment(null, '')).toBe(false)
      expect(isJobApprovalBlockedByEnvironment({}, '')).toBe(false)
      expect(
        isJobApprovalBlockedByEnvironment({ environmentalSnapshot: null }, ''),
      ).toBe(false)
    })

    it('does not block when withinLimits is unknown (null/undefined snapshot fields)', () => {
      // A snapshot whose `withinLimits` is null/undefined is falsy, but the
      // recorded justification clears the gate; with no justification AND a
      // falsy withinLimits the gate engages. Pin both so the snapshot-field
      // branch is covered.
      expect(
        isJobApprovalBlockedByEnvironment(
          {
            environmentalSnapshot: {
              withinLimits: null,
              outOfLimitsJustification: 'Justificado',
            },
          },
          '',
        ),
      ).toBe(false)

      expect(
        isJobApprovalBlockedByEnvironment(
          {
            environmentalSnapshot: {
              withinLimits: null,
              outOfLimitsJustification: null,
            },
          },
          '',
        ),
      ).toBe(true)
    })
  })

  // REQ-APPR-002 [HIGH RISK]: the approval payload must carry the operator's
  // environmental justification ONLY when one was actually typed, and OMIT it
  // (undefined, never empty string) otherwise. A regression that always sends
  // the raw text, or always omits it, is caught here.
  describe('REQ-APPR-002 approval payload includes justification only when present', () => {
    it('includes the trimmed justification when the operator typed one', () => {
      expect(
        buildJobApprovalInput('  Ambiente avaliado pelo signatario  '),
      ).toEqual({
        reason: 'Aprovado',
        environmentalJustification: 'Ambiente avaliado pelo signatario',
      })
    })

    it('omits the justification (undefined) for empty / whitespace-only input', () => {
      expect(buildJobApprovalInput('')).toEqual({
        reason: 'Aprovado',
        environmentalJustification: undefined,
      })
      expect(buildJobApprovalInput('   \t ')).toEqual({
        reason: 'Aprovado',
        environmentalJustification: undefined,
      })
      // The omitted branch must be `undefined`, not an empty string: a dropped
      // ternary that returned the trimmed value would surface ''.
      expect(
        buildJobApprovalInput('').environmentalJustification,
      ).toBeUndefined()
    })
  })
})
