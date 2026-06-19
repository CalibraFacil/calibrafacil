import { describe, expect, it, vi } from 'vitest'

vi.mock('@calibra-facil/math-engine', () => ({
  createCalculationEngine: () => ({
    evaluateFormula: (expression: string, inputs: Record<string, number>) => {
      if (expression === 'load * 2') {
        return {
          value: inputs.load * 2,
          valueText: String(inputs.load * 2),
        }
      }
      if (expression === 'double_load' || expression === 'capacity') {
        return {
          value: inputs[expression],
          valueText: String(inputs[expression]),
        }
      }
      throw new Error(`Unexpected expression: ${expression}`)
    },
  }),
  isCalculationEngineError: () => false,
}))

import type {
  MethodInputField,
  MethodTableColumn,
} from '@/components/method-runtime/types'
import { createMethodCalculationEngine } from '@/components/method-runtime/math-runtime'
import { applyStandardValueOption } from '@/components/method-runtime/standard-value-utils'

import {
  buildCertifiedValueOptions,
  buildCalibrationLocationPayload,
  buildCalibrationPhasesPayload,
  buildEnvironmentPayload,
  buildEnvironmentWarnings,
  buildExecutionMutationPayload,
  buildExecutionFormulaContext,
  buildMassCompositionOptions,
  buildStandardCertifiedValueOptions,
  buildSelectedStandardPayload,
  canSubmitExecution,
  collectPhaseBlocks,
  defaultCalibrationPhases,
  evaluateExecutionFormulaResults,
  evaluateExecutionValidationResults,
  filterActiveCalculationItems,
  findMissingNotPerformedPhaseReasons,
  formatAddress,
  formatLabAddress,
  getCalculationFormulas,
  getCalculationValidations,
  getAssetIndicatorPosition,
  getCircularEccentricityLoadPositions,
  getEccentricityIndicatorVariant,
  getDisplayedFormulaResults,
  getOfficialCompiledExecution,
  isExecutionEditable,
  isPhaseActive,
  normalizeExecutionFormData,
  normalizeText,
  phaseModeLabel,
  previewFormulaErrorMessage,
  resolveFieldForDisplay,
  resolveSelectedIndicatorPosition,
  type CalibrationPhaseSnapshot,
  type JobData,
  type ReferenceStandard,
} from './execution'

describe('job execution feature model', () => {
  it('collects unique calibration phase blocks from method fields', () => {
    expect(
      collectPhaseBlocks([
        inputField({
          key: 'before_load',
          phaseBlockKey: 'load',
          phaseBlockLabel: 'Carga',
        }),
        inputField({
          key: 'after_load',
          phaseBlockKey: 'load',
          phaseBlockLabel: 'Carga duplicada',
        }),
        inputField({ key: 'no_phase' }),
      ]),
    ).toEqual([{ key: 'load', label: 'Carga' }])
  })

  it('preserves existing calibration phase state and defaults missing blocks', () => {
    const phases = defaultCalibrationPhases(
      [
        inputField({ key: 'load', phaseBlockKey: 'load' }),
        inputField({ key: 'zero', phaseBlockKey: 'zero' }),
      ],
      {
        blocks: {
          load: { mode: 'before_only', reason: 'Após indisponível' },
        },
        recordedAt: '2026-05-20T00:00:00.000Z',
        recordedBy: 'Ana',
      },
    )

    expect(phases).toEqual({
      blocks: {
        load: { mode: 'before_only', reason: 'Após indisponível' },
        zero: { mode: 'before_and_after', reason: null },
      },
      recordedAt: '2026-05-20T00:00:00.000Z',
      recordedBy: 'Ana',
    })
  })

  it('resolves active phases from formula or validation metadata', () => {
    const phases: CalibrationPhaseSnapshot = {
      blocks: {
        load: { mode: 'before_only' },
        zero: { mode: 'not_performed' },
      },
    }

    expect(isPhaseActive({ phaseBlock: 'load', phase: 'before' }, phases)).toBe(
      true,
    )
    expect(isPhaseActive({ phaseBlock: 'load', phase: 'after' }, phases)).toBe(
      false,
    )
    expect(isPhaseActive({ phaseBlock: 'zero', phase: 'before' }, phases)).toBe(
      false,
    )
    expect(isPhaseActive({ unrelated: true }, phases)).toBe(true)
  })

  it('formats addresses and lab addresses without route component state', () => {
    expect(
      formatAddress({
        street: 'Rua Um',
        number: '123',
        city: 'Curitiba',
        state: 'PR',
      }),
    ).toBe('Rua Um, 123, Curitiba, PR')

    expect(
      formatLabAddress({
        ...jobData(),
        labStreet: 'Av. Laboratório',
        labNumber: '45',
        labCity: 'São Paulo',
        labState: 'SP',
      }),
    ).toBe('Av. Laboratório, 45, São Paulo, SP')
  })

  it('maps preview formula errors to operator-facing messages', () => {
    expect(
      previewFormulaErrorMessage({
        errorCode: 'UNKNOWN_IDENTIFIER',
        error: 'missing x',
      }),
    ).toBe('Aguardando entrada ou resultado dependente.')
    expect(
      previewFormulaErrorMessage({
        error: 'allowed function whitelist rejected foo',
      }),
    ).toBe('Função disponível apenas na execução oficial do método compilado.')
    expect(previewFormulaErrorMessage({ error: 'Erro original' })).toBe(
      'Erro original',
    )
  })

  it('resolves mass display units for fields, ranges and composition columns', () => {
    const field = resolveFieldForDisplay(
      inputField({
        unit: 'g',
        weighingRangeResolver: {
          pointUnit: 'g',
        },
        columns: [
          { key: 'mass', label: 'Massa', type: 'number', unit: 'g' },
          {
            key: 'composition',
            label: 'Composição',
            type: 'number',
            unit: 'g',
            massComposition: { targetUnit: 'g' },
          },
        ],
      }),
      'kg',
    )

    expect(field.unit).toBe('kg')
    expect(field.weighingRangeResolver?.pointUnit).toBe('kg')
    expect(field.columns?.[0]?.unit).toBe('kg')
    expect(field.columns?.[1]?.massComposition?.targetUnit).toBe('kg')
  })

  it('keeps phase mode labels in the feature layer', () => {
    expect(phaseModeLabel('before_and_after')).toBe('Antes e após')
    expect(phaseModeLabel('before_only')).toBe('Somente antes')
    expect(phaseModeLabel('after_only')).toBe('Somente após')
    expect(phaseModeLabel('not_performed')).toBe('Não executado')
  })

  it('derives eccentricity indicator settings from method and asset snapshots', () => {
    const field = inputField({
      eccentricityIndicator: { enabled: true },
      columns: [
        { key: 'carga', label: 'Carga', type: 'number' },
        { key: 'ponto', label: 'Posição', type: 'text' },
      ],
    })

    expect(normalizeText('Posição À')).toBe('posicao a')
    expect(getEccentricityIndicatorVariant(field)).toBe('circular_platform')
    expect(
      getCircularEccentricityLoadPositions(field, [
        { ponto: 'a' },
        { ponto: 'B' },
        { ponto: 'B' },
        { ponto: 'fora' },
      ]),
    ).toEqual(['A', 'B'])
    expect(
      getAssetIndicatorPosition({
        ...jobData(),
        methodSnapshot: {
          ...jobData().methodSnapshot,
          dataFields: [field],
        },
        assetSnapshot: {
          assetId: 1,
          assetTypeId: 1,
          assetTypeName: 'Balança',
          assetTypeSlug: 'scale',
          name: 'Balança',
          tag: 'BAL-1',
          serialNumber: 'SN-1',
          manufacturer: null,
          model: null,
          specifications: {
            eccentricityIndicatorPosition: 'top',
          },
          capturedAt: '2026-05-20T00:00:00.000Z',
        },
      }),
    ).toBe('top')
    expect(resolveSelectedIndicatorPosition('top', 'circular_platform')).toBe(
      'top',
    )
    expect(
      resolveSelectedIndicatorPosition('1', 'circular_platform'),
    ).toBeNull()
  })

  it('normalizes execution form data and selected standards in the feature layer', () => {
    const numberField = inputField({ key: 'load', type: 'number' })
    const tableField = inputField({
      key: 'readings',
      type: 'table',
      columns: [
        { key: 'point', label: 'Ponto', type: 'text' },
        { key: 'value', label: 'Valor', type: 'number' },
      ],
    })
    const normalized = normalizeExecutionFormData({
      data: {
        load: '10.5',
        readings: [{ point: 'A', value: '1.25' }],
        ignored: '99',
      },
      manualFields: [numberField, tableField],
      displayManualFields: [numberField, tableField],
      displayAssetSpecifications: null,
    })

    expect(normalized).toEqual({
      load: 10.5,
      readings: [{ point: 'A', value: 1.25 }],
    })
    expect(
      buildSelectedStandardPayload([1], {
        composition: {
          kind: 'mass_standard_composition',
          targetUnit: 'g',
          label: 'Composição',
          items: [
            {
              standardId: 2,
              standardIds: [3, 4],
              standardName: 'Peso',
              certificateNumber: 'CERT',
              certifiedValueIndex: 0,
              nominal: '1 g',
              quantity: 1,
              value: 1,
              uncertainty: 0.1,
              unit: 'g',
              coverageFactor: 2,
            },
          ],
          totals: {
            certifiedValue: 1,
            expandedUncertainty: 0.1,
            maxError: null,
            drift: null,
            buoyancy: null,
          },
          warnings: [],
        },
      }),
    ).toEqual([1, 3, 4])
  })

  it('builds execution payload fragments and warnings outside the route', () => {
    const phases: CalibrationPhaseSnapshot = {
      blocks: {
        load: { mode: 'not_performed', reason: '' },
        zero: { mode: 'before_only', reason: null },
      },
    }
    const blocks = [
      { key: 'load', label: 'Carga' },
      { key: 'zero', label: 'Zero' },
    ]

    expect(
      buildEnvironmentPayload({
        temperature: null,
        humidity: null,
        pressure: null,
      }),
    ).toBeUndefined()
    expect(
      buildEnvironmentPayload({
        temperature: 24,
        humidity: null,
        pressure: null,
      }),
    ).toEqual({ temperature: 24, humidity: null, pressure: null })
    expect(
      buildCalibrationLocationPayload({
        type: 'lab',
        addressText: 'Rua Lab',
      }),
    ).toEqual({ type: 'lab', addressText: 'Rua Lab', notes: null })
    expect(
      buildCalibrationPhasesPayload({
        phaseBlocks: blocks,
        calibrationPhases: phases,
      }),
    ).toEqual({
      blocks: {
        load: { mode: 'not_performed', reason: '' },
        zero: { mode: 'before_only', reason: null },
      },
    })
    expect(
      findMissingNotPerformedPhaseReasons({
        phaseBlocks: blocks,
        calibrationPhases: phases,
      }),
    ).toEqual([{ key: 'load', label: 'Carga' }])
    expect(
      buildEnvironmentWarnings({
        environment: { temperature: 30, humidity: 20, pressure: 1000 },
        envLimits: {
          temperatureMin: 18,
          temperatureMax: 25,
          humidityMin: 40,
          humidityMax: 60,
          pressureMin: null,
          pressureMax: null,
        },
      }),
    ).toEqual([
      'Temperatura fora da faixa (18 – 25 °C)',
      'Umidade fora da faixa (40 – 60 %RH)',
    ])
  })

  it('builds save and submit mutation payloads from normalized execution state', () => {
    const normalizedData = {
      load: 10,
      composition: {
        kind: 'mass_standard_composition',
        targetUnit: 'g',
        label: 'Composição',
        items: [
          {
            standardId: 2,
            standardIds: [3, 4],
            standardName: 'Peso',
            certificateNumber: 'CERT',
            certifiedValueIndex: 0,
            nominal: '1 g',
            quantity: 1,
            value: 1,
            uncertainty: 0.1,
            unit: 'g',
            coverageFactor: 2,
          },
        ],
        totals: {
          certifiedValue: 1,
          expandedUncertainty: 0.1,
          maxError: null,
          drift: null,
          buoyancy: null,
        },
        warnings: [],
      },
    }

    expect(
      buildExecutionMutationPayload({
        selectedStandardIds: [1, 3],
        normalizedData,
        formulaResults: {
          error: { value: 0.05 },
          pending: {},
          margin: { value: [0.1, 0.2] },
        },
        environment: { temperature: 22, humidity: null, pressure: null },
        calibrationLocation: {
          type: 'lab',
          addressText: 'Rua Lab',
          notes: null,
        },
        calibrationPhases: {
          blocks: {
            load: { mode: 'before_only', reason: 'Ajuste dispensado' },
          },
        },
      }),
    ).toEqual({
      selectedStandardIds: [1, 3, 4],
      data: normalizedData,
      results: {
        error: 0.05,
        margin: [0.1, 0.2],
      },
      environment: { temperature: 22, humidity: null, pressure: null },
      calibrationLocation: {
        type: 'lab',
        addressText: 'Rua Lab',
        notes: null,
      },
      calibrationPhases: {
        blocks: {
          load: { mode: 'before_only', reason: 'Ajuste dispensado' },
        },
      },
    })
  })

  it('checks execution submit eligibility and editable statuses', () => {
    const requiredField = inputField({ key: 'load', required: true })

    expect(
      canSubmitExecution({
        manualFields: [requiredField],
        formData: { load: 10 },
        calibrationPhases: { blocks: {} },
        missingAssetSpecFields: [],
        calibrationLocation: { type: 'lab', addressText: 'Rua Lab' },
        missingNotPerformedPhaseReasons: [],
      }),
    ).toBe(true)
    expect(
      canSubmitExecution({
        manualFields: [requiredField],
        formData: {},
        calibrationPhases: { blocks: {} },
        missingAssetSpecFields: [],
        calibrationLocation: { type: 'lab', addressText: 'Rua Lab' },
        missingNotPerformedPhaseReasons: [],
      }),
    ).toBe(false)
    expect(isExecutionEditable('REJECTED')).toBe(true)
    expect(isExecutionEditable('APPROVED')).toBe(false)
  })

  it('evaluates execution formulas and validations outside the route', () => {
    const engine = createMethodCalculationEngine()
    const job = {
      ...jobData(),
      assetSnapshot: {
        assetId: 1,
        assetTypeId: 1,
        assetTypeName: 'Balança',
        assetTypeSlug: 'scale',
        name: 'Balança',
        tag: 'BAL-1',
        serialNumber: 'SN-1',
        manufacturer: null,
        model: null,
        specifications: { capacity: 30 },
        capturedAt: '2026-05-20T00:00:00.000Z',
      },
      methodSnapshot: {
        ...jobData().methodSnapshot,
        dataFields: [
          inputField({ key: 'load' }),
          inputField({
            key: 'capacity',
            source: 'asset_spec',
            assetSpecKey: 'capacity',
          }),
        ],
        formulas: [{ outputKey: 'double_load', expression: 'load * 2' }],
        validations: [
          {
            leftExpression: 'double_load',
            operator: '<=',
            rightExpression: 'capacity',
            message: 'Carga excedida',
            severity: 'error',
          },
        ],
      },
      results: {
        __compiledExecution: { diagnostics: ['stored'] },
        double_load: 20,
      },
    } satisfies JobData

    const context = buildExecutionFormulaContext({
      job,
      normalizedFormData: { load: 10 },
      standardsData: [],
      selectedStandardIds: [],
      environment: { temperature: null, humidity: null, pressure: null },
    })
    const formulas = filterActiveCalculationItems(getCalculationFormulas(job), {
      blocks: {},
    })
    const formulaResults = evaluateExecutionFormulaResults({
      engine,
      job,
      context,
      normalizedFormData: { load: 10 },
      activeCalculationFormulas: formulas,
      assetBaseMeasurementUnit: null,
    })
    const validationResults = evaluateExecutionValidationResults({
      engine,
      context,
      formulaResults,
      activeCalculationValidations: filterActiveCalculationItems(
        getCalculationValidations(job),
        { blocks: {} },
      ),
    })

    expect(context.load).toBe(10)
    expect(context.capacity).toBe(30)
    expect(formulaResults.double_load?.value).toBe(20)
    expect(validationResults[0]?.passed).toBe(true)
    expect(getOfficialCompiledExecution(job.results)?.diagnostics).toEqual([
      'stored',
    ])
    expect(
      getDisplayedFormulaResults({
        activeCalculationFormulas: formulas,
        assetBaseMeasurementUnit: null,
        formulaResults,
        jobResults: job.results,
      }).double_load?.value,
    ).toBe(20)
  })

  it('builds certified value and mass composition options outside the route', () => {
    const standards = [
      referenceStandard({
        id: 1,
        name: 'Peso 1',
        certifiedValues: [
          {
            nominal: '1 g',
            value: 1,
            uncertainty: 0.01,
            unit: 'g',
            compositionProfile: false,
          },
          {
            nominal: 'Classe F1',
            value: 1,
            uncertainty: 0.02,
            unit: 'g',
            compositionProfile: true,
            profileKey: 'F1',
          },
        ],
      }),
      referenceStandard({
        id: 2,
        name: 'Peso 2',
        certifiedValues: [
          {
            nominal: 'Classe F1',
            value: 2,
            uncertainty: 0.03,
            unit: 'g',
            compositionProfile: true,
            profileKey: 'F1',
          },
        ],
      }),
    ]
    const identity = (value: number) => value
    const unit = (value?: string | null) => value ?? undefined

    expect(
      buildCertifiedValueOptions({
        standardsData: standards,
        convertValueToDisplayUnit: identity,
        displayUnitFor: unit,
      }),
    ).toEqual([
      {
        label: '1 g',
        value: 1,
        uncertainty: 0.01,
        unit: 'g',
        standardName: 'Peso 1',
      },
    ])
    expect(
      buildMassCompositionOptions({
        standardsData: standards,
        convertValueToDisplayUnit: identity,
        displayUnitFor: unit,
      }).map((option) => ({
        standardId: option.standardId,
        standardIds: option.standardIds,
        standardName: option.standardName,
        optionLabel: option.optionLabel,
      })),
    ).toEqual([
      {
        standardId: 1,
        standardIds: undefined,
        standardName: 'Peso 1',
        optionLabel: '1 g - Peso 1 (CERT-1)',
      },
      {
        standardId: 1,
        standardIds: [1, 2],
        standardName: 'Perfil de composição',
        optionLabel: 'F1 - perfil de composição',
      },
    ])
  })

  it('keeps buildMassCompositionOptions output byte-identical (mass regression)', () => {
    const standards = [
      referenceStandard({
        id: 1,
        name: 'Peso 1',
        certificateNumber: 'CERT-1',
        coverageFactor: 2,
        drift: 0.001,
        certifiedValues: [
          {
            nominal: '1 g',
            value: 1.00015,
            uncertainty: 0.0001,
            unit: 'g',
            maxError: 0.0005,
            drift: 0.0002,
            buoyancy: 0.00001,
            coverageFactor: 2,
            compositionProfile: false,
          },
        ],
      }),
    ]
    const identity = (value: number) => value
    const unit = (value?: string | null) => value ?? undefined

    // Full-object assertion (not just the 4 summary fields) so any change to the
    // mass path's per-option shape/values would fail this regression test.
    expect(
      buildMassCompositionOptions({
        standardsData: standards,
        convertValueToDisplayUnit: identity,
        displayUnitFor: unit,
      }),
    ).toEqual([
      {
        standardId: 1,
        standardName: 'Peso 1',
        certificateNumber: 'CERT-1',
        certifiedValueIndex: 0,
        nominal: '1 g',
        authentication: undefined,
        value: 1.00015,
        uncertainty: 0.0001,
        unit: 'g',
        coverageFactor: 2,
        maxError: 0.0005,
        drift: 0.0002,
        buoyancy: 0.00001,
        optionLabel: '1 g - Peso 1 (CERT-1)',
      },
    ])
  })

  it('builds generic standard certified-value options for a non-mass unit (force N)', () => {
    const standards = [
      referenceStandard({
        id: 7,
        name: 'Célula de carga',
        certificateNumber: 'CERT-FORCE-1',
        coverageFactor: 2,
        drift: null,
        certifiedValues: [
          {
            nominal: '100 N',
            value: 100.02,
            uncertainty: 0.05,
            unit: 'N',
            coverageFactor: 2.1,
            drift: 0.01,
          },
          // A composition profile must be skipped by the generic builder.
          {
            nominal: 'Perfil',
            value: 5,
            uncertainty: 0.1,
            unit: 'N',
            compositionProfile: true,
            profileKey: 'P1',
          },
        ],
      }),
    ]
    const identity = (value: number) => value
    const unit = (value?: string | null) => value ?? undefined

    expect(
      buildStandardCertifiedValueOptions({
        standardsData: standards,
        convertValueToDisplayUnit: identity,
        displayUnitFor: unit,
      }),
    ).toEqual([
      {
        standardId: 7,
        standardName: 'Célula de carga',
        certificateNumber: 'CERT-FORCE-1',
        certifiedValueIndex: 0,
        nominal: '100 N',
        value: 100.02,
        uncertainty: 0.05,
        coverageFactor: 2.1,
        drift: 0.01,
        unit: 'N',
        optionLabel: '100 N - Célula de carga (CERT-FORCE-1)',
      },
    ])
  })

  it('falls back to the standard coverageFactor when the cert value omits k (voltage V)', () => {
    const standards = [
      referenceStandard({
        id: 8,
        name: 'Multímetro de referência',
        certificateNumber: 'CERT-V-1',
        coverageFactor: 2,
        drift: null,
        certifiedValues: [
          {
            nominal: '10 V',
            value: 10.0001,
            uncertainty: 0.0002,
            unit: 'V',
            coverageFactor: null,
            drift: null,
          },
        ],
      }),
    ]
    const identity = (value: number) => value
    const unit = (value?: string | null) => value ?? undefined

    const options = buildStandardCertifiedValueOptions({
      standardsData: standards,
      convertValueToDisplayUnit: identity,
      displayUnitFor: unit,
    })

    expect(options[0]?.coverageFactor).toBe(2)
    expect(options[0]?.drift).toBeNull()
  })

  it('fills value / U / k for a standard_value column matched by nominal (force N)', () => {
    const columns: MethodTableColumn[] = [
      {
        key: 'ponto',
        label: 'Ponto',
        type: 'text',
      },
      {
        key: 'valor_padrao',
        label: 'Valor do padrão',
        type: 'number',
        unit: 'N',
        role: 'standard_value',
        standardValue: {
          matchBy: 'nominal',
          targetColumns: {
            value: 'valor_padrao',
            expandedUncertainty: 'incerteza_padrao',
            coverageFactor: 'k_referencia',
            drift: 'deriva',
          },
        },
      },
      { key: 'incerteza_padrao', label: 'U', type: 'number', unit: 'N' },
      { key: 'k_referencia', label: 'k', type: 'number' },
      { key: 'deriva', label: 'Deriva', type: 'number', unit: 'N' },
    ]
    const option = buildStandardCertifiedValueOptions({
      standardsData: [
        referenceStandard({
          id: 7,
          name: 'Célula de carga',
          certificateNumber: 'CERT-FORCE-1',
          coverageFactor: 2,
          certifiedValues: [
            {
              nominal: '100 N',
              value: 100.02,
              uncertainty: 0.05,
              unit: 'N',
              coverageFactor: 2.1,
              drift: 0.01,
            },
          ],
        }),
      ],
      convertValueToDisplayUnit: (value: number) => value,
      displayUnitFor: (value?: string | null) => value ?? undefined,
    })[0]
    expect(option).toBeDefined()

    const nextRow = applyStandardValueOption({
      row: { ponto: '100 N', valor_padrao: null },
      columnKey: 'valor_padrao',
      columns,
      option: option!,
    })

    expect(nextRow).toEqual({
      ponto: '100 N',
      valor_padrao: 100.02,
      incerteza_padrao: 0.05,
      k_referencia: 2.1,
      deriva: 0.01,
    })
  })
})

function inputField(
  overrides: Partial<MethodInputField> = {},
): MethodInputField {
  return {
    key: 'field',
    label: 'Campo',
    type: 'number',
    ...overrides,
  }
}

function jobData(): JobData {
  return {
    id: 1,
    jobId: 'JOB-1',
    status: 'DRAFT',
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
  }
}

function referenceStandard(
  overrides: Partial<ReferenceStandard> = {},
): ReferenceStandard {
  return {
    id: 1,
    name: 'Padrão',
    serialNumber: 'SN',
    certificateNumber: 'CERT-1',
    calibrationDate: '2026-01-01',
    nextCalibrationDate: '2027-01-01',
    uncertainty: null,
    uncertaintyUnit: null,
    coverageFactor: 2,
    distribution: 'normal',
    drift: null,
    certifiedValues: null,
    status: 'active',
    isExpired: false,
    daysUntilExpiry: 100,
    ...overrides,
  }
}
