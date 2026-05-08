import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  Alert02Icon,
  Download01Icon,
  SentIcon,
  DropletIcon,
} from '@hugeicons/core-free-icons'
import { GaugeIcon, ThermometerIcon } from '@phosphor-icons/react'

import { api } from '@/utils/api'
import { apiRouteParam } from '@/lib/route-identifiers'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  TableInputRenderer,
  type CertifiedValueOption,
} from '@/components/method-runtime/table-input-renderer'
import {
  collectMassCompositionStandardIds,
  type MassCompositionOption,
} from '@/components/method-runtime/mass-composition-utils'
import {
  convertMassValue,
  denormalizeMethodDataForDisplay,
  denormalizeMethodResultsForDisplay,
  formatCalibrationValue,
  isMassMeasurementUnit,
  normalizeMethodDataForStorage,
  resolveMassDisplayUnit,
  type MassUnit,
} from '@calibra-facil/shared'
import {
  ECCENTRICITY_INDICATOR_SPEC_KEY,
  EccentricityIndicator,
  type EccentricityIndicatorVariant,
  isEccentricityIndicatorPosition,
} from '@/components/eccentricity-indicator'
import type {
  MethodInputField,
  MethodFormula,
  MethodValidation,
  MethodVariableBinding,
  FormulaResult,
  ValidationResult,
} from '@/components/method-runtime/types'
import {
  buildFormulaContext,
  createMethodCalculationEngine,
  evaluateFormulaScalar,
  evaluateStructuredValidation,
  normalizeMethodValidations,
  type FormulaContext,
  type FormulaScalar,
} from '@/components/method-runtime/math-runtime'

export const Route = createFileRoute('/dashboard/jobs/$id/execute')({
  head: () => ({
    meta: [{ title: 'Executar Calibração | CalibraFacil' }],
  }),
  component: ExecuteJobPage,
})

interface ReferenceStandard {
  id: number
  name: string
  serialNumber: string
  certificateNumber: string
  calibrationDate: string
  nextCalibrationDate: string
  uncertainty: number | null
  uncertaintyUnit: string | null
  coverageFactor: number
  distribution: string
  drift: number | null
  certifiedValues: Array<{
    nominal: string
    value: number
    uncertainty: number
    unit: string
    maxError?: number | null
    drift?: number | null
    buoyancy?: number | null
    coverageFactor?: number | null
    compositionProfile?: boolean
    profileKey?: string | null
    profileClass?: string | null
    profileQuantityAvailable?: number | null
  }> | null
  status: string
  isExpired: boolean
  daysUntilExpiry: number
}

interface StandardSnapshotItem {
  id: number
  name: string
  type?: string | null
  certificateNumber: string
  calibrationDate: string
  uncertainty: number | null
  uncertaintyUnit: string | null
  coverageFactor: number
  distribution: string
  drift: number | null
  certifiedValues: Array<{
    nominal: string
    value: number
    uncertainty: number
    unit: string
    maxError?: number | null
    drift?: number | null
    buoyancy?: number | null
    coverageFactor?: number | null
    compositionProfile?: boolean
    profileKey?: string | null
    profileClass?: string | null
    profileQuantityAvailable?: number | null
  }> | null
}

interface EnvironmentalSnapshotData {
  temperature: number | null
  humidity: number | null
  pressure: number | null
  recordedAt: string
  recordedBy: string
  limits: {
    temperature?: { min: number; max: number }
    humidity?: { min: number; max: number }
    pressure?: { min: number; max: number }
  } | null
  withinLimits: boolean
  outOfLimitsJustification: string | null
}

interface AssetSnapshot {
  assetId: number
  assetTypeId: number
  assetTypeName: string
  assetTypeSlug: string
  baseMeasurementUnit?: MassUnit | null
  name: string
  tag: string
  serialNumber: string
  manufacturer: string | null
  model: string | null
  specifications: Record<string, unknown> | null
  capturedAt: string
}

interface EffectiveLimits {
  temperatureMin: number | null
  temperatureMax: number | null
  humidityMin: number | null
  humidityMax: number | null
  pressureMin: number | null
  pressureMax: number | null
}

interface JobData {
  id: number
  jobId: string
  status: string
  customerName: string
  assetName: string
  assetTag: string
  unitId?: number | null
  assetTypeId: number
  serviceName: string
  methodSnapshot: {
    methodId: number
    methodName: string
    methodVersion: number
    compiledMethod?: CompiledMethodSnapshot | null
    methodFingerprint?: string | null
    engineVersion?: string | null
    engineOptionsFingerprint?: string | null
    normalizedMethodJson?: string | null
    publicationEvidence?: unknown
    dataFields: MethodInputField[]
    variableBindings?: MethodVariableBinding[]
    formulas: MethodFormula[]
    validations: MethodValidation[]
    uncertaintyParams: Array<unknown>
  }
  data: Record<string, unknown> | null
  results: Record<string, unknown> | null
  assetSnapshot?: AssetSnapshot | null
  standardsSnapshot?: StandardSnapshotItem[] | null
  environmentalSnapshot?: EnvironmentalSnapshotData | null
}

interface CompiledMethodSnapshot {
  methodFingerprint: string
  engine?: {
    version?: string
    optionsFingerprint?: string
  }
  formulas?: Array<{
    key: string
    label?: string
    expression: string
    normalizedFormula?: string
    formulaFingerprint?: string
    variables?: string[]
    outputUnit?: string
    reporting?: MethodFormula['reporting']
  }>
  acceptanceCriteria?: Array<{
    key: string
    label?: string
    expression: string
    severity: 'info' | 'warning' | 'blocking'
    message: string
    normalizedFormula?: string
    criterionFingerprint?: string
  }>
  measurementModels?: Array<unknown>
}

interface OfficialCompiledExecution {
  methodFingerprint?: string
  engineVersion?: string
  engineOptionsFingerprint?: string
  inputFingerprint?: string
  calculationFingerprint?: string
  resultFingerprint?: string
  diagnostics?: Array<unknown>
}

const statusLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  IN_PROGRESS: 'Em Execução',
  REVIEW: 'Em Revisão',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  CANCELED: 'Cancelado',
}

const CIRCULAR_ECCENTRICITY_LOAD_POSITIONS = ['A', 'B', 'C', 'D', 'E']

function normalizeText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function getEccentricityIndicatorVariant(
  field: MethodInputField | undefined,
): EccentricityIndicatorVariant | null {
  if (!field?.eccentricityIndicator?.enabled) return null
  return field.eccentricityIndicator.variant ?? 'circular_platform'
}

function getCircularEccentricityLoadPositions(
  field: MethodInputField,
  rows: Array<Record<string, unknown>>,
) {
  const positionColumn = field.columns?.find((column) => {
    const text = normalizeText(`${column.key} ${column.label}`)
    return text.includes('posicao') || text.includes('ponto')
  })

  if (!positionColumn) return undefined

  const positions: string[] = []
  for (const row of rows) {
    const value = String(row[positionColumn.key] ?? '')
      .trim()
      .toUpperCase()
    if (
      CIRCULAR_ECCENTRICITY_LOAD_POSITIONS.includes(value) &&
      !positions.includes(value)
    ) {
      positions.push(value)
    }
  }

  return positions.length > 0 ? positions : undefined
}

function getAssetIndicatorPosition(job: JobData) {
  const variant =
    getEccentricityIndicatorVariant(
      job.methodSnapshot.dataFields.find(
        (field) => field.eccentricityIndicator?.enabled,
      ),
    ) ?? undefined

  const assetValue =
    job.assetSnapshot?.specifications?.[ECCENTRICITY_INDICATOR_SPEC_KEY]
  if (isEccentricityIndicatorPosition(assetValue, variant)) {
    return assetValue
  }

  return null
}

function resolveFieldForDisplay(
  field: MethodInputField,
  baseMeasurementUnit: MassUnit | null | undefined,
): MethodInputField {
  if (!baseMeasurementUnit) {
    return field
  }

  return {
    ...field,
    unit: resolveMassDisplayUnit(baseMeasurementUnit, field.unit),
    weighingRangeResolver: field.weighingRangeResolver
      ? {
          ...field.weighingRangeResolver,
          pointUnit:
            (resolveMassDisplayUnit(
              baseMeasurementUnit,
              field.weighingRangeResolver.pointUnit,
            ) as MassUnit | undefined) ?? field.weighingRangeResolver.pointUnit,
        }
      : field.weighingRangeResolver,
    columns: field.columns?.map((column) => ({
      ...column,
      unit: resolveMassDisplayUnit(baseMeasurementUnit, column.unit),
      massComposition: column.massComposition
        ? {
            ...column.massComposition,
            targetUnit:
              column.massComposition.targetUnit &&
              isMassMeasurementUnit(column.massComposition.targetUnit)
                ? baseMeasurementUnit
                : column.massComposition.targetUnit,
          }
        : column.massComposition,
    })),
  }
}

function ExecuteJobPage() {
  const { id } = Route.useParams()
  const apiJobId = apiRouteParam(id)
  const engine = useMemo(() => createMethodCalculationEngine(), [])

  // Fetch job data
  const {
    data: job,
    isLoading: jobLoading,
    error: jobError,
  } = useQuery({
    queryKey: ['jobs', id],
    queryFn: async () => {
      const res = await api.api.jobs[':id'].$get({ param: { id: apiJobId } })
      if (!res.ok) throw new Error('Falha ao carregar job')
      return res.json() as Promise<JobData>
    },
  })

  // Fetch available standards
  const { data: standardsData } = useQuery({
    queryKey: ['standards', 'active'],
    queryFn: async () => {
      const res = await api.api.standards.$get({
        query: { status: 'ACTIVE', limit: '100' },
      })
      if (!res.ok) throw new Error('Falha ao carregar padrões')
      return res.json() as Promise<{ data: ReferenceStandard[] }>
    },
  })

  // Fetch effective environmental limits for this job's asset type
  const { data: envLimitsData } = useQuery({
    queryKey: [
      'environmental-limits',
      'effective',
      job?.assetTypeId,
      job?.unitId,
    ],
    queryFn: async () => {
      const res = await fetch(
        new URL(
          `/api/environmental-limits/effective/${job!.assetTypeId}?unitId=${job!.unitId}`,
          window.location.origin,
        ),
        {
          credentials: 'include',
        },
      )
      if (!res.ok) return { limits: null, source: null }
      return res.json() as Promise<{
        limits: EffectiveLimits | null
        source: string | null
      }>
    },
    enabled: !!job?.assetTypeId && !!job?.unitId,
    staleTime: 60000,
  })

  const envLimits = envLimitsData?.limits ?? null

  if (jobError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6">
          <p className="text-red-500">
            Erro ao carregar job: {jobError.message}
          </p>
        </div>
      </div>
    )
  }

  if (jobLoading || !job) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="size-8" />
      </div>
    )
  }

  return (
    <ExecuteJobForm
      key={job.id}
      job={job}
      standardsData={standardsData?.data ?? []}
      envLimits={envLimits}
      engine={engine}
      jobId={id}
    />
  )
}

function ExecuteJobForm({
  job,
  standardsData,
  envLimits,
  engine,
  jobId,
}: {
  job: JobData
  standardsData: Array<ReferenceStandard>
  envLimits: EffectiveLimits | null
  engine: ReturnType<typeof createMethodCalculationEngine>
  jobId: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const assetIndicatorPosition = getAssetIndicatorPosition(job)
  const assetBaseMeasurementUnit =
    job.assetSnapshot?.baseMeasurementUnit ?? null
  const displayUnitFor = useCallback(
    (unit?: string | null) =>
      resolveMassDisplayUnit(assetBaseMeasurementUnit, unit) ??
      unit ??
      undefined,
    [assetBaseMeasurementUnit],
  )
  const convertValueToDisplayUnit = useCallback(
    (value: number, unit?: string | null) => {
      if (!assetBaseMeasurementUnit || !isMassMeasurementUnit(unit)) {
        return value
      }

      return convertMassValue(value, unit, assetBaseMeasurementUnit) ?? value
    },
    [assetBaseMeasurementUnit],
  )
  const convertCanonicalValueToDisplayUnit = useCallback(
    (value: unknown, unit?: string | null) => {
      if (
        typeof value !== 'number' ||
        !assetBaseMeasurementUnit ||
        !isMassMeasurementUnit(unit)
      ) {
        return value
      }

      return convertMassValue(value, 'g', assetBaseMeasurementUnit) ?? value
    },
    [assetBaseMeasurementUnit],
  )

  // Form state
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    return (
      denormalizeMethodDataForDisplay(
        job.data ?? {},
        job.methodSnapshot.dataFields,
        assetBaseMeasurementUnit,
      ) ?? {}
    )
  })
  const [selectedStandardIds, setSelectedStandardIds] = useState<number[]>(
    () =>
      job.standardsSnapshot && job.standardsSnapshot.length > 0
        ? job.standardsSnapshot
            .map((s) => Number(s.id))
            .filter((standardId) => Number.isFinite(standardId))
        : [],
  )
  const [environment, setEnvironment] = useState<{
    temperature: number | null
    humidity: number | null
    pressure: number | null
  }>(() => ({
    temperature: job.environmentalSnapshot?.temperature ?? null,
    humidity: job.environmentalSnapshot?.humidity ?? null,
    pressure: job.environmentalSnapshot?.pressure ?? null,
  }))
  const [sectionsOpen, setSectionsOpen] = useState({
    standards: true,
    environment: true,
    data: true,
    results: true,
    validations: true,
    debug: false,
  })

  const assetSpecFields = useMemo(
    () =>
      job.methodSnapshot.dataFields.filter(
        (field) => field.source === 'asset_spec',
      ),
    [job.methodSnapshot.dataFields],
  )

  const manualFields = useMemo(
    () =>
      job.methodSnapshot.dataFields.filter(
        (field) => field.source !== 'asset_spec',
      ),
    [job.methodSnapshot.dataFields],
  )
  const displayManualFields = useMemo(
    () =>
      manualFields.map((field) =>
        resolveFieldForDisplay(field, assetBaseMeasurementUnit),
      ),
    [assetBaseMeasurementUnit, manualFields],
  )
  const displayAssetSpecFields = useMemo(
    () =>
      assetSpecFields.map((field) =>
        resolveFieldForDisplay(field, assetBaseMeasurementUnit),
      ),
    [assetBaseMeasurementUnit, assetSpecFields],
  )

  const hasMassCompositionColumns = useMemo(
    () =>
      job.methodSnapshot.dataFields.some(
        (field) =>
          field.type === 'table' &&
          field.columns?.some(
            (column) => column.role === 'mass_standard_composition',
          ),
      ),
    [job.methodSnapshot.dataFields],
  )

  const eccentricityFields = useMemo(
    () => manualFields.filter((field) => field.eccentricityIndicator?.enabled),
    [manualFields],
  )

  const eccentricityIndicatorField = eccentricityFields[0]
  const eccentricityIndicatorVariant = getEccentricityIndicatorVariant(
    eccentricityIndicatorField,
  )
  const showEccentricityIndicator = eccentricityIndicatorVariant !== null
  const selectedIndicatorPosition = isEccentricityIndicatorPosition(
    assetIndicatorPosition,
    eccentricityIndicatorVariant ?? undefined,
  )
    ? assetIndicatorPosition
    : null

  // Normalize form data before building formula context or sending payloads.
  const normalizeFormData = useCallback(
    (data: Record<string, unknown>): Record<string, unknown> => {
      const normalized: Record<string, unknown> = {}
      const manualKeys = new Set(manualFields.map((field) => field.key))
      for (const [key, value] of Object.entries(data)) {
        if (!manualKeys.has(key)) {
          continue
        }
        if (Array.isArray(value)) {
          normalized[key] = value.map((row) => {
            if (typeof row === 'object' && row !== null) {
              const normalizedRow: Record<string, unknown> = {}
              for (const [cellKey, cellValue] of Object.entries(
                row as Record<string, unknown>,
              )) {
                normalizedRow[cellKey] =
                  typeof cellValue === 'string' &&
                  /^-?\d*\.?\d+$/.test(cellValue)
                    ? parseFloat(cellValue)
                    : cellValue
              }
              return normalizedRow
            }
            return row
          })
        } else if (typeof value === 'string' && /^-?\d*\.?\d+$/.test(value)) {
          normalized[key] = parseFloat(value)
        } else {
          normalized[key] = value
        }
      }
      return normalized
    },
    [manualFields],
  )

  const parsedFormData = useMemo(
    () => normalizeFormData(formData),
    [formData, normalizeFormData],
  )

  const normalizedFormData = useMemo(() => {
    return (
      normalizeMethodDataForStorage(
        parsedFormData,
        job.methodSnapshot.dataFields,
        assetBaseMeasurementUnit,
      ).data ?? parsedFormData
    )
  }, [assetBaseMeasurementUnit, job.methodSnapshot.dataFields, parsedFormData])

  const missingAssetSpecFields = useMemo(
    () =>
      assetSpecFields.filter((field) => {
        if (!field.required) return false
        const key = field.assetSpecKey
        if (!key) return true
        const value = job.assetSnapshot?.specifications?.[key]
        return value === null || value === undefined || value === ''
      }),
    [assetSpecFields, job.assetSnapshot],
  )

  // Build scalar context for the hardened math engine.
  const context = useMemo<FormulaContext>(() => {
    if (!job) return {}

    const sourceData: Record<string, unknown> = {}

    for (const field of job.methodSnapshot.dataFields) {
      if (field.source === 'asset_spec') {
        const key = field.assetSpecKey
        const value = key ? job.assetSnapshot?.specifications?.[key] : undefined
        if (value !== undefined && value !== null && value !== '') {
          sourceData[field.key] = value
        }
        continue
      }

      const value = normalizedFormData[field.key]
      if (value !== undefined && value !== '') {
        sourceData[field.key] = value
      }
    }

    const selectedStandards = standardsData
      .filter((standard) => selectedStandardIds.includes(standard.id))
      .map((standard) => ({
        id: standard.id,
        uncertainty:
          standard.uncertainty != null &&
          isMassMeasurementUnit(standard.uncertaintyUnit)
            ? convertMassValue(
                standard.uncertainty,
                standard.uncertaintyUnit,
                'g',
              )
            : standard.uncertainty,
        coverageFactor: standard.coverageFactor,
        drift:
          standard.drift != null && standard.certifiedValues?.[0]?.unit
            ? (convertMassValue(
                standard.drift,
                standard.certifiedValues[0].unit,
                'g',
              ) ?? standard.drift)
            : standard.drift,
        certifiedValues:
          standard.certifiedValues?.map((certifiedValue) => ({
            nominal: certifiedValue.nominal,
            value: isMassMeasurementUnit(certifiedValue.unit)
              ? (convertMassValue(
                  certifiedValue.value,
                  certifiedValue.unit,
                  'g',
                ) ?? certifiedValue.value)
              : certifiedValue.value,
            uncertainty: isMassMeasurementUnit(certifiedValue.unit)
              ? (convertMassValue(
                  certifiedValue.uncertainty,
                  certifiedValue.unit,
                  'g',
                ) ?? certifiedValue.uncertainty)
              : certifiedValue.uncertainty,
          })) ?? null,
      }))

    return buildFormulaContext(job.methodSnapshot, {
      data: sourceData,
      environment,
      standards: selectedStandards,
    })
  }, [normalizedFormData, job, standardsData, selectedStandardIds, environment])

  const compiledMethod = job.methodSnapshot.compiledMethod ?? null
  const officialExecution = useMemo<OfficialCompiledExecution | null>(() => {
    const value = job.results?.__compiledExecution
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }

    return value as OfficialCompiledExecution
  }, [job.results])
  const officialDiagnosticCount = Array.isArray(officialExecution?.diagnostics)
    ? officialExecution.diagnostics.length
    : 0
  const calculationFormulas = useMemo<MethodFormula[]>(() => {
    const compiledFormulas = compiledMethod?.formulas
    if (compiledFormulas?.length) {
      return compiledFormulas.map((formula) => ({
        outputKey: formula.key,
        expression: formula.expression,
        label: formula.label,
        unit: formula.outputUnit,
        reporting: formula.reporting,
      }))
    }
    return job.methodSnapshot.formulas
  }, [compiledMethod, job.methodSnapshot.formulas])

  const calculationValidations = useMemo(() => {
    const compiledCriteria = compiledMethod?.acceptanceCriteria
    if (compiledCriteria?.length) {
      return compiledCriteria.map((criterion) => ({
        ...normalizeMethodValidations([
          {
            expression: criterion.expression,
            message: criterion.message,
            severity: criterion.severity === 'blocking' ? 'error' : 'warning',
          },
        ])[0],
        message: criterion.message,
        severity: criterion.severity === 'blocking' ? 'error' : 'warning',
      }))
    }
    return normalizeMethodValidations(job.methodSnapshot.validations)
  }, [compiledMethod, job.methodSnapshot.validations])

  // Evaluate formulas
  const formulaResults = useMemo(() => {
    if (!job) return {}

    const results: Record<string, FormulaResult> = {}
    const runningContext: FormulaContext = { ...context }
    const rawResultValues: Record<string, FormulaScalar> = {}

    for (const formula of calculationFormulas) {
      const result = evaluateFormulaScalar(
        engine,
        formula.expression,
        runningContext,
      )

      if (result.success) {
        const rawValue = result.value
        rawResultValues[formula.outputKey] = rawValue
        runningContext[formula.outputKey] = rawValue
      } else {
        results[formula.outputKey] = {
          error: result.error,
          errorCode: result.errorCode,
        }
      }
    }

    const displayResultValues =
      denormalizeMethodResultsForDisplay(
        rawResultValues,
        calculationFormulas,
        assetBaseMeasurementUnit,
      ) ?? rawResultValues

    for (const formula of calculationFormulas) {
      const rawValue = rawResultValues[formula.outputKey]
      if (rawValue === undefined) {
        continue
      }

      const displayValue = formatCalibrationValue(
        displayResultValues[formula.outputKey] ?? rawValue,
        {
          wrapArrays: true,
        },
      )

      results[formula.outputKey] = { value: rawValue, displayValue }
    }

    return results
  }, [assetBaseMeasurementUnit, engine, job, context, calculationFormulas])

  // Evaluate validations
  const validationResults = useMemo((): ValidationResult[] => {
    if (!job) return []

    const fullContext = { ...context }
    for (const [key, result] of Object.entries(formulaResults)) {
      if (result.value !== undefined) {
        fullContext[key] = result.value
      }
    }

    return calculationValidations.map((validation) => {
      const result = evaluateStructuredValidation(
        engine,
        validation,
        fullContext,
      )
      return {
        leftExpression: validation.leftExpression,
        operator: validation.operator,
        rightExpression: validation.rightExpression,
        message: validation.message,
        severity: validation.severity,
        passed: result.passed,
        error: result.error,
        errorCode: result.errorCode,
      }
    })
  }, [engine, job, context, formulaResults, calculationValidations])

  // Compute certified value options from all active standards
  const certifiedValueOptions = useMemo((): CertifiedValueOption[] => {
    const options: CertifiedValueOption[] = []

    for (const std of standardsData) {
      if (std.certifiedValues) {
        for (const cv of std.certifiedValues) {
          if (cv.compositionProfile) continue
          const displayValue = convertValueToDisplayUnit(cv.value, cv.unit)
          const displayUncertainty = convertValueToDisplayUnit(
            cv.uncertainty,
            cv.unit,
          )
          const displayUnit = displayUnitFor(cv.unit) ?? cv.unit
          options.push({
            label: cv.nominal,
            value: typeof displayValue === 'number' ? displayValue : cv.value,
            uncertainty:
              typeof displayUncertainty === 'number'
                ? displayUncertainty
                : cv.uncertainty,
            unit: displayUnit,
            standardName: std.name,
          })
        }
      }
    }
    return options
  }, [convertValueToDisplayUnit, displayUnitFor, standardsData])

  const massCompositionOptions = useMemo((): MassCompositionOption[] => {
    const individualOptions: MassCompositionOption[] = []
    const profileOptions = new Map<string, MassCompositionOption>()

    for (const std of standardsData) {
      if (!std.certifiedValues?.length) continue

      std.certifiedValues.forEach((cv, certifiedValueIndex) => {
        const coverageFactor = cv.coverageFactor ?? std.coverageFactor
        const drift = cv.drift ?? std.drift
        const isProfile = cv.compositionProfile === true
        const profileKey = cv.profileKey ?? cv.nominal
        const displayUnit = displayUnitFor(cv.unit) ?? cv.unit
        const displayValue = convertValueToDisplayUnit(cv.value, cv.unit)
        const displayUncertainty = convertValueToDisplayUnit(
          cv.uncertainty,
          cv.unit,
        )
        const displayMaxError =
          cv.maxError == null
            ? null
            : convertValueToDisplayUnit(cv.maxError, cv.unit)
        const displayDrift =
          drift == null ? null : convertValueToDisplayUnit(drift, cv.unit)
        const displayBuoyancy =
          cv.buoyancy == null
            ? null
            : convertValueToDisplayUnit(cv.buoyancy, cv.unit)

        if (isProfile) {
          const key = `${profileKey}:${displayUnit}`
          const existing = profileOptions.get(key)
          const existingIds = existing?.standardIds ?? []
          const standardIds = Array.from(new Set([...existingIds, std.id]))

          profileOptions.set(key, {
            standardId: standardIds[0] ?? std.id,
            standardIds,
            standardName: 'Perfil agregado',
            certificateNumber: 'Rastreabilidade via padrões selecionados',
            certifiedValueIndex,
            nominal: cv.nominal,
            value: typeof displayValue === 'number' ? displayValue : cv.value,
            uncertainty:
              typeof displayUncertainty === 'number'
                ? displayUncertainty
                : cv.uncertainty,
            unit: displayUnit,
            coverageFactor,
            maxError:
              typeof displayMaxError === 'number' ? displayMaxError : null,
            drift: typeof displayDrift === 'number' ? displayDrift : null,
            buoyancy:
              typeof displayBuoyancy === 'number' ? displayBuoyancy : null,
            compositionProfile: true,
            profileKey,
            profileClass: cv.profileClass ?? null,
            optionLabel: `${profileKey} - perfil agregado`,
          })
          return
        }

        individualOptions.push({
          standardId: std.id,
          standardName: std.name,
          certificateNumber: std.certificateNumber,
          certifiedValueIndex,
          nominal: cv.nominal,
          value: typeof displayValue === 'number' ? displayValue : cv.value,
          uncertainty:
            typeof displayUncertainty === 'number'
              ? displayUncertainty
              : cv.uncertainty,
          unit: displayUnit,
          coverageFactor,
          maxError:
            typeof displayMaxError === 'number' ? displayMaxError : null,
          drift: typeof displayDrift === 'number' ? displayDrift : null,
          buoyancy:
            typeof displayBuoyancy === 'number' ? displayBuoyancy : null,
          optionLabel: `${cv.nominal} - ${std.name} (${std.certificateNumber})`,
        })
      })
    }

    return [...individualOptions, ...profileOptions.values()]
  }, [convertValueToDisplayUnit, displayUnitFor, standardsData])

  // Update field
  const updateField = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Build environment payload (only send if any value is set)
  const environmentPayload = useMemo(() => {
    if (
      environment.temperature == null &&
      environment.humidity == null &&
      environment.pressure == null
    ) {
      return undefined
    }
    return environment
  }, [environment])

  const buildSelectedStandardPayload = useCallback(
    (normalizedData: Record<string, unknown>) =>
      Array.from(
        new Set([
          ...selectedStandardIds,
          ...collectMassCompositionStandardIds(normalizedData),
        ]),
      ),
    [selectedStandardIds],
  )

  // Compute environment warnings
  const envWarnings = useMemo(() => {
    const warnings: string[] = []
    if (envLimits && environment.temperature != null) {
      if (
        envLimits.temperatureMin != null &&
        envLimits.temperatureMax != null &&
        (environment.temperature < envLimits.temperatureMin ||
          environment.temperature > envLimits.temperatureMax)
      ) {
        warnings.push(
          `Temperatura fora da faixa (${envLimits.temperatureMin} – ${envLimits.temperatureMax} °C)`,
        )
      }
    }
    if (envLimits && environment.humidity != null) {
      if (
        envLimits.humidityMin != null &&
        envLimits.humidityMax != null &&
        (environment.humidity < envLimits.humidityMin ||
          environment.humidity > envLimits.humidityMax)
      ) {
        warnings.push(
          `Umidade fora da faixa (${envLimits.humidityMin} – ${envLimits.humidityMax} %RH)`,
        )
      }
    }
    if (envLimits && environment.pressure != null) {
      if (
        envLimits.pressureMin != null &&
        envLimits.pressureMax != null &&
        (environment.pressure < envLimits.pressureMin ||
          environment.pressure > envLimits.pressureMax)
      ) {
        warnings.push(
          `Pressão fora da faixa (${envLimits.pressureMin} – ${envLimits.pressureMax} hPa)`,
        )
      }
    }
    return warnings
  }, [environment, envLimits])

  // Save draft mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.jobs[':id'].execute.$post({
        param: { id: apiRouteParam(jobId) },
        json: {
          selectedStandardIds: buildSelectedStandardPayload(parsedFormData),
          data: parsedFormData,
          results: Object.fromEntries(
            Object.entries(formulaResults)
              .filter(([, r]) => r.value !== undefined)
              .map(([k, r]) => [k, r.value]),
          ),
          environment: environmentPayload,
        },
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error((error as { error?: string }).error || 'Erro ao salvar')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs', jobId] })
      toast.success('Dados salvos com sucesso!')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Submit for review mutation
  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.jobs[':id'].submit.$post({
        param: { id: apiRouteParam(jobId) },
        json: {
          selectedStandardIds: buildSelectedStandardPayload(parsedFormData),
          data: parsedFormData,
          results: Object.fromEntries(
            Object.entries(formulaResults)
              .filter(([, r]) => r.value !== undefined)
              .map(([k, r]) => [k, r.value]),
          ),
          environment: environmentPayload,
        },
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao submeter',
        )
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Job enviado para revisão!')
      navigate({ to: '/dashboard/jobs' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Render field
  const renderField = (field: MethodInputField) => {
    if (field.source === 'asset_spec') {
      return null
    }

    const value = formData[field.key]

    if (field.type === 'table') {
      const tableRenderer = (
        <Field key={field.key}>
          <FieldLabel>
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </FieldLabel>
          <TableInputRenderer
            field={field}
            value={(value as Array<Record<string, unknown>>) || []}
            onChange={(newValue) => updateField(field.key, newValue)}
            disabled={!isEditable}
            certifiedValueOptions={certifiedValueOptions}
            massCompositionOptions={massCompositionOptions}
            assetSpecifications={job.assetSnapshot?.specifications ?? null}
          />
        </Field>
      )

      const fieldEccentricityVariant = getEccentricityIndicatorVariant(field)
      if (fieldEccentricityVariant) {
        return (
          <div key={field.key} className="space-y-4">
            {tableRenderer}
            <EccentricityIndicator
              value={selectedIndicatorPosition}
              variant={fieldEccentricityVariant}
              loadPositions={
                fieldEccentricityVariant === 'circular_platform'
                  ? getCircularEccentricityLoadPositions(
                      field,
                      (value as Array<Record<string, unknown>>) || [],
                    )
                  : undefined
              }
              readOnly
              className="max-w-4xl"
            />
          </div>
        )
      }

      return tableRenderer
    }

    if (field.type === 'select' && field.options) {
      return (
        <Field key={field.key}>
          <FieldLabel>
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </FieldLabel>
          <Select
            value={(value as string) || ''}
            onValueChange={(v) => updateField(field.key, v)}
          >
            <SelectTrigger>
              <span>{(value as string) || 'Selecione...'}</span>
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )
    }

    if (field.type === 'number') {
      return (
        <Field key={field.key}>
          <FieldLabel>
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </FieldLabel>
          <div className="flex">
            <Input
              type="text"
              inputMode="decimal"
              value={value != null ? String(value) : ''}
              onChange={(e) => {
                const val = e.target.value
                // Allow empty, numbers, decimal points, and negative sign
                // Keep as string to preserve trailing decimals during typing
                if (val === '' || /^-?\d*[.,]?\d*$/.test(val)) {
                  // Normalize comma to period for consistency
                  const normalized = val.replace(',', '.')
                  updateField(field.key, normalized)
                }
              }}
              onBlur={(e) => {
                // Parse to number on blur if valid
                const val = e.target.value.replace(',', '.')
                if (val !== '' && val !== '-' && val !== '.') {
                  const parsed = parseFloat(val)
                  if (!isNaN(parsed)) {
                    updateField(field.key, parsed)
                  }
                }
              }}
              className={field.unit ? 'rounded-r-none' : ''}
            />
            {field.unit && (
              <span className="inline-flex items-center px-3 text-sm text-muted-foreground bg-muted border border-l-0 border-input rounded-r-md">
                {field.unit}
              </span>
            )}
          </div>
        </Field>
      )
    }

    return (
      <Field key={field.key}>
        <FieldLabel>
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </FieldLabel>
        <Input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => updateField(field.key, e.target.value)}
        />
      </Field>
    )
  }

  // Toggle standard selection
  const toggleStandard = (standardId: number) => {
    setSelectedStandardIds((prev) =>
      prev.includes(standardId)
        ? prev.filter((id) => id !== standardId)
        : [...prev, standardId],
    )
  }

  // Check if can submit
  const canSubmit = useMemo(() => {
    if (!job) return false
    const hasRequiredFields = manualFields
      .filter((f) => f.required)
      .every((f) => {
        const val = formData[f.key]
        return val !== undefined && val !== ''
      })
    const hasRequiredAssetSpecs = missingAssetSpecFields.length === 0
    const hasNoFormulaErrors = Object.values(formulaResults).every(
      (result) => !result.error,
    )
    const hasNoErrors = validationResults.every(
      (v) => v.severity !== 'error' || v.passed === true,
    )
    return (
      hasRequiredFields &&
      hasRequiredAssetSpecs &&
      hasNoFormulaErrors &&
      hasNoErrors
    )
  }, [
    job,
    manualFields,
    formData,
    missingAssetSpecFields,
    formulaResults,
    validationResults,
  ])

  const isEditable = ['DRAFT', 'IN_PROGRESS', 'REJECTED'].includes(job.status)
  const requiredFields = manualFields.filter((field) => field.required)
  const completedRequiredFields = requiredFields.filter((field) => {
    const value = formData[field.key]
    return value !== undefined && value !== ''
  })
  const formulaIssueCount = Object.values(formulaResults).filter(
    (result) => result.error,
  ).length
  const acceptanceIssueCount = validationResults.filter(
    (result) =>
      result.error || (result.severity === 'error' && result.passed === false),
  ).length
  const totalIssueCount =
    formulaIssueCount + acceptanceIssueCount + envWarnings.length
  const environmentStatus =
    envWarnings.length > 0
      ? 'Fora do limite'
      : environment.temperature != null ||
          environment.humidity != null ||
          environment.pressure != null
        ? 'Registrado'
        : 'Pendente'
  const assetSpecSummaryItems = displayAssetSpecFields.map((field) => {
    const rawValue = field.assetSpecKey
      ? job.assetSnapshot?.specifications?.[field.assetSpecKey]
      : undefined
    const value = convertCanonicalValueToDisplayUnit(rawValue, field.unit)

    return {
      key: field.key,
      label: field.label,
      unit: field.unit,
      value:
        value !== null && value !== undefined && value !== ''
          ? formatCalibrationValue(value)
          : '-',
    }
  })

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
      {/* Header */}
      <div className="space-y-5">
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: '/dashboard/jobs' })}
            className="-ml-2 min-h-10 transition-[background-color,color,transform] active:scale-[0.96]"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
            Voltar
          </Button>
        </div>

        <section className="flex flex-col gap-5 border-b border-black/5 px-1 pb-6 xl:flex-row xl:items-start xl:justify-between dark:border-white/10">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-balance font-mono text-2xl font-semibold tracking-tight text-foreground">
                {job.jobId}
              </h1>
              <Badge className="shadow-[0_8px_18px_rgba(37,99,235,0.18)]">
                {statusLabels[job.status]}
              </Badge>
            </div>
            <p className="max-w-3xl text-pretty text-sm text-muted-foreground">
              {job.customerName} · {job.assetName} ({job.assetTag})
            </p>

            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="h-7 rounded-lg px-2.5">
                <span className="text-muted-foreground">Padrões</span>
                <span className="tabular-nums">
                  {selectedStandardIds.length} selecionado(s)
                </span>
              </Badge>
              <Badge variant="secondary" className="h-7 rounded-lg px-2.5">
                <span className="text-muted-foreground">Ambiente</span>
                {environmentStatus}
              </Badge>
              <Badge variant="secondary" className="h-7 rounded-lg px-2.5">
                <span className="text-muted-foreground">Obrigatórios</span>
                <span className="tabular-nums">
                  {completedRequiredFields.length}/{requiredFields.length}
                </span>
              </Badge>
              <Badge
                variant={totalIssueCount > 0 ? 'destructive' : 'secondary'}
                className={`h-7 rounded-lg px-2.5 ${
                  totalIssueCount === 0
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : ''
                }`}
              >
                <span className="opacity-70">Alertas</span>
                <span className="tabular-nums">{totalIssueCount}</span>
              </Badge>
            </div>

            {assetSpecSummaryItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Características do instrumento
                </p>
                <div className="flex flex-wrap gap-2">
                  {assetSpecSummaryItems.map((item) => (
                    <span
                      key={item.key}
                      className="inline-flex min-h-8 items-center gap-2 rounded-lg bg-muted/50 px-2.5 text-sm shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]"
                    >
                      <span className="text-muted-foreground">
                        {item.label}
                      </span>
                      <span className="font-mono tabular-nums">
                        {item.value}
                        {item.unit && (
                          <span className="ml-1 font-sans text-xs text-muted-foreground">
                            {item.unit}
                          </span>
                        )}
                      </span>
                    </span>
                  ))}
                </div>
                {missingAssetSpecFields.length > 0 && (
                  <div className="space-y-1">
                    {missingAssetSpecFields.map((field) => (
                      <p key={field.key} className="text-sm text-red-600">
                        O ativo não possui a especificação obrigatória "
                        {field.label}".
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {isEditable && (
            <div className="flex flex-col gap-2 sm:flex-row xl:pt-10">
              <Button
                variant="outline"
                onClick={() => saveMutation.mutate()}
                disabled={
                  saveMutation.isPending || missingAssetSpecFields.length > 0
                }
                className="h-10 justify-center px-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)] active:scale-[0.96]"
              >
                <HugeiconsIcon icon={Download01Icon} className="mr-2 h-4 w-4" />
                {saveMutation.isPending ? 'Salvando...' : 'Salvar Rascunho'}
              </Button>
              <Button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending || !canSubmit}
                className="h-10 justify-center px-3 shadow-[0_12px_28px_rgba(37,99,235,0.22)] active:scale-[0.96]"
              >
                <HugeiconsIcon icon={SentIcon} className="mr-2 h-4 w-4" />
                {submitMutation.isPending
                  ? 'Enviando...'
                  : 'Enviar para Revisão'}
              </Button>
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* Left Column: Data Entry */}
        <div className="min-w-0 space-y-5">
          {/* Reference Standards */}
          <Card className="rounded-2xl border-0 py-0 shadow-[0_16px_50px_rgba(15,23,42,0.06),0_1px_0_rgba(15,23,42,0.04)] ring-1 ring-black/5 dark:ring-white/10">
            <Collapsible
              open={sectionsOpen.standards}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, standards: open }))
              }
            >
              <CollapsibleTrigger className="group w-full text-left outline-none">
                <CardHeader className="min-h-16 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-balance text-base">
                      Padrões de Referência
                      {selectedStandardIds.length > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          {selectedStandardIds.length} selecionado(s)
                        </Badge>
                      )}
                    </CardTitle>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 transition-transform duration-200 ${sectionsOpen.standards ? 'rotate-180' : ''}`}
                    />
                  </div>
                  <CardDescription className="max-w-3xl text-pretty">
                    {hasMassCompositionColumns
                      ? 'Selecione padrões usados fora da composição de pesos, como estação meteorológica, termohigrômetro ou barômetro. Pesos escolhidos em Composição dos pesos entram automaticamente no certificado.'
                      : 'Selecione os padrões usados nesta calibração'}
                  </CardDescription>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="px-5 pb-5 pt-0">
                  <div className="grid gap-2 lg:grid-cols-2">
                    {standardsData.map((std) => (
                      <button
                        type="button"
                        key={std.id}
                        disabled={std.isExpired}
                        className={`min-h-16 rounded-xl px-4 py-3 text-left shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)] transition-[background-color,box-shadow,transform,opacity] active:scale-[0.96] ${
                          selectedStandardIds.includes(std.id)
                            ? 'bg-primary/5 ring-1 ring-primary shadow-[0_12px_30px_rgba(37,99,235,0.10)]'
                            : 'bg-background hover:bg-muted/40 hover:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08),0_10px_28px_rgba(15,23,42,0.05)]'
                        } ${std.isExpired ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                        onClick={() => !std.isExpired && toggleStandard(std.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <span className="block truncate font-medium">
                              {std.name}
                            </span>
                            <p className="mt-1 truncate text-xs text-muted-foreground tabular-nums">
                              Cert: {std.certificateNumber}
                              {std.uncertainty != null &&
                                ` | U: ${formatCalibrationValue(
                                  convertValueToDisplayUnit(
                                    std.uncertainty,
                                    std.uncertaintyUnit,
                                  ),
                                )} ${displayUnitFor(std.uncertaintyUnit) || ''}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {std.isExpired ? (
                              <Badge variant="destructive">Vencido</Badge>
                            ) : std.daysUntilExpiry <= 30 ? (
                              <Badge
                                variant="outline"
                                className="text-amber-600"
                              >
                                Vence em {std.daysUntilExpiry}d
                              </Badge>
                            ) : null}
                            {selectedStandardIds.includes(std.id) && (
                              <HugeiconsIcon
                                icon={CheckmarkCircle02Icon}
                                className="h-5 w-5 text-primary"
                              />
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Environmental Conditions */}
          <Card className="rounded-2xl border-0 py-0 shadow-[0_16px_50px_rgba(15,23,42,0.06),0_1px_0_rgba(15,23,42,0.04)] ring-1 ring-black/5 dark:ring-white/10">
            <Collapsible
              open={sectionsOpen.environment}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, environment: open }))
              }
            >
              <CollapsibleTrigger className="group w-full text-left outline-none">
                <CardHeader className="min-h-16 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-balance text-base">
                      Condições Ambientais
                      {envWarnings.length > 0 && (
                        <Badge variant="destructive" className="ml-2">
                          Fora dos limites
                        </Badge>
                      )}
                    </CardTitle>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 transition-transform duration-200 ${sectionsOpen.environment ? 'rotate-180' : ''}`}
                    />
                  </div>
                  <CardDescription className="text-pretty">
                    Registre temperatura, umidade e pressão do ambiente
                  </CardDescription>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-4 px-5 pb-5 pt-0">
                  {envWarnings.length > 0 && (
                    <div className="rounded-xl bg-amber-50 p-3 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.25)] dark:bg-amber-950">
                      {envWarnings.map((w, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200"
                        >
                          <HugeiconsIcon
                            icon={Alert02Icon}
                            className="h-4 w-4 shrink-0"
                          />
                          {w}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field>
                      <FieldLabel className="flex items-center gap-1.5">
                        <ThermometerIcon
                          size={14}
                          className="text-orange-500"
                        />
                        Temperatura
                      </FieldLabel>
                      <div className="flex">
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder={
                            envLimits?.temperatureMin != null
                              ? `${envLimits.temperatureMin}–${envLimits.temperatureMax}`
                              : 'Ex: 23.0'
                          }
                          value={
                            environment.temperature != null
                              ? String(environment.temperature)
                              : ''
                          }
                          onChange={(e) => {
                            const val = e.target.value.replace(',', '.')
                            if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                              setEnvironment((prev) => ({
                                ...prev,
                                temperature:
                                  val === '' ? null : Number(val) || null,
                              }))
                            }
                          }}
                          onBlur={(e) => {
                            const val = e.target.value.replace(',', '.')
                            if (val !== '' && val !== '-' && val !== '.') {
                              const parsed = parseFloat(val)
                              if (!isNaN(parsed)) {
                                setEnvironment((prev) => ({
                                  ...prev,
                                  temperature: parsed,
                                }))
                              }
                            }
                          }}
                          disabled={!isEditable}
                          className="rounded-r-none"
                        />
                        <span className="inline-flex items-center px-3 text-sm text-muted-foreground bg-muted border border-l-0 border-input rounded-r-md">
                          °C
                        </span>
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel className="flex items-center gap-1.5">
                        <HugeiconsIcon
                          icon={DropletIcon}
                          className="h-3.5 w-3.5 text-blue-500"
                        />
                        Umidade
                      </FieldLabel>
                      <div className="flex">
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder={
                            envLimits?.humidityMin != null
                              ? `${envLimits.humidityMin}–${envLimits.humidityMax}`
                              : 'Ex: 50.0'
                          }
                          value={
                            environment.humidity != null
                              ? String(environment.humidity)
                              : ''
                          }
                          onChange={(e) => {
                            const val = e.target.value.replace(',', '.')
                            if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                              setEnvironment((prev) => ({
                                ...prev,
                                humidity:
                                  val === '' ? null : Number(val) || null,
                              }))
                            }
                          }}
                          onBlur={(e) => {
                            const val = e.target.value.replace(',', '.')
                            if (val !== '' && val !== '-' && val !== '.') {
                              const parsed = parseFloat(val)
                              if (!isNaN(parsed)) {
                                setEnvironment((prev) => ({
                                  ...prev,
                                  humidity: parsed,
                                }))
                              }
                            }
                          }}
                          disabled={!isEditable}
                          className="rounded-r-none"
                        />
                        <span className="inline-flex items-center px-3 text-sm text-muted-foreground bg-muted border border-l-0 border-input rounded-r-md">
                          %RH
                        </span>
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel className="flex items-center gap-1.5">
                        <GaugeIcon size={14} className="text-purple-500" />
                        Pressão
                      </FieldLabel>
                      <div className="flex">
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder={
                            envLimits?.pressureMin != null
                              ? `${envLimits.pressureMin}–${envLimits.pressureMax}`
                              : 'Ex: 1013.0'
                          }
                          value={
                            environment.pressure != null
                              ? String(environment.pressure)
                              : ''
                          }
                          onChange={(e) => {
                            const val = e.target.value.replace(',', '.')
                            if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                              setEnvironment((prev) => ({
                                ...prev,
                                pressure:
                                  val === '' ? null : Number(val) || null,
                              }))
                            }
                          }}
                          onBlur={(e) => {
                            const val = e.target.value.replace(',', '.')
                            if (val !== '' && val !== '-' && val !== '.') {
                              const parsed = parseFloat(val)
                              if (!isNaN(parsed)) {
                                setEnvironment((prev) => ({
                                  ...prev,
                                  pressure: parsed,
                                }))
                              }
                            }
                          }}
                          disabled={!isEditable}
                          className="rounded-r-none"
                        />
                        <span className="inline-flex items-center px-3 text-sm text-muted-foreground bg-muted border border-l-0 border-input rounded-r-md">
                          hPa
                        </span>
                      </div>
                    </Field>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Data Entry Form */}
          <Card className="rounded-2xl border-0 py-0 shadow-[0_16px_50px_rgba(15,23,42,0.06),0_1px_0_rgba(15,23,42,0.04)] ring-1 ring-black/5 dark:ring-white/10">
            <Collapsible
              open={sectionsOpen.data}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, data: open }))
              }
            >
              <CollapsibleTrigger className="group w-full text-left outline-none">
                <CardHeader className="min-h-16 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-balance text-base">
                      Dados de Medição ({manualFields.length})
                    </CardTitle>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 transition-transform duration-200 ${sectionsOpen.data ? 'rotate-180' : ''}`}
                    />
                  </div>
                  <CardDescription className="text-pretty">
                    {job.methodSnapshot.methodName} v
                    {job.methodSnapshot.methodVersion}
                  </CardDescription>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-5 px-5 pb-5 pt-0">
                  {showEccentricityIndicator &&
                    eccentricityFields.length === 0 && (
                      <EccentricityIndicator
                        value={selectedIndicatorPosition}
                        variant={eccentricityIndicatorVariant}
                        readOnly
                      />
                    )}
                  {displayManualFields.map(renderField)}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>

        {/* Right Column: Results & Validations */}
        <div className="min-w-0 space-y-5 xl:sticky xl:top-4 xl:self-start">
          {officialExecution ? (
            <Card className="rounded-2xl border-0 shadow-[0_16px_50px_rgba(15,23,42,0.06),0_1px_0_rgba(15,23,42,0.04)] ring-1 ring-black/5 dark:ring-white/10">
              <CardHeader className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-balance text-base">
                    Execução oficial
                  </CardTitle>
                  <Badge
                    variant={
                      officialDiagnosticCount > 0 ? 'outline' : 'secondary'
                    }
                  >
                    {officialDiagnosticCount} diagnóstico
                    {officialDiagnosticCount === 1 ? '' : 's'}
                  </Badge>
                </div>
                <CardDescription>
                  Resultado persistido pelo backend para o método compilado.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 px-5 pb-5 pt-0 text-xs">
                {[
                  ['Method', officialExecution.methodFingerprint],
                  ['Input', officialExecution.inputFingerprint],
                  ['Calculation', officialExecution.calculationFingerprint],
                  ['Result', officialExecution.resultFingerprint],
                  ['Engine', officialExecution.engineVersion],
                  ['Engine options', officialExecution.engineOptionsFingerprint],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 rounded-lg bg-muted/40 px-2 py-1.5"
                  >
                    <span className="font-medium text-muted-foreground">
                      {label}
                    </span>
                    <span className="min-w-0 overflow-hidden font-mono [overflow-wrap:anywhere]">
                      {value || '-'}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {/* Formula Results */}
          <Card className="rounded-2xl border-0 py-0 shadow-[0_16px_50px_rgba(15,23,42,0.06),0_1px_0_rgba(15,23,42,0.04)] ring-1 ring-black/5 dark:ring-white/10">
            <Collapsible
              open={sectionsOpen.results}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, results: open }))
              }
            >
              <CollapsibleTrigger className="group w-full text-left outline-none">
                <CardHeader className="min-h-14 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-balance text-base">
                      Resultados ({calculationFormulas.length})
                    </CardTitle>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 transition-transform duration-200 ${sectionsOpen.results ? 'rotate-180' : ''}`}
                    />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="max-h-[560px] space-y-2 overflow-auto px-5 pb-5 pt-0">
                  {calculationFormulas.map((formula) => {
                    const result = formulaResults[formula.outputKey]
                    return (
                      <div
                        key={formula.outputKey}
                        className={`rounded-xl px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] transition-[background-color,box-shadow] ${
                          result?.error
                            ? 'bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-200'
                            : 'bg-muted/40 hover:bg-background hover:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07),0_8px_24px_rgba(15,23,42,0.05)]'
                        }`}
                      >
                        <div className="grid min-w-0 gap-1.5">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <span className="min-w-0 text-pretty text-sm font-medium leading-snug">
                              {formula.label || formula.outputKey}
                            </span>
                            {result?.error && (
                              <Badge variant="destructive">Erro</Badge>
                            )}
                          </div>
                          {result?.error ? (
                            <p className="text-pretty text-xs text-red-600 dark:text-red-300">
                              {result.error}
                            </p>
                          ) : result?.value !== undefined ? (
                            <span className="block max-w-full overflow-hidden rounded-lg bg-background/80 px-2 py-1 font-mono text-sm leading-relaxed tabular-nums [overflow-wrap:anywhere]">
                              {result.displayValue}
                              {displayUnitFor(formula.unit) && (
                                <span className="text-xs text-muted-foreground ml-1">
                                  {displayUnitFor(formula.unit)}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              -
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Validations */}
          <Card className="rounded-2xl border-0 py-0 shadow-[0_16px_50px_rgba(15,23,42,0.06),0_1px_0_rgba(15,23,42,0.04)] ring-1 ring-black/5 dark:ring-white/10">
            <Collapsible
              open={sectionsOpen.validations}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, validations: open }))
              }
            >
              <CollapsibleTrigger className="group w-full text-left outline-none">
                <CardHeader className="min-h-14 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-balance text-base">
                      Critérios de Aceitação ({validationResults.length})
                    </CardTitle>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 transition-transform duration-200 ${sectionsOpen.validations ? 'rotate-180' : ''}`}
                    />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-2 px-5 pb-5 pt-0">
                  {validationResults.map((result, idx) => (
                    <div
                      key={idx}
                      className={`rounded-xl px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] ${
                        result.error
                          ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                          : result.passed
                            ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
                            : result.severity === 'error'
                              ? 'bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-200'
                              : 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {result.error ? (
                          <Badge variant="outline">Erro</Badge>
                        ) : result.passed ? (
                          <HugeiconsIcon
                            icon={CheckmarkCircle02Icon}
                            className="h-4 w-4 text-green-600"
                          />
                        ) : (
                          <HugeiconsIcon
                            icon={Alert02Icon}
                            className={`h-4 w-4 ${result.severity === 'error' ? 'text-red-600' : 'text-amber-600'}`}
                          />
                        )}
                        <span className="text-pretty text-sm">
                          {result.message}
                        </span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Debug Context */}
          <Card className="rounded-2xl border-0 py-0 shadow-[0_16px_50px_rgba(15,23,42,0.06),0_1px_0_rgba(15,23,42,0.04)] ring-1 ring-black/5 dark:ring-white/10">
            <Collapsible
              open={sectionsOpen.debug}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, debug: open }))
              }
            >
              <CollapsibleTrigger className="group w-full text-left outline-none">
                <CardHeader className="min-h-14 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base text-muted-foreground">
                      Debug: Contexto
                    </CardTitle>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${sectionsOpen.debug ? 'rotate-180' : ''}`}
                    />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="px-5 pb-5 pt-0">
                  <pre className="max-h-48 overflow-auto rounded-xl bg-muted p-3 text-xs">
                    {JSON.stringify(context, null, 2)}
                  </pre>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>
      </div>
    </div>
  )
}
