import { describe, expect, it } from 'vitest'

import * as execution from './index'

// REQ-SPLIT-2: execution.ts became this folder. Every runtime name its callers
// imported before the split must still come out of the index, and nothing else
// leaks. The type half is held by `check-types` on the importers.
const SURFACE = [
  'DEFAULT_PHASE_MODE',
  'JOB_STATUS_LABELS',
  'applyPastedReadings',
  'attachCompositionProfiles',
  'buildCalibrationLocationPayload',
  'buildCalibrationPhasesPayload',
  'buildCertifiedValueOptions',
  'buildEnvironmentPayload',
  'buildEnvironmentWarnings',
  'buildExecutionFormulaContext',
  'buildExecutionMutationPayload',
  'buildMassCompositionOptions',
  'buildSelectedStandardPayload',
  'buildStandardCertifiedValueOptions',
  'canSubmitExecution',
  'classOfStandard',
  'collectPhaseBlocks',
  'defaultCalibrationPhases',
  'evaluateExecutionFormulaResults',
  'evaluateExecutionValidationResults',
  'filterActiveCalculationItems',
  'findMissingNotPerformedPhaseReasons',
  'formatAddress',
  'formatLabAddress',
  'getAssetIndicatorPosition',
  'getCalculationFormulas',
  'getCalculationValidations',
  'getCircularEccentricityLoadPositions',
  'getDisplayedFormulaResults',
  'getEccentricityIndicatorVariant',
  'getOfficialCompiledExecution',
  'isBlockPhaseActive',
  'isExecutionEditable',
  'isPhaseActive',
  'normalizeExecutionFormData',
  'normalizeText',
  'parsePastedReadings',
  'phaseBlockKey',
  'phaseBlockLabel',
  'phaseModeLabel',
  'previewFormulaErrorMessage',
  'resolveFieldForDisplay',
  'resolveSelectedIndicatorPosition',
]

describe('execution index', () => {
  it('REQ-SPLIT-2 re-exports exactly the original runtime surface', () => {
    expect(Object.keys(execution).sort()).toEqual([...SURFACE].sort())
  })

  it('REQ-SPLIT-2 keeps the constants and functions usable', () => {
    expect(execution.DEFAULT_PHASE_MODE).toBe('before_and_after')
    for (const [name, value] of Object.entries(execution)) {
      if (name === 'DEFAULT_PHASE_MODE' || name === 'JOB_STATUS_LABELS')
        continue
      expect(typeof value, name).toBe('function')
    }
    expect(execution.JOB_STATUS_LABELS).toBeTypeOf('object')
  })
})
