import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  Alert02Icon,
  SentIcon,
  DropletIcon,
} from '@hugeicons/core-free-icons'
import { GaugeIcon, ThermometerIcon } from '@phosphor-icons/react'

import { calibraApi } from '@/utils/api'
import { apiRouteParam } from '@/lib/route-identifiers'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { type DatePickerPreset } from '@/components/ui/date-picker'
import { SaveButton } from '@/components/ui/save-button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { BlueprintOverlay, Panel } from '@/components/instrument-panel'
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
import type { MassCompositionOption } from '@/components/method-runtime/mass-composition-utils'
import {
  convertMassValue,
  denormalizeAssetSpecificationsForDisplay,
  denormalizeMethodDataForDisplay,
  denormalizeWeighingRangeSpecsForDisplay,
  formatCalibrationValue,
  isMassMeasurementUnit,
  normalizeMethodDataForStorage,
  resolveMassDisplayUnit,
  type AssetSpecificationFieldLike,
} from '@calibra-facil/shared'
import { EccentricityIndicator } from '@/components/eccentricity-indicator'
import type {
  MethodInputField,
  MethodFormula,
  ValidationResult,
} from '@/components/method-runtime/types'
import { createMethodCalculationEngine } from '@/components/method-runtime/math-runtime'
import {
  shouldReturnToSyncConflicts,
  SyncConflictReturnNotice,
  type SyncConflictReturnSearch,
} from '@/runtime/sync-conflict-return'
import {
  useActiveReferenceStandardsData,
  useEffectiveEnvironmentalLimitsData,
  useJobDetailData,
} from '@/features/jobs/queries'
import {
  collectPhaseBlocks,
  buildCertifiedValueOptions,
  buildCalibrationLocationPayload,
  buildCalibrationPhasesPayload,
  buildEnvironmentPayload,
  buildEnvironmentWarnings,
  buildExecutionMutationPayload,
  buildExecutionFormulaContext,
  buildMassCompositionOptions,
  canSubmitExecution,
  defaultCalibrationPhases,
  evaluateExecutionFormulaResults,
  evaluateExecutionValidationResults,
  DEFAULT_PHASE_MODE,
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
  JOB_STATUS_LABELS,
  normalizeExecutionFormData,
  phaseBlockKey,
  phaseModeLabel,
  previewFormulaErrorMessage,
  resolveFieldForDisplay,
  resolveSelectedIndicatorPosition,
  type CalibrationLocationSnapshot,
  type CalibrationLocationType,
  type CalibrationPhaseMode,
  type CalibrationPhaseSnapshot,
  type EffectiveLimits,
  type JobData,
  type ReferenceStandard,
} from '@/features/jobs/execution'

const BACKDATE_REASON_THRESHOLD_DAYS = 7
const MS_PER_DAY = 1000 * 60 * 60 * 24

function formatDateForInput(date: Date): string {
  // Local Y/M/D, not toISOString() — a local-midnight calendar date east of UTC
  // would otherwise shift to the previous day and record the wrong calibration date.
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const PERFORMED_AT_PRESETS: readonly DatePickerPreset[] = [
  { label: 'Hoje', getDate: () => new Date() },
  { label: 'Ontem', getDate: () => new Date(Date.now() - MS_PER_DAY) },
  {
    label: 'Há 3 dias',
    getDate: () => new Date(Date.now() - 3 * MS_PER_DAY),
  },
  {
    label: 'Há uma semana',
    getDate: () => new Date(Date.now() - 7 * MS_PER_DAY),
  },
]

type ExecuteJobPageProps = {
  id: string
  conflictReturn: SyncConflictReturnSearch
}

function toAssetSpecificationFieldDefinition(
  field: MethodInputField,
): Array<AssetSpecificationFieldLike> {
  if (
    !field.assetSpecKey ||
    (field.type !== 'number' &&
      field.type !== 'text' &&
      field.type !== 'select')
  ) {
    return []
  }

  return [
    {
      key: field.assetSpecKey,
      type: field.type,
      unit: field.unit,
    },
  ]
}

function toCalibrationPhaseMode(value: unknown): CalibrationPhaseMode {
  switch (value) {
    case 'before_only':
    case 'after_only':
    case 'not_performed':
    case 'before_and_after':
      return value
    default:
      return DEFAULT_PHASE_MODE
  }
}

function toCalibrationLocationType(value: unknown): CalibrationLocationType {
  switch (value) {
    case 'customer_site':
    case 'lab':
    case 'other':
      return value
    default:
      return 'customer_site'
  }
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }

    return [Object.fromEntries(Object.entries(item))]
  })
}

function toStringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function formatContextValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return String(value)
  }
  return JSON.stringify(value)
}

export function ExecuteJobPage({ id, conflictReturn }: ExecuteJobPageProps) {
  const apiJobId = apiRouteParam(id)
  const engine = useMemo(() => createMethodCalculationEngine(), [])

  const {
    data: job,
    isLoading: jobLoading,
    error: jobError,
  } = useJobDetailData<JobData>({
    id,
    apiJobId,
  })

  const { data: standardsData } =
    useActiveReferenceStandardsData<ReferenceStandard>()

  const { data: envLimitsData } =
    useEffectiveEnvironmentalLimitsData<EffectiveLimits>({
      assetTypeId: job?.assetTypeId,
      unitId: job?.unitId,
      enabled: !!job?.assetTypeId && !!job?.unitId,
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
      conflictReturn={conflictReturn}
    />
  )
}

function ExecuteJobForm({
  job,
  standardsData,
  envLimits,
  engine,
  jobId,
  conflictReturn,
}: {
  job: JobData
  standardsData: Array<ReferenceStandard>
  envLimits: EffectiveLimits | null
  engine: ReturnType<typeof createMethodCalculationEngine>
  jobId: string
  conflictReturn: SyncConflictReturnSearch
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
  const [calibrationLocation, setCalibrationLocation] =
    useState<CalibrationLocationSnapshot>(() => {
      const existing = job.calibrationLocationSnapshot
      if (existing?.addressText) return existing
      const customerAddress = formatAddress(job.customerAddress)
      const labAddress = formatLabAddress(job)
      const type: CalibrationLocationType = customerAddress
        ? 'customer_site'
        : labAddress
          ? 'lab'
          : 'other'
      return {
        type,
        addressText:
          type === 'customer_site'
            ? customerAddress
            : type === 'lab'
              ? labAddress
              : '',
      }
    })
  const [calibrationPhases, setCalibrationPhases] =
    useState<CalibrationPhaseSnapshot>(() =>
      defaultCalibrationPhases(
        job.methodSnapshot.dataFields,
        job.calibrationPhaseSnapshot,
      ),
    )
  const [sectionsOpen, setSectionsOpen] = useState({
    standards: false,
    location: true,
    environment: true,
    data: true,
    results: true,
    validations: true,
    debug: false,
  })
  // Starts empty so the operator makes a deliberate choice of execution date.
  const [performedAt, setPerformedAt] = useState<string>('')
  const [backdateReason, setBackdateReason] = useState('')

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
  const phaseBlocks = useMemo(
    () => collectPhaseBlocks(manualFields),
    [manualFields],
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
  const displayAssetSpecificationDefinition = useMemo(
    () =>
      assetSpecFields.flatMap((field) =>
        toAssetSpecificationFieldDefinition(field),
      ),
    [assetSpecFields],
  )
  const displayAssetSpecifications = useMemo(() => {
    const rawSpecifications = job.assetSnapshot?.specifications ?? null
    const denormalized =
      denormalizeAssetSpecificationsForDisplay(
        rawSpecifications,
        displayAssetSpecificationDefinition,
        assetBaseMeasurementUnit,
      ) ?? rawSpecifications

    if (!denormalized || !assetBaseMeasurementUnit) {
      return denormalized
    }

    return {
      ...denormalized,
      weighingRanges: denormalizeWeighingRangeSpecsForDisplay(
        rawSpecifications?.weighingRanges,
        assetBaseMeasurementUnit,
      ),
    }
  }, [
    assetBaseMeasurementUnit,
    displayAssetSpecificationDefinition,
    job.assetSnapshot?.specifications,
  ])

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
  const selectedIndicatorPosition = resolveSelectedIndicatorPosition(
    assetIndicatorPosition,
    eccentricityIndicatorVariant,
  )

  // Normalize form data before building formula context or sending payloads.
  const normalizeFormData = useCallback(
    (data: Record<string, unknown>) =>
      normalizeExecutionFormData({
        data,
        manualFields,
        displayManualFields,
        displayAssetSpecifications,
      }),
    [displayAssetSpecifications, displayManualFields, manualFields],
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

  const selectedStandardsMissingCertificatePdf = useMemo(() => {
    const standardsById = new Map(
      standardsData.map((standard) => [standard.id, standard]),
    )
    return selectedStandardIds
      .map((standardId) => standardsById.get(standardId))
      .filter((standard): standard is ReferenceStandard => {
        if (!standard) return false
        return !standard.certificateDocument
      })
  }, [selectedStandardIds, standardsData])

  // Build scalar context for the hardened math engine.
  const context = useMemo(
    () =>
      buildExecutionFormulaContext({
        job,
        normalizedFormData,
        standardsData,
        selectedStandardIds,
        environment,
      }),
    [environment, job, normalizedFormData, selectedStandardIds, standardsData],
  )

  const officialExecution = useMemo(
    () => getOfficialCompiledExecution(job.results),
    [job.results],
  )
  const officialDiagnosticCount = Array.isArray(officialExecution?.diagnostics)
    ? officialExecution.diagnostics.length
    : 0
  const hasOfficialResults = officialExecution !== null
  const calculationFormulas = useMemo<MethodFormula[]>(
    () => getCalculationFormulas(job),
    [job],
  )

  const activeCalculationFormulas = useMemo(
    () => filterActiveCalculationItems(calculationFormulas, calibrationPhases),
    [calculationFormulas, calibrationPhases],
  )

  const calculationValidations = useMemo(
    () => getCalculationValidations(job),
    [job],
  )

  const activeCalculationValidations = useMemo(
    () =>
      filterActiveCalculationItems(calculationValidations, calibrationPhases),
    [calculationValidations, calibrationPhases],
  )

  // Evaluate formulas
  const formulaResults = useMemo(
    () =>
      evaluateExecutionFormulaResults({
        engine,
        job,
        context,
        normalizedFormData,
        activeCalculationFormulas,
        assetBaseMeasurementUnit,
      }),
    [
      activeCalculationFormulas,
      assetBaseMeasurementUnit,
      context,
      engine,
      job,
      normalizedFormData,
    ],
  )

  const displayedFormulaResults = useMemo(
    () =>
      getDisplayedFormulaResults({
        activeCalculationFormulas,
        assetBaseMeasurementUnit,
        formulaResults,
        jobResults: job.results,
      }),
    [
      activeCalculationFormulas,
      assetBaseMeasurementUnit,
      formulaResults,
      job.results,
    ],
  )

  // Evaluate validations
  const validationResults = useMemo(
    (): ValidationResult[] =>
      evaluateExecutionValidationResults({
        engine,
        context,
        formulaResults,
        activeCalculationValidations,
      }),
    [activeCalculationValidations, context, engine, formulaResults],
  )

  // Compute certified value options from all active standards
  const certifiedValueOptions = useMemo(
    (): CertifiedValueOption[] =>
      buildCertifiedValueOptions({
        standardsData,
        convertValueToDisplayUnit,
        displayUnitFor,
      }),
    [convertValueToDisplayUnit, displayUnitFor, standardsData],
  )

  const massCompositionOptions = useMemo(
    (): MassCompositionOption[] =>
      buildMassCompositionOptions({
        standardsData,
        convertValueToDisplayUnit,
        displayUnitFor,
      }),
    [convertValueToDisplayUnit, displayUnitFor, standardsData],
  )

  // Update field
  const updateField = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Build environment payload (only send if any value is set)
  const environmentPayload = useMemo(
    () => buildEnvironmentPayload(environment),
    [environment],
  )
  const calibrationLocationPayload = useMemo(
    () => buildCalibrationLocationPayload(calibrationLocation),
    [calibrationLocation],
  )
  const calibrationPhasesPayload = useMemo(
    () =>
      buildCalibrationPhasesPayload({
        phaseBlocks,
        calibrationPhases,
      }),
    [calibrationPhases, phaseBlocks],
  )
  const missingNotPerformedPhaseReasons = useMemo(
    () =>
      findMissingNotPerformedPhaseReasons({
        phaseBlocks,
        calibrationPhases,
      }),
    [calibrationPhases, phaseBlocks],
  )

  const updateCalibrationPhase = useCallback(
    (
      blockKey: string,
      patch: Partial<CalibrationPhaseSnapshot['blocks'][string]>,
    ) => {
      setCalibrationPhases((prev) => ({
        ...prev,
        blocks: {
          ...prev.blocks,
          [blockKey]: {
            mode: prev.blocks[blockKey]?.mode ?? DEFAULT_PHASE_MODE,
            reason: prev.blocks[blockKey]?.reason ?? null,
            ...patch,
          },
        },
      }))
    },
    [],
  )

  // Compute environment warnings
  const envWarnings = useMemo(
    () => buildEnvironmentWarnings({ environment, envLimits }),
    [environment, envLimits],
  )

  // Save draft mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.jobs.saveExecution(
        apiRouteParam(jobId),
        buildExecutionMutationPayload({
          selectedStandardIds,
          normalizedData: parsedFormData,
          formulaResults,
          environment: environmentPayload,
          calibrationLocation: calibrationLocationPayload,
          calibrationPhases: calibrationPhasesPayload,
        }),
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs', jobId] })
      toast.success('Dados salvos com sucesso!')
      if (shouldReturnToSyncConflicts(conflictReturn)) {
        navigate({ to: '/dashboard/sync/conflicts' })
      }
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Submit for review mutation
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (missingNotPerformedPhaseReasons.length > 0) {
        throw new Error(
          'Informe o motivo dos blocos marcados como não executados.',
        )
      }
      return calibraApi.jobs.submitExecution(
        apiRouteParam(jobId),
        buildExecutionMutationPayload({
          selectedStandardIds,
          normalizedData: parsedFormData,
          formulaResults,
          environment: environmentPayload,
          calibrationLocation: calibrationLocationPayload,
          calibrationPhases: calibrationPhasesPayload,
          performedAt: new Date(`${performedAt}T12:00:00`).toISOString(),
          backdateReason: backdateReason.trim() || undefined,
        }),
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Job enviado para revisão!')
      if (shouldReturnToSyncConflicts(conflictReturn)) {
        navigate({ to: '/dashboard/sync/conflicts' })
        return
      }
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
      const blockKey = phaseBlockKey(field)
      const blockMode = blockKey
        ? (calibrationPhases.blocks[blockKey]?.mode ?? DEFAULT_PHASE_MODE)
        : DEFAULT_PHASE_MODE
      const tableRenderer = (
        <Field key={field.key}>
          <FieldLabel>
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </FieldLabel>
          {blockKey && (
            <div className="mb-3 grid gap-3 md:grid-cols-[220px_1fr]">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Etapas executadas
                </label>
                <Select
                  value={blockMode}
                  onValueChange={(mode) =>
                    updateCalibrationPhase(blockKey, {
                      mode: toCalibrationPhaseMode(mode),
                    })
                  }
                  disabled={!isEditable}
                >
                  <SelectTrigger>
                    <span>{phaseModeLabel(blockMode)}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="before_and_after">
                      Antes e após
                    </SelectItem>
                    <SelectItem value="before_only">Somente antes</SelectItem>
                    <SelectItem value="after_only">Somente após</SelectItem>
                    <SelectItem value="not_performed">Não executado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {blockMode !== 'before_and_after' && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    {blockMode === 'not_performed'
                      ? 'Motivo do bloco não executado'
                      : 'Motivo da etapa não aplicável'}
                  </label>
                  <Input
                    value={calibrationPhases.blocks[blockKey]?.reason ?? ''}
                    onChange={(event) =>
                      updateCalibrationPhase(blockKey, {
                        reason: event.target.value,
                      })
                    }
                    disabled={!isEditable}
                    placeholder={
                      blockMode === 'not_performed'
                        ? 'Ex.: equipamento em manutenção'
                        : 'Ex.: equipamento já estava conforme'
                    }
                  />
                  {blockMode === 'not_performed' &&
                    !calibrationPhases.blocks[blockKey]?.reason?.trim() && (
                      <p className="text-xs text-red-600">
                        Motivo obrigatório para enviar à revisão.
                      </p>
                    )}
                </div>
              )}
            </div>
          )}
          <TableInputRenderer
            field={field}
            value={toRecordArray(value)}
            onChange={(newValue) => updateField(field.key, newValue)}
            disabled={!isEditable}
            certifiedValueOptions={certifiedValueOptions}
            massCompositionOptions={massCompositionOptions}
            assetSpecifications={displayAssetSpecifications}
            phaseMode={blockMode}
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
                      toRecordArray(value),
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
            value={toStringValue(value)}
            onValueChange={(v) => updateField(field.key, v)}
          >
            <SelectTrigger>
              <span>{toStringValue(value) || 'Selecione...'}</span>
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
          value={toStringValue(value)}
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

  // Backdate handling for the performed (execution) date
  const performedDate = performedAt ? new Date(`${performedAt}T00:00:00`) : null
  const isPerformedDateValid =
    performedDate != null &&
    !Number.isNaN(performedDate.getTime()) &&
    performedDate.getTime() <= Date.now()
  const backdateDays =
    performedDate && !Number.isNaN(performedDate.getTime())
      ? Math.floor((Date.now() - performedDate.getTime()) / MS_PER_DAY)
      : 0
  const requiresBackdateReason = backdateDays > BACKDATE_REASON_THRESHOLD_DAYS
  const isBackdateReasonSatisfied =
    !requiresBackdateReason || backdateReason.trim().length > 0

  // Check if can submit
  const meetsExecutionRequirements = useMemo(
    () =>
      canSubmitExecution({
        manualFields,
        formData,
        calibrationPhases,
        missingAssetSpecFields,
        calibrationLocation,
        missingNotPerformedPhaseReasons,
      }),
    [
      manualFields,
      formData,
      calibrationPhases,
      missingAssetSpecFields,
      calibrationLocation,
      missingNotPerformedPhaseReasons,
    ],
  )
  const canSubmit =
    meetsExecutionRequirements &&
    isPerformedDateValid &&
    isBackdateReasonSatisfied

  const isEditable = isExecutionEditable(job.status)
  const requiredFields = manualFields.filter((field) => field.required)
  const completedRequiredFields = requiredFields.filter((field) => {
    const value = formData[field.key]
    return value !== undefined && value !== ''
  })
  const requiredCompletionPercent =
    requiredFields.length > 0
      ? Math.round(
          (completedRequiredFields.length / requiredFields.length) * 100,
        )
      : 100
  const requiredComplete =
    requiredFields.length > 0 &&
    completedRequiredFields.length >= requiredFields.length
  const formulaIssueCount = Object.values(formulaResults).filter(
    (result) => result.error,
  ).length
  const acceptanceIssueCount = validationResults.filter(
    (result) =>
      result.error || (result.severity === 'error' && result.passed === false),
  ).length
  const totalIssueCount =
    formulaIssueCount +
    acceptanceIssueCount +
    envWarnings.length +
    missingNotPerformedPhaseReasons.length
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
      <SyncConflictReturnNotice search={conflictReturn} />
      {/* Header */}
      <Panel className="relative overflow-hidden p-5 sm:p-6">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-4">
            <div>
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Calibração · Execução
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-3">
                <h1 className="text-balance font-mono text-2xl font-semibold tracking-tight text-foreground">
                  {job.jobId}
                </h1>
                <Badge>{JOB_STATUS_LABELS[job.status]}</Badge>
              </div>
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

            {requiredFields.length > 0 && (
              <div className="max-w-md space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium">
                    Campos obrigatórios preenchidos
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {completedRequiredFields.length}/{requiredFields.length} ·{' '}
                    {requiredCompletionPercent}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                      requiredComplete ? 'bg-emerald-500' : 'bg-primary'
                    }`}
                    style={{ width: `${requiredCompletionPercent}%` }}
                  />
                </div>
              </div>
            )}

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
              <SaveButton
                idleText="Salvar Rascunho"
                savedText="Salvo"
                disabled={missingAssetSpecFields.length > 0}
                onSave={() => saveMutation.mutateAsync()}
              />
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
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* Left Column: Data Entry */}
        <div className="min-w-0 space-y-5">
          {/* Calibration date */}
          <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
            <CardHeader className="px-5 py-4">
              <CardTitle className="text-base">Data da calibração</CardTitle>
              <CardDescription>
                Informe a data real de execução da calibração.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-5">
              <Field>
                <FieldLabel>Data realizada</FieldLabel>
                <DateInput
                  value={
                    performedDate && !Number.isNaN(performedDate.getTime())
                      ? performedDate
                      : undefined
                  }
                  disabled={!isEditable}
                  onChange={(date) =>
                    setPerformedAt(date ? formatDateForInput(date) : '')
                  }
                  max={formatDateForInput(new Date())}
                  presets={PERFORMED_AT_PRESETS}
                  calendarProps={{ disabled: { after: new Date() } }}
                />
              </Field>
              {requiresBackdateReason && (
                <Field>
                  <FieldLabel>
                    Motivo do registro retroativo ({backdateDays} dias)
                  </FieldLabel>
                  <Input
                    type="text"
                    value={backdateReason}
                    disabled={!isEditable}
                    onChange={(e) => setBackdateReason(e.target.value)}
                    placeholder="Descreva o motivo do lançamento retroativo"
                  />
                </Field>
              )}
            </CardContent>
          </Card>

          {/* Reference Standards */}
          <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
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
                  {selectedStandardsMissingCertificatePdf.length > 0 && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                      {selectedStandardsMissingCertificatePdf.length === 1
                        ? `O padrão ${selectedStandardsMissingCertificatePdf[0]?.name} ainda não possui PDF do certificado original.`
                        : `${selectedStandardsMissingCertificatePdf.length} padrões selecionados ainda não possuem PDF do certificado original.`}
                    </div>
                  )}
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
                              {!std.certificateDocument && ' | PDF pendente'}
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

          {/* Calibration Location */}
          <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
            <Collapsible
              open={sectionsOpen.location}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, location: open }))
              }
            >
              <CollapsibleTrigger className="group w-full text-left outline-none">
                <CardHeader className="min-h-16 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-balance text-base">
                      Local da Calibração
                      {calibrationLocation.addressText.trim() && (
                        <Badge variant="secondary" className="ml-2">
                          Registrado
                        </Badge>
                      )}
                    </CardTitle>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 transition-transform duration-200 ${sectionsOpen.location ? 'rotate-180' : ''}`}
                    />
                  </div>
                  <CardDescription className="max-w-3xl text-pretty">
                    Informe se a calibração foi realizada no cliente, no
                    laboratório ou em outro local. O valor será congelado no
                    certificado.
                  </CardDescription>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="grid gap-4 px-5 pb-5 pt-0 md:grid-cols-[240px_minmax(0,1fr)]">
                  <Field>
                    <FieldLabel>Tipo</FieldLabel>
                    <Select
                      value={calibrationLocation.type}
                      onValueChange={(value) => {
                        const type = toCalibrationLocationType(value)
                        const customerAddress = formatAddress(
                          job.customerAddress,
                        )
                        const labAddress = formatLabAddress(job)
                        setCalibrationLocation((current) => ({
                          ...current,
                          type,
                          addressText:
                            type === 'customer_site'
                              ? customerAddress
                              : type === 'lab'
                                ? labAddress
                                : '',
                        }))
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <span>
                          {calibrationLocation.type === 'customer_site'
                            ? 'No cliente'
                            : calibrationLocation.type === 'lab'
                              ? 'No laboratório'
                              : 'Outro'}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="customer_site">
                          No cliente
                        </SelectItem>
                        <SelectItem value="lab">No laboratório</SelectItem>
                        <SelectItem value="other">Outro</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Endereço/local</FieldLabel>
                    <Input
                      value={calibrationLocation.addressText}
                      onChange={(event) =>
                        setCalibrationLocation((current) => ({
                          ...current,
                          addressText: event.target.value,
                        }))
                      }
                      placeholder="Endereço ou descrição do local"
                    />
                  </Field>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Environmental Conditions */}
          <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
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
          <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
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
            <Card className="rounded-2xl border-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
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
                  [
                    'Engine options',
                    officialExecution.engineOptionsFingerprint,
                  ],
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
          <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
            <Collapsible
              open={sectionsOpen.results}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, results: open }))
              }
            >
              <CollapsibleTrigger className="group w-full text-left outline-none">
                <CardHeader className="min-h-14 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
                  <div className="flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <CardTitle className="text-balance text-base">
                        Resultados ({activeCalculationFormulas.length})
                      </CardTitle>
                      <Badge
                        variant={hasOfficialResults ? 'secondary' : 'outline'}
                      >
                        {hasOfficialResults ? 'Oficial' : 'Prévia local'}
                      </Badge>
                    </div>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 transition-transform duration-200 ${sectionsOpen.results ? 'rotate-180' : ''}`}
                    />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="max-h-[560px] space-y-2 overflow-auto px-5 pb-5 pt-0">
                  {activeCalculationFormulas.map((formula) => {
                    const result = displayedFormulaResults[formula.outputKey]
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
                              {previewFormulaErrorMessage(result)}
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
          <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
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
          <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
            <Collapsible
              open={sectionsOpen.debug}
              onOpenChange={(open) =>
                setSectionsOpen((s) => ({ ...s, debug: open }))
              }
            >
              <CollapsibleTrigger className="group w-full text-left outline-none">
                <CardHeader className="min-h-14 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <CardTitle className="text-balance text-base">
                        Contexto de cálculo
                      </CardTitle>
                      <Badge variant="outline" className="tabular-nums">
                        {Object.keys(context).length} variáve
                        {Object.keys(context).length === 1 ? 'l' : 'is'}
                      </Badge>
                    </div>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={`h-4 w-4 transition-transform duration-200 ${sectionsOpen.debug ? 'rotate-180' : ''}`}
                    />
                  </div>
                  <CardDescription className="text-pretty">
                    Variáveis e valores usados nos cálculos do método — a base
                    de rastreabilidade do resultado.
                  </CardDescription>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="px-5 pb-5 pt-0">
                  {Object.keys(context).length > 0 ? (
                    <div className="max-h-72 overflow-auto rounded-xl ring-1 ring-foreground/10">
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-3 border-b bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        <span>Variável</span>
                        <span>Valor</span>
                      </div>
                      <div className="divide-y divide-foreground/10">
                        {Object.entries(context).map(([key, value]) => (
                          <div
                            key={key}
                            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-3 px-3 py-2 text-xs"
                          >
                            <span
                              className="truncate font-mono text-muted-foreground"
                              title={key}
                            >
                              {key}
                            </span>
                            <span className="min-w-0 font-mono tabular-nums [overflow-wrap:anywhere]">
                              {formatContextValue(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma variável de contexto disponível ainda.
                    </p>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>
      </div>
    </div>
  )
}
