import { describe, expect, it } from 'vitest'

import { describeStandardWarnings } from './warnings'

const NOW = new Date('2026-09-09T12:00:00Z')

function form(
  overrides: Partial<Parameters<typeof describeStandardWarnings>[0]> = {},
) {
  return {
    calibrationDate: '2026-01-10',
    nextCalibrationDate: '2027-01-10',
    coverageFactor: '2',
    distribution: 'normal' as const,
    uncertaintyUnit: 'g',
    certifiedValues: [],
    ...overrides,
  }
}

describe('describeStandardWarnings', () => {
  it('stays quiet on a well-formed standard', () => {
    expect(describeStandardWarnings(form(), NOW)).toEqual([])
  })

  it('flags a certificate that has already expired', () => {
    // Otherwise the lab only finds out when a job refuses the standard.
    const warnings = describeStandardWarnings(
      form({ nextCalibrationDate: '2026-08-01' }),
      NOW,
    )

    expect(warnings.map((warning) => warning.field)).toContain(
      'nextCalibrationDate',
    )
  })

  it('does not flag a certificate expiring today', () => {
    expect(
      describeStandardWarnings(
        form({ nextCalibrationDate: '2026-09-09' }),
        NOW,
      ),
    ).toEqual([])
  })

  it('flags validity that is not after the calibration date', () => {
    const warnings = describeStandardWarnings(
      form({
        calibrationDate: '2027-02-10',
        nextCalibrationDate: '2027-01-10',
      }),
      NOW,
    )

    expect(warnings.map((warning) => warning.field)).toContain(
      'calibrationDate',
    )
  })

  it('questions k=2 declared against a rectangular distribution', () => {
    const warnings = describeStandardWarnings(
      form({ distribution: 'rectangular', coverageFactor: '2' }),
      NOW,
    )

    expect(warnings.map((warning) => warning.field)).toContain('coverageFactor')
  })

  it('accepts a rectangular distribution with its own divisor', () => {
    expect(
      describeStandardWarnings(
        form({ distribution: 'rectangular', coverageFactor: '1.732' }),
        NOW,
      ),
    ).toEqual([])
  })

  it('flags an uncertainty unit that differs from the certified values', () => {
    const warnings = describeStandardWarnings(
      form({
        uncertaintyUnit: 'mg',
        certifiedValues: [
          {
            nominal: '1 kg',
            authentication: '',
            value: '1000',
            uncertainty: '0.5',
            unit: 'g',
            maxError: '',
            drift: '',
            buoyancy: '',
            coverageFactor: '',
          },
        ],
      }),
      NOW,
    )

    expect(warnings.map((warning) => warning.field)).toContain(
      'uncertaintyUnit',
    )
  })

  it('says nothing about units while the values have none yet', () => {
    expect(
      describeStandardWarnings(
        form({
          uncertaintyUnit: 'mg',
          certifiedValues: [
            {
              nominal: '1 kg',
              authentication: '',
              value: '1000',
              uncertainty: '0.5',
              unit: '',
              maxError: '',
              drift: '',
              buoyancy: '',
              coverageFactor: '',
            },
          ],
        }),
        NOW,
      ),
    ).toEqual([])
  })

  it('ignores a partially typed date instead of warning mid-keystroke', () => {
    expect(
      describeStandardWarnings(form({ nextCalibrationDate: '2026-0' }), NOW),
    ).toEqual([])
  })
})
