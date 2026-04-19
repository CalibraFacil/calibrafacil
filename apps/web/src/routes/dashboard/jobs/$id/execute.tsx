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
  ThermometerIcon,
  DropletIcon,
  CompassIcon,
} from '@hugeicons/core-free-icons'
import { createEngine, flattenForExecution } from '@calibra-facil/math-engine'
import type { FormulaContext } from '@calibra-facil/math-engine'

import { api } from '@/utils/api'
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
} from '@/components/method-builder/table-input-renderer'
import {
  collectMassCompositionStandardIds,
  type MassCompositionOption,
} from '@/components/method-builder/mass-composition-utils'
import { formatCalibrationValue } from '@calibra-facil/shared'
import {
  ECCENTRICITY_INDICATOR_SPEC_KEY,
  EccentricityIndicator,
  type EccentricityIndicatorVariant,
  type EccentricityIndicatorPosition,
  isEccentricityIndicatorPosition,
} from '@/components/eccentricity-indicator'
import type {
  MethodInputField,
  MethodFormula,
  FormulaResult,
  ValidationResult,
} from '@/components/method-builder/types'

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
    dataFields: MethodInputField[]
    formulas: MethodFormula[]
    validations: Array<{
      expression: string
      message: string
      severity: 'error' | 'warning'
    }>
    uncertaintyParams: Array<unknown>
  }
  data: Record<string, unknown> | null
  results: Record<string, unknown> | null
  assetSnapshot?: AssetSnapshot | null
  standardsSnapshot?: StandardSnapshotItem[] | null
  environmentalSnapshot?: EnvironmentalSnapshotData | null
}

const statusLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  IN_PROGRESS: 'Em Execução',
  REVIEW: 'Em Revisão',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  CANCELED: 'Cancelado',
}

function getEccentricityIndicatorVariant(
  field: MethodInputField | undefined,
): EccentricityIndicatorVariant | null {
  if (!field?.eccentricityIndicator?.enabled) return null
  return field.eccentricityIndicator.variant ?? 'circular_platform'
}

function getInitialIndicatorPosition(job: JobData) {
  const variant =
    getEccentricityIndicatorVariant(
      job.methodSnapshot.dataFields.find(
        (field) => field.eccentricityIndicator?.enabled,
      ),
    ) ?? undefined

  const savedValue = job.data?.[ECCENTRICITY_INDICATOR_SPEC_KEY]
  if (isEccentricityIndicatorPosition(savedValue, variant)) {
    return savedValue
  }

  const assetValue =
    job.assetSnapshot?.specifications?.[ECCENTRICITY_INDICATOR_SPEC_KEY]
  if (isEccentricityIndicatorPosition(assetValue, variant)) {
    return assetValue
  }

  return null
}

function ExecuteJobPage() {
  const { id } = Route.useParams()
  // Math engine
  const engine = useMemo(() => createEngine(), [])

  // Fetch job data
  const {
    data: job,
    isLoading: jobLoading,
    error: jobError,
  } = useQuery({
    queryKey: ['jobs', id],
    queryFn: async () => {
      const res = await api.api.jobs[':id'].$get({ param: { id } })
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
  engine: ReturnType<typeof createEngine>
  jobId: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const initialIndicatorPosition = getInitialIndicatorPosition(job)

  // Form state
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    const initialData = job.data ?? {}

    return initialIndicatorPosition
      ? {
          ...initialData,
          [ECCENTRICITY_INDICATOR_SPEC_KEY]: initialIndicatorPosition,
        }
      : initialData
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
    assetSpecs: true,
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
    formData[ECCENTRICITY_INDICATOR_SPEC_KEY],
    eccentricityIndicatorVariant ?? undefined,
  )
    ? formData[ECCENTRICITY_INDICATOR_SPEC_KEY]
    : null

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

  // Build context for math engine (including standard values)
  const context = useMemo(() => {
    if (!job) return {}

    const processedData: Record<string, unknown> = {}

    // Process form data fields
    for (const field of job.methodSnapshot.dataFields) {
      if (field.source === 'asset_spec') {
        const key = field.assetSpecKey
        const value = key ? job.assetSnapshot?.specifications?.[key] : undefined
        if (value !== undefined && value !== null && value !== '') {
          processedData[field.key] = value
        }
        continue
      }

      const value = formData[field.key]

      if (field.type === 'table' && field.columns) {
        const rows = Array.isArray(value) ? value : []
        for (const col of field.columns) {
          const columnValues = rows
            .map((row: Record<string, unknown>) => {
              const cellValue = row[col.key]
              if (typeof cellValue === 'number') return cellValue
              if (typeof cellValue === 'string' && cellValue.trim() !== '') {
                const parsed = parseFloat(cellValue)
                return isNaN(parsed) ? null : parsed
              }
              return null
            })
            .filter((v): v is number => v !== null)
          processedData[`${field.key}_${col.key}`] = columnValues
        }
        processedData[field.key] = rows
      } else if (value !== undefined && value !== '') {
        processedData[field.key] = value
      }
    }

    // Inject selected standard values into context
    const selectedStandards = standardsData.filter((s) =>
      selectedStandardIds.includes(s.id),
    )

    for (const std of selectedStandards) {
      const prefix = `std_${std.id}`
      processedData[`${prefix}_uncertainty`] = std.uncertainty
      processedData[`${prefix}_k`] = std.coverageFactor
      processedData[`${prefix}_drift`] = std.drift

      // Flatten certified values for easy formula access
      if (std.certifiedValues) {
        for (const cv of std.certifiedValues) {
          // Normalize nominal name (e.g., "100g" -> "100g")
          const key = cv.nominal.replace(/\s+/g, '')
          processedData[`${prefix}_${key}`] = cv.value
          processedData[`${prefix}_${key}_u`] = cv.uncertainty
        }
      }
    }

    // Inject environment data for formula context
    if (environment.temperature != null) {
      processedData['env_temperature'] = environment.temperature
    }
    if (environment.humidity != null) {
      processedData['env_humidity'] = environment.humidity
    }
    if (environment.pressure != null) {
      processedData['env_pressure'] = environment.pressure
    }

    return flattenForExecution(processedData, { preserveArrays: true })
  }, [formData, job, standardsData, selectedStandardIds, environment])

  // Evaluate formulas
  const formulaResults = useMemo(() => {
    if (!job) return {}

    const results: Record<string, FormulaResult> = {}
    const runningContext: Record<string, unknown> = { ...context }

    for (const formula of job.methodSnapshot.formulas) {
      const result = engine.evaluateFormula({
        formula: formula.expression,
        context: runningContext as FormulaContext,
      })

      if (result.success) {
        const rawValue = result.data.result
        const displayValue = formatCalibrationValue(rawValue, {
          wrapArrays: true,
        })

        results[formula.outputKey] = { value: rawValue, displayValue }
        runningContext[formula.outputKey] = rawValue
      } else {
        results[formula.outputKey] = { error: result.error.message }
      }
    }

    return results
  }, [engine, job, context])

  // Evaluate validations
  const validationResults = useMemo((): ValidationResult[] => {
    if (!job) return []

    const fullContext: Record<string, unknown> = { ...context }
    for (const [key, result] of Object.entries(formulaResults)) {
      if (result.value !== undefined) {
        fullContext[key] = result.value
      }
    }

    return job.methodSnapshot.validations.map((validation) => {
      const result = engine.evaluateFormula({
        formula: validation.expression,
        context: fullContext as FormulaContext,
      })

      if (result.success) {
        const passed = Boolean(result.data.resultAsNumber)
        return {
          expression: validation.expression,
          message: validation.message,
          severity: validation.severity,
          passed,
        }
      }
      return {
        expression: validation.expression,
        message: validation.message,
        severity: validation.severity,
        error: result.error.message,
      }
    })
  }, [engine, job, context, formulaResults])

  // Compute certified value options from all active standards
  const certifiedValueOptions = useMemo((): CertifiedValueOption[] => {
    const options: CertifiedValueOption[] = []

    for (const std of standardsData) {
      if (std.certifiedValues) {
        for (const cv of std.certifiedValues) {
          if (cv.compositionProfile) continue
          options.push({
            label: cv.nominal,
            value: cv.value,
            uncertainty: cv.uncertainty,
            unit: cv.unit,
            standardName: std.name,
          })
        }
      }
    }
    return options
  }, [standardsData])

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

        if (isProfile) {
          const key = `${profileKey}:${cv.unit}`
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
            value: cv.value,
            uncertainty: cv.uncertainty,
            unit: cv.unit,
            coverageFactor,
            maxError: cv.maxError ?? null,
            drift: drift ?? null,
            buoyancy: cv.buoyancy ?? null,
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
          value: cv.value,
          uncertainty: cv.uncertainty,
          unit: cv.unit,
          coverageFactor,
          maxError: cv.maxError ?? null,
          drift: drift ?? null,
          buoyancy: cv.buoyancy ?? null,
          optionLabel: `${cv.nominal} - ${std.name} (${std.certificateNumber})`,
        })
      })
    }

    return [...individualOptions, ...profileOptions.values()]
  }, [standardsData])

  // Update field
  const updateField = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }, [])

  const updateIndicatorPosition = useCallback(
    (position: EccentricityIndicatorPosition | null) => {
      setFormData((prev) => {
        const next = { ...prev }

        if (position) {
          next[ECCENTRICITY_INDICATOR_SPEC_KEY] = position
        } else {
          delete next[ECCENTRICITY_INDICATOR_SPEC_KEY]
        }

        return next
      })
    },
    [],
  )

  // Normalize form data: convert string numbers to actual numbers before API calls
  const normalizeFormData = useCallback(
    (data: Record<string, unknown>): Record<string, unknown> => {
      const normalized: Record<string, unknown> = {}
      const manualKeys = new Set(manualFields.map((field) => field.key))
      for (const [key, value] of Object.entries(data)) {
        if (
          !manualKeys.has(key) &&
          !(
            showEccentricityIndicator && key === ECCENTRICITY_INDICATOR_SPEC_KEY
          )
        ) {
          continue
        }
        if (key === ECCENTRICITY_INDICATOR_SPEC_KEY) {
          if (
            isEccentricityIndicatorPosition(
              value,
              eccentricityIndicatorVariant ?? undefined,
            )
          ) {
            normalized[key] = value
          }
          continue
        }
        if (Array.isArray(value)) {
          // Handle table data - normalize each row
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
    [manualFields, showEccentricityIndicator, eccentricityIndicatorVariant],
  )

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
      const normalizedData = normalizeFormData(formData)
      const res = await api.api.jobs[':id'].execute.$post({
        param: { id: jobId },
        json: {
          selectedStandardIds: buildSelectedStandardPayload(normalizedData),
          data: normalizedData,
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
      const normalizedData = normalizeFormData(formData)
      const res = await api.api.jobs[':id'].submit.$post({
        param: { id: jobId },
        json: {
          selectedStandardIds: buildSelectedStandardPayload(normalizedData),
          data: normalizedData,
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
              onChange={updateIndicatorPosition}
              variant={fieldEccentricityVariant}
              disabled={!isEditable}
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
    const hasNoErrors = validationResults.every(
      (v) => v.severity !== 'error' || v.passed === true,
    )
    return hasRequiredFields && hasRequiredAssetSpecs && hasNoErrors
  }, [job, manualFields, formData, missingAssetSpecFields, validationResults])

  const isEditable = ['DRAFT', 'IN_PROGRESS', 'REJECTED'].includes(job.status)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: '/dashboard/jobs' })}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <div>
            <h1 className="text-xl font-bold">{job.jobId}</h1>
            <p className="text-sm text-muted-foreground">
              {job.customerName} • {job.assetName} ({job.assetTag})
            </p>
          </div>
          <Badge>{statusLabels[job.status]}</Badge>
        </div>

        {isEditable && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending || missingAssetSpecFields.length > 0
              }
            >
              <HugeiconsIcon icon={Download01Icon} className="mr-2 h-4 w-4" />
              {saveMutation.isPending ? 'Salvando...' : 'Salvar Rascunho'}
            </Button>
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending || !canSubmit}
            >
              <HugeiconsIcon icon={SentIcon} className="mr-2 h-4 w-4" />
              {submitMutation.isPending ? 'Enviando...' : 'Enviar para Revisão'}
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column: Data Entry */}
        <div className="lg:col-span-2 space-y-4">
          {/* Reference Standards */}
          <Card>
            <Collapsible
              open={sectionsOpen.standards}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, standards: open }))
              }
            >
              <CollapsibleTrigger className="w-full">
                <CardHeader className="cursor-pointer">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      Padrões de Referência
                      {selectedStandardIds.length > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          {selectedStandardIds.length} selecionado(s)
                        </Badge>
                      )}
                    </CardTitle>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 transition-transform ${sectionsOpen.standards ? 'rotate-180' : ''}`}
                    />
                  </div>
                  <CardDescription>
                    {hasMassCompositionColumns
                      ? 'Selecione padrões usados fora da composição de pesos, como estação meteorológica, termohigrômetro ou barômetro. Pesos escolhidos em Composição dos pesos entram automaticamente no certificado.'
                      : 'Selecione os padrões usados nesta calibração'}
                  </CardDescription>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <div className="grid gap-2">
                    {standardsData.map((std) => (
                      <div
                        key={std.id}
                        className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                          selectedStandardIds.includes(std.id)
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-muted/50'
                        } ${std.isExpired ? 'opacity-50' : ''}`}
                        onClick={() => !std.isExpired && toggleStandard(std.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium">{std.name}</span>
                            <p className="text-xs text-muted-foreground">
                              Cert: {std.certificateNumber}
                              {std.uncertainty != null &&
                                ` | U: ${std.uncertainty} ${std.uncertaintyUnit || ''}`}
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
                      </div>
                    ))}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Environmental Conditions */}
          <Card>
            <Collapsible
              open={sectionsOpen.environment}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, environment: open }))
              }
            >
              <CollapsibleTrigger className="w-full">
                <CardHeader className="cursor-pointer">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      Condições Ambientais
                      {envWarnings.length > 0 && (
                        <Badge variant="destructive" className="ml-2">
                          Fora dos limites
                        </Badge>
                      )}
                    </CardTitle>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 transition-transform ${sectionsOpen.environment ? 'rotate-180' : ''}`}
                    />
                  </div>
                  <CardDescription>
                    Registre temperatura, umidade e pressão do ambiente
                  </CardDescription>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 space-y-4">
                  {envWarnings.length > 0 && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Field>
                      <FieldLabel className="flex items-center gap-1.5">
                        <HugeiconsIcon
                          icon={ThermometerIcon}
                          className="h-3.5 w-3.5 text-orange-500"
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
                        <HugeiconsIcon
                          icon={CompassIcon}
                          className="h-3.5 w-3.5 text-purple-500"
                        />
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

          {assetSpecFields.length > 0 && (
            <Card>
              <Collapsible
                open={sectionsOpen.assetSpecs}
                onOpenChange={(open) =>
                  setSectionsOpen((s) => ({ ...s, assetSpecs: open }))
                }
              >
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="cursor-pointer">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        Características do instrumento usadas no cálculo
                        {missingAssetSpecFields.length > 0 && (
                          <Badge variant="destructive" className="ml-2">
                            Incompleto
                          </Badge>
                        )}
                      </CardTitle>
                      <HugeiconsIcon
                        icon={ArrowDown01Icon}
                        className={`h-4 w-4 transition-transform ${sectionsOpen.assetSpecs ? 'rotate-180' : ''}`}
                      />
                    </div>
                    <CardDescription>
                      Dados carregados do cadastro do ativo e congelados no job.
                    </CardDescription>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-3">
                    {missingAssetSpecFields.map((field) => (
                      <div
                        key={field.key}
                        className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                      >
                        O ativo não possui a especificação obrigatória "
                        {field.label}". Atualize o cadastro do ativo antes de
                        executar a calibração.
                      </div>
                    ))}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {assetSpecFields.map((field) => {
                        const value = field.assetSpecKey
                          ? job.assetSnapshot?.specifications?.[
                              field.assetSpecKey
                            ]
                          : undefined
                        return (
                          <div
                            key={field.key}
                            className="rounded-md border p-3"
                          >
                            <p className="text-xs text-muted-foreground">
                              {field.label}
                            </p>
                            <p className="font-mono text-sm">
                              {value !== null &&
                              value !== undefined &&
                              value !== ''
                                ? formatCalibrationValue(value)
                                : '-'}
                              {field.unit && (
                                <span className="text-xs text-muted-foreground ml-1">
                                  {field.unit}
                                </span>
                              )}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          )}

          {/* Data Entry Form */}
          <Card>
            <Collapsible
              open={sectionsOpen.data}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, data: open }))
              }
            >
              <CollapsibleTrigger className="w-full">
                <CardHeader className="cursor-pointer">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      Dados de Medição ({manualFields.length})
                    </CardTitle>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 transition-transform ${sectionsOpen.data ? 'rotate-180' : ''}`}
                    />
                  </div>
                  <CardDescription>
                    {job.methodSnapshot.methodName} v
                    {job.methodSnapshot.methodVersion}
                  </CardDescription>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 space-y-4">
                  {showEccentricityIndicator &&
                    eccentricityFields.length === 0 && (
                      <EccentricityIndicator
                        value={selectedIndicatorPosition}
                        onChange={updateIndicatorPosition}
                        variant={eccentricityIndicatorVariant}
                        disabled={!isEditable}
                      />
                    )}
                  {manualFields.map(renderField)}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>

        {/* Right Column: Results & Validations */}
        <div className="space-y-4">
          {/* Formula Results */}
          <Card>
            <Collapsible
              open={sectionsOpen.results}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, results: open }))
              }
            >
              <CollapsibleTrigger className="w-full">
                <CardHeader className="cursor-pointer">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      Resultados ({job.methodSnapshot.formulas.length})
                    </CardTitle>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 transition-transform ${sectionsOpen.results ? 'rotate-180' : ''}`}
                    />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 space-y-2">
                  {job.methodSnapshot.formulas.map((formula) => {
                    const result = formulaResults[formula.outputKey]
                    return (
                      <div
                        key={formula.outputKey}
                        className="p-2 border rounded"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">
                            {formula.label || formula.outputKey}
                          </span>
                          {result?.error ? (
                            <Badge variant="destructive">Erro</Badge>
                          ) : result?.value !== undefined ? (
                            <span className="font-mono text-sm">
                              {result.displayValue}
                              {formula.unit && (
                                <span className="text-xs text-muted-foreground ml-1">
                                  {formula.unit}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                        {result?.error && (
                          <p className="text-xs text-red-500 mt-1">
                            {result.error}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Validations */}
          <Card>
            <Collapsible
              open={sectionsOpen.validations}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, validations: open }))
              }
            >
              <CollapsibleTrigger className="w-full">
                <CardHeader className="cursor-pointer">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      Critérios de Aceitação (
                      {job.methodSnapshot.validations.length})
                    </CardTitle>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 transition-transform ${sectionsOpen.validations ? 'rotate-180' : ''}`}
                    />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 space-y-2">
                  {validationResults.map((result, idx) => (
                    <div
                      key={idx}
                      className={`p-2 border rounded ${
                        result.error
                          ? 'bg-amber-50 border-amber-200'
                          : result.passed
                            ? 'bg-green-50 border-green-200'
                            : result.severity === 'error'
                              ? 'bg-red-50 border-red-200'
                              : 'bg-amber-50 border-amber-200'
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
                        <span className="text-sm">{result.message}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Debug Context */}
          <Card>
            <Collapsible
              open={sectionsOpen.debug}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, debug: open }))
              }
            >
              <CollapsibleTrigger className="w-full">
                <CardHeader className="cursor-pointer">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base text-muted-foreground">
                      Debug: Contexto
                    </CardTitle>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 text-muted-foreground transition-transform ${sectionsOpen.debug ? 'rotate-180' : ''}`}
                    />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-48">
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
