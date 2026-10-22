import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  MethodInputField,
  ValidationResult,
} from '@/components/method-runtime/types'

import {
  buildAssetSpecSummaryItems,
  buildInitialCalibrationLocation,
  countExecutionIssues,
  formatContextValue,
  formatDateForInput,
  getEnvironmentStatus,
  PERFORMED_AT_PRESETS,
  summarizeRequiredFields,
  toAssetSpecificationFieldDefinition,
  toCalibrationLocationType,
  toCalibrationPhaseMode,
  toStringValue,
} from './execute-page-helpers'
import type { JobData } from './execution'

function field(
  key: string,
  overrides: Partial<MethodInputField> = {},
): MethodInputField {
  return { key, label: key, type: 'number', ...overrides }
}

function makeJob(overrides: Partial<JobData> = {}): JobData {
  return {
    id: 1,
    jobId: 'JOB-1',
    status: 'IN_PROGRESS',
    customerName: 'Cliente',
    assetName: 'Balança',
    assetTag: 'BAL-1',
    assetTypeId: 1,
    serviceName: 'Calibração',
    methodSnapshot: {
      methodId: 1,
      methodName: 'Método',
      methodVersion: 1,
      dataFields: [],
      formulas: [],
      validations: [],
      uncertaintyParams: [],
    },
    data: null,
    results: null,
    ...overrides,
  }
}

describe('REQ-SPLIT-2 execute-page helpers moved out of the page', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('formatDateForInput', () => {
    it('REQ-SPLIT-2 formats the LOCAL calendar date, not the UTC one', () => {
      // Local midnight on 5 Jan: toISOString() would shift it east of UTC.
      expect(formatDateForInput(new Date(2026, 0, 5, 0, 0, 0))).toBe(
        '2026-01-05',
      )
      expect(formatDateForInput(new Date(2026, 11, 31, 23, 59, 59))).toBe(
        '2026-12-31',
      )
    })
  })

  describe('PERFORMED_AT_PRESETS', () => {
    it('REQ-SPLIT-2 offers today, yesterday, 3 days ago and a week ago', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-20T12:00:00.000Z'))
      const day = 24 * 60 * 60 * 1000
      const now = Date.now()

      expect(PERFORMED_AT_PRESETS.map((preset) => preset.label)).toEqual([
        'Hoje',
        'Ontem',
        'Há 3 dias',
        'Há uma semana',
      ])
      expect(
        PERFORMED_AT_PRESETS.map((preset) => preset.getDate().getTime()),
      ).toEqual([now, now - day, now - 3 * day, now - 7 * day])
    })
  })

  describe('narrowing helpers', () => {
    it('REQ-SPLIT-2 toCalibrationPhaseMode keeps the four modes and defaults the rest', () => {
      for (const mode of [
        'before_only',
        'after_only',
        'not_performed',
        'before_and_after',
      ]) {
        expect(toCalibrationPhaseMode(mode)).toBe(mode)
      }
      expect(toCalibrationPhaseMode('whatever')).toBe('before_and_after')
      expect(toCalibrationPhaseMode(undefined)).toBe('before_and_after')
    })

    it('REQ-SPLIT-2 toCalibrationLocationType keeps the three types and defaults to the customer site', () => {
      for (const type of ['customer_site', 'lab', 'other']) {
        expect(toCalibrationLocationType(type)).toBe(type)
      }
      expect(toCalibrationLocationType('mars')).toBe('customer_site')
      expect(toCalibrationLocationType(null)).toBe('customer_site')
    })

    it('REQ-SPLIT-2 toStringValue only passes strings through', () => {
      expect(toStringValue('abc')).toBe('abc')
      expect(toStringValue('')).toBe('')
      expect(toStringValue(12)).toBe('')
      expect(toStringValue(null)).toBe('')
    })

    it('REQ-SPLIT-2 formatContextValue prints scalars, a dash for nothing and JSON for the rest', () => {
      expect(formatContextValue(null)).toBe('—')
      expect(formatContextValue(undefined)).toBe('—')
      expect(formatContextValue(1.5)).toBe('1.5')
      expect(formatContextValue('x')).toBe('x')
      expect(formatContextValue(false)).toBe('false')
      expect(formatContextValue([1, 2])).toBe('[1,2]')
      expect(formatContextValue({ a: 1 })).toBe('{"a":1}')
    })

    it('REQ-SPLIT-2 toAssetSpecificationFieldDefinition keeps only spec-bound number/text/select fields', () => {
      expect(
        toAssetSpecificationFieldDefinition(
          field('capacity', { assetSpecKey: 'capacity', unit: 'kg' }),
        ),
      ).toEqual([{ key: 'capacity', type: 'number', unit: 'kg' }])
      expect(
        toAssetSpecificationFieldDefinition(
          field('brand', { assetSpecKey: 'brand', type: 'text' }),
        ),
      ).toEqual([{ key: 'brand', type: 'text', unit: undefined }])
      // No spec key, or a type that cannot hold a specification value.
      expect(toAssetSpecificationFieldDefinition(field('plain'))).toEqual([])
      expect(
        toAssetSpecificationFieldDefinition(
          field('readings', { assetSpecKey: 'x', type: 'table' }),
        ),
      ).toEqual([])
    })
  })

  describe('buildInitialCalibrationLocation', () => {
    it('REQ-SPLIT-2 keeps the location already recorded on the job', () => {
      const existing = { type: 'other' as const, addressText: 'Obra 7' }
      expect(
        buildInitialCalibrationLocation(
          makeJob({
            calibrationLocationSnapshot: existing,
            customerAddress: { street: 'Rua A' },
          }),
        ),
      ).toBe(existing)
    })

    it('REQ-SPLIT-2 defaults to the customer address when there is one', () => {
      expect(
        buildInitialCalibrationLocation(
          makeJob({
            customerAddress: { street: 'Rua A', number: '10', city: 'Recife' },
            labStreet: 'Rua do Lab',
          }),
        ),
      ).toEqual({ type: 'customer_site', addressText: 'Rua A, 10, Recife' })
    })

    it('REQ-SPLIT-2 falls back to the lab address, then to an empty "other"', () => {
      expect(
        buildInitialCalibrationLocation(
          makeJob({ labStreet: 'Rua do Lab', labCity: 'Olinda' }),
        ),
      ).toEqual({ type: 'lab', addressText: 'Rua do Lab, Olinda' })
      expect(buildInitialCalibrationLocation(makeJob())).toEqual({
        type: 'other',
        addressText: '',
      })
    })

    it('REQ-SPLIT-2 ignores a recorded location with no address text', () => {
      expect(
        buildInitialCalibrationLocation(
          makeJob({
            calibrationLocationSnapshot: { type: 'lab', addressText: '' },
            labStreet: 'Rua do Lab',
          }),
        ),
      ).toEqual({ type: 'lab', addressText: 'Rua do Lab' })
    })
  })

  describe('summarizeRequiredFields', () => {
    it('REQ-SPLIT-2 counts filled required fields and reports the percentage', () => {
      const fields = [
        field('a', { required: true }),
        field('b', { required: true }),
        field('c', { required: true }),
        field('d'),
      ]
      const summary = summarizeRequiredFields(fields, { a: 1, b: '', d: 5 })

      expect(summary.requiredFields.map((f) => f.key)).toEqual(['a', 'b', 'c'])
      expect(summary.completedRequiredFields.map((f) => f.key)).toEqual(['a'])
      expect(summary.requiredCompletionPercent).toBe(33)
      expect(summary.requiredComplete).toBe(false)
    })

    it('REQ-SPLIT-2 is complete at 100% when every required field has a value', () => {
      const summary = summarizeRequiredFields(
        [field('a', { required: true }), field('b', { required: true })],
        { a: 0, b: 'x' },
      )
      expect(summary.requiredCompletionPercent).toBe(100)
      expect(summary.requiredComplete).toBe(true)
    })

    it('REQ-SPLIT-2 reports 100% but not "complete" when nothing is required', () => {
      const summary = summarizeRequiredFields([field('a')], {})
      expect(summary.requiredFields).toEqual([])
      expect(summary.requiredCompletionPercent).toBe(100)
      expect(summary.requiredComplete).toBe(false)
    })
  })

  describe('countExecutionIssues', () => {
    const base = {
      formulaResults: {},
      validationResults: [],
      envWarningCount: 0,
      missingNotPerformedPhaseReasonCount: 0,
    }
    function validation(
      overrides: Partial<ValidationResult>,
    ): ValidationResult {
      return {
        leftExpression: 'a',
        operator: '<=',
        rightExpression: 'b',
        message: 'm',
        severity: 'warning',
        ...overrides,
      }
    }

    it('REQ-SPLIT-2 is zero for a clean worksheet', () => {
      expect(countExecutionIssues(base)).toBe(0)
    })

    it('REQ-SPLIT-2 adds formula errors, failed error-severity criteria, env warnings and missing phase reasons', () => {
      expect(
        countExecutionIssues({
          formulaResults: {
            ok: { value: 1 },
            bad: { error: 'division by zero' },
            worse: { error: 'unknown variable' },
          },
          validationResults: [
            validation({ error: 'could not evaluate' }),
            validation({ severity: 'error', passed: false }),
            // Warning-severity failures and passing criteria are not issues.
            validation({ severity: 'warning', passed: false }),
            validation({ severity: 'error', passed: true }),
            // Not yet evaluated: neither passed nor failed.
            validation({ severity: 'error' }),
          ],
          envWarningCount: 3,
          missingNotPerformedPhaseReasonCount: 1,
        }),
      ).toBe(2 + 2 + 3 + 1)
    })
  })

  describe('getEnvironmentStatus', () => {
    const empty = { temperature: null, humidity: null, pressure: null }

    it('REQ-SPLIT-2 out-of-limit warnings win over recorded values', () => {
      expect(getEnvironmentStatus(1, { ...empty, temperature: 30 })).toBe(
        'Fora do limite',
      )
    })

    it('REQ-SPLIT-2 any recorded value counts as registered, none as pending', () => {
      expect(getEnvironmentStatus(0, { ...empty, pressure: 1013 })).toBe(
        'Registrado',
      )
      expect(getEnvironmentStatus(0, { ...empty, humidity: 0 })).toBe(
        'Registrado',
      )
      expect(getEnvironmentStatus(0, empty)).toBe('Pendente')
    })
  })

  describe('buildAssetSpecSummaryItems', () => {
    it('REQ-SPLIT-2 summarises each asset spec field with its converted value or a dash', () => {
      const job = makeJob({
        assetSnapshot: {
          assetId: 1,
          assetTypeId: 1,
          assetTypeName: 'Balança',
          assetTypeSlug: 'balanca',
          name: 'Balança',
          tag: 'BAL-1',
          serialNumber: 'S1',
          manufacturer: null,
          model: null,
          specifications: { capacity: 1500, resolution: '' },
          capturedAt: '2026-05-20T00:00:00.000Z',
        },
      })
      const convert = vi.fn((value: unknown) =>
        typeof value === 'number' ? value / 1000 : value,
      )

      const items = buildAssetSpecSummaryItems({
        displayAssetSpecFields: [
          field('capacity', { assetSpecKey: 'capacity', unit: 'kg' }),
          field('resolution', { assetSpecKey: 'resolution', unit: 'g' }),
          field('missing', { assetSpecKey: 'absent' }),
          field('noKey'),
        ],
        job,
        convertCanonicalValueToDisplayUnit: convert,
      })

      expect(items).toEqual([
        { key: 'capacity', label: 'capacity', unit: 'kg', value: '1.5' },
        { key: 'resolution', label: 'resolution', unit: 'g', value: '-' },
        { key: 'missing', label: 'missing', unit: undefined, value: '-' },
        { key: 'noKey', label: 'noKey', unit: undefined, value: '-' },
      ])
      expect(convert).toHaveBeenCalledWith(1500, 'kg')
    })
  })
})
