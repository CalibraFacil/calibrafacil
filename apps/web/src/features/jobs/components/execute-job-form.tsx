import type { JobExecutionWarning } from '@calibra-facil/contracts'
import { useCallback, useMemo, useRef, useState } from 'react'
import { denormalizeMethodDataForDisplay } from '@calibra-facil/shared/units'
import { createMethodCalculationEngine } from '@/components/method-runtime/math-runtime'
import {
  SyncConflictReturnNotice,
  type SyncConflictReturnSearch,
} from '@/runtime/sync-conflict-return'
import {
  buildEnvironmentWarnings,
  canSubmitExecution,
  defaultCalibrationPhases,
  DEFAULT_PHASE_MODE,
  getAssetIndicatorPosition,
  isExecutionEditable,
  type CalibrationLocationSnapshot,
  type CalibrationPhaseSnapshot,
  type EffectiveLimits,
  type JobData,
  type ReferenceStandard,
} from '@/features/jobs/execution'
import { parseExecutionPerformedAt } from '@/features/jobs/forms'
import { standardWarningItems } from '@/features/jobs/standard-warnings'
import {
  clearExecutionDraft,
  hashExecutionValues,
  isExecutionFormDirty,
  resolveExecutionDraftOffer,
  writeExecutionDraft,
  type ExecutionDraftOwner,
  type ExecutionFormValues,
} from '@/features/jobs/execution-draft'
import {
  ExecutionDraftRestoreDialog,
  ExecutionDraftSync,
  ExecutionNavigationGuard,
} from '@/features/jobs/components/execution-unsaved-guard'
import { type UnsavedChangesGate } from '@/lib/unsaved-changes-gate'
import { ExecuteHeader } from './execute-header'
import { ExecuteCalibrationDateCard } from './execute-calibration-date-card'
import { ExecuteStaleStandardsAlert } from './execute-stale-standards-alert'
import { ExecuteStandardsCard } from './execute-standards-card'
import { ExecuteLocationCard } from './execute-location-card'
import { ExecuteEnvironmentCard } from './execute-environment-card'
import { ExecuteMeasurementCard } from './execute-measurement-card'
import {
  renderExecuteMethodField,
  type ExecuteMethodFieldContext,
} from './execute-method-field'
import {
  ExecuteOfficialExecutionCard,
  ExecuteResultsCard,
  ExecuteValidationsCard,
  ExecuteCalculationContextCard,
} from './execute-results-panels'
import {
  buildAssetSpecSummaryItems,
  buildInitialCalibrationLocation,
  countExecutionIssues,
  formatDateForInput,
  getEnvironmentStatus,
  summarizeRequiredFields,
} from '../execute-page-helpers'
import { useAssetUnitConversion } from '../use-asset-unit-conversion'
import { useExecutionFieldModel } from '../use-execution-field-model'
import { useExecutionCalculation } from '../use-execution-calculation'
import { useExecutionSubmission } from '../use-execution-submission'

export function ExecuteJobForm({
  job,
  standardsData,
  envLimits,
  engine,
  jobId,
  conflictReturn,
  draftScope,
  UnsavedChangesGate,
}: {
  job: JobData
  standardsData: Array<ReferenceStandard>
  envLimits: EffectiveLimits | null
  engine: ReturnType<typeof createMethodCalculationEngine>
  jobId: string
  conflictReturn: SyncConflictReturnSearch
  draftScope: ExecutionDraftOwner | null
  UnsavedChangesGate: UnsavedChangesGate
}) {
  const assetIndicatorPosition = getAssetIndicatorPosition(job)
  const assetBaseMeasurementUnit =
    job.assetSnapshot?.baseMeasurementUnit ?? null
  const {
    displayUnitFor,
    convertValueToDisplayUnit,
    convertCanonicalValueToDisplayUnit,
  } = useAssetUnitConversion(assetBaseMeasurementUnit)

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
  // What the last draft save answered about standards the job carries that are
  // no longer valid (P1-11): the save went through, the submit will refuse.
  const [standardWarnings, setStandardWarnings] = useState<
    JobExecutionWarning[]
  >([])
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
    useState<CalibrationLocationSnapshot>(() =>
      buildInitialCalibrationLocation(job),
    )
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
  // Hydrate from the persisted execution date (saved with the draft); otherwise
  // start empty so the operator makes a deliberate choice.
  const [performedAt, setPerformedAt] = useState<string>(() =>
    job.performedAt ? formatDateForInput(new Date(job.performedAt)) : '',
  )
  const [backdateReason, setBackdateReason] = useState('')
  // The execution date follows the cloud's submit rules (not in the future, a
  // reason beyond 7 days back); see parseExecutionPerformedAt in ./forms.
  // Deliberate live-clock read: the rules are measured against the real clock
  // at the moment the technician submits, not a value frozen at mount. This
  // project does not run React Compiler, so nothing memoizes it.
  // oxlint-disable-next-line react/purity
  const performedAtState = parseExecutionPerformedAt(
    { date: performedAt, backdateReason },
    new Date(),
  )
  // ISO/IEC 17025 §7.8.2.1(n) — printed on the certificate when filled.
  const [methodDeviations, setMethodDeviations] = useState(
    job.methodDeviations ?? '',
  )

  // --- Unsaved-readings protection -----------------------------------------
  // Everything the technician can type, as one comparable value. Dirty is
  // derived from it (current vs last saved/loaded), never tracked by effects.
  const currentValues = useMemo(
    (): ExecutionFormValues => ({
      formData,
      selectedStandardIds,
      environment,
      calibrationLocation,
      calibrationPhases,
      performedAt,
      backdateReason,
      methodDeviations,
    }),
    [
      formData,
      selectedStandardIds,
      environment,
      calibrationLocation,
      calibrationPhases,
      performedAt,
      backdateReason,
      methodDeviations,
    ],
  )
  // The values last loaded from / saved to the server; the first render's
  // values are exactly what was loaded from the job.
  const [savedValues, setSavedValues] = useState(currentValues)
  const isDirty = useMemo(
    () => isExecutionFormDirty(currentValues, savedValues),
    [currentValues, savedValues],
  )
  const draftKey = useMemo(
    () => (isDirty ? hashExecutionValues(currentValues) : 'clean'),
    [currentValues, isDirty],
  )
  const scope = useMemo(
    () => (draftScope ? { ...draftScope, jobId: String(job.id) } : null),
    [draftScope, job.id],
  )
  const serverUpdatedAt = job.updatedAt ?? null
  // A local draft newer than the server's data is offered, never auto-applied.
  const [draftOffer, setDraftOffer] = useState<ExecutionFormValues | null>(
    () =>
      scope && isExecutionEditable(job.status)
        ? resolveExecutionDraftOffer({
            scope,
            baseline: currentValues,
            serverUpdatedAt,
          })
        : null,
  )
  // Set right before this page navigates itself away after a save/submit, since
  // the render that clears the dirt has not committed when navigate() runs.
  const leaveAllowed = useRef(false)

  const restoreDraft = () => {
    if (!draftOffer) return
    setFormData(draftOffer.formData)
    setSelectedStandardIds(draftOffer.selectedStandardIds)
    setEnvironment(draftOffer.environment)
    setCalibrationLocation(draftOffer.calibrationLocation)
    setCalibrationPhases(draftOffer.calibrationPhases)
    setPerformedAt(draftOffer.performedAt)
    setBackdateReason(draftOffer.backdateReason)
    setMethodDeviations(draftOffer.methodDeviations)
    setDraftOffer(null)
  }
  const discardDraft = () => {
    if (scope) clearExecutionDraft(scope)
    setDraftOffer(null)
  }
  // Keep the readings recoverable even though the debounce has not fired.
  const flushDraftBeforeLeaving = () => {
    if (scope) {
      writeExecutionDraft({
        scope,
        values: currentValues,
        baseUpdatedAt: serverUpdatedAt,
      })
    }
  }

  const setSectionOpen =
    (section: keyof typeof sectionsOpen) => (open: boolean) =>
      setSectionsOpen((s) => ({ ...s, [section]: open }))

  // The submission hook cannot write the ref it is handed (hook arguments are
  // read-only), so the form hands it this instead.
  const allowLeave = () => {
    leaveAllowed.current = true
  }

  const {
    assetSpecFields,
    manualFields,
    phaseBlocks,
    displayManualFields,
    displayAssetSpecFields,
    displayAssetSpecifications,
    hasMassCompositionColumns,
    eccentricityFields,
    eccentricityIndicatorVariant,
    selectedIndicatorPosition,
  } = useExecutionFieldModel({
    job,
    assetBaseMeasurementUnit,
    assetIndicatorPosition,
  })

  const {
    parsedFormData,
    missingAssetSpecFields,
    selectedStandardsMissingCertificatePdf,
    context,
    officialExecution,
    officialDiagnosticCount,
    resultsSource,
    activeCalculationFormulas,
    formulaResults,
    displayedFormulaResults,
    validationResults,
    certifiedValueOptions,
    massCompositionOptions,
    standardCertifiedValueOptions,
  } = useExecutionCalculation({
    job,
    engine,
    standardsData,
    formData,
    selectedStandardIds,
    environment,
    calibrationPhases,
    assetBaseMeasurementUnit,
    assetSpecFields,
    manualFields,
    displayManualFields,
    displayAssetSpecifications,
    convertValueToDisplayUnit,
    displayUnitFor,
    unsavedEdits: isDirty,
  })

  // Update field
  const updateField = useCallback(
    (key: string, value: unknown) => {
      setFormData((prev) => ({ ...prev, [key]: value }))
    },
    [setFormData],
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
    [setCalibrationPhases],
  )

  // Compute environment warnings
  const envWarnings = useMemo(
    () => buildEnvironmentWarnings({ environment, envLimits }),
    [environment, envLimits],
  )

  const { missingNotPerformedPhaseReasons, saveMutation, submitMutation } =
    useExecutionSubmission({
      jobId,
      conflictReturn,
      scope,
      allowLeave,
      selectedStandardIds,
      parsedFormData,
      formulaResults,
      environment,
      calibrationLocation,
      calibrationPhases,
      phaseBlocks,
      methodDeviations,
      performedAtState,
      setSavedValues,
      setStandardWarnings,
    })

  const staleStandardItems = standardWarningItems(
    standardWarnings,
    selectedStandardIds,
  )

  // Toggle standard selection
  const toggleStandard = (standardId: number) => {
    setSelectedStandardIds((prev) =>
      prev.includes(standardId)
        ? prev.filter((id) => id !== standardId)
        : [...prev, standardId],
    )
  }

  const { requiresBackdateReason, backdateDays } = performedAtState
  const isPerformedDateValid = performedAtState.field !== 'performedAt'
  const isBackdateReasonSatisfied = performedAtState.field !== 'backdateReason'

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
  const {
    requiredFields,
    completedRequiredFields,
    requiredCompletionPercent,
    requiredComplete,
  } = summarizeRequiredFields(manualFields, formData)
  const totalIssueCount = countExecutionIssues({
    formulaResults,
    validationResults,
    envWarningCount: envWarnings.length,
    missingNotPerformedPhaseReasonCount: missingNotPerformedPhaseReasons.length,
  })
  const environmentStatus = getEnvironmentStatus(
    envWarnings.length,
    environment,
  )
  const assetSpecSummaryItems = buildAssetSpecSummaryItems({
    displayAssetSpecFields,
    job,
    convertCanonicalValueToDisplayUnit,
  })
  const methodFieldContext: ExecuteMethodFieldContext = {
    formData,
    calibrationPhases,
    isEditable,
    updateField,
    updateCalibrationPhase,
    certifiedValueOptions,
    massCompositionOptions,
    standardCertifiedValueOptions,
    displayAssetSpecifications,
    assetBaseMeasurementUnit,
    selectedIndicatorPosition,
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
      <ExecutionDraftSync
        key={`${draftKey}:${draftOffer !== null}`}
        scope={scope}
        values={currentValues}
        dirty={isDirty}
        suspended={draftOffer !== null}
        baseUpdatedAt={serverUpdatedAt}
      />
      <ExecutionNavigationGuard
        Gate={UnsavedChangesGate}
        shouldBlock={() => isDirty && !leaveAllowed.current}
        draftKept={scope !== null}
        onBeforeLeave={flushDraftBeforeLeaving}
      />
      <ExecutionDraftRestoreDialog
        open={draftOffer !== null}
        onRestore={restoreDraft}
        onDiscard={discardDraft}
      />
      <SyncConflictReturnNotice search={conflictReturn} />
      <ExecuteHeader
        job={job}
        selectedStandardIds={selectedStandardIds}
        environmentStatus={environmentStatus}
        totalIssueCount={totalIssueCount}
        requiredFields={requiredFields}
        completedRequiredFields={completedRequiredFields}
        requiredCompletionPercent={requiredCompletionPercent}
        requiredComplete={requiredComplete}
        assetSpecSummaryItems={assetSpecSummaryItems}
        missingAssetSpecFields={missingAssetSpecFields}
        isEditable={isEditable}
        canSubmit={canSubmit}
        isSubmitting={submitMutation.isPending}
        onSave={() => saveMutation.mutateAsync(currentValues)}
        onSubmit={() => submitMutation.mutate(currentValues)}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* Left Column: Data Entry */}
        <div className="min-w-0 space-y-5">
          {/* Calibration date */}
          <ExecuteCalibrationDateCard
            performedAt={performedAt}
            requiresBackdateReason={requiresBackdateReason}
            backdateDays={backdateDays}
            backdateReason={backdateReason}
            methodDeviations={methodDeviations}
            isEditable={isEditable}
            onPerformedAtChange={setPerformedAt}
            onBackdateReasonChange={setBackdateReason}
            onMethodDeviationsChange={setMethodDeviations}
          />

          {/* A standard the job carries went stale: the save kept the readings */}
          {staleStandardItems.length > 0 && (
            <ExecuteStaleStandardsAlert
              items={staleStandardItems}
              isEditable={isEditable}
              onRemove={toggleStandard}
            />
          )}

          {/* Reference Standards */}
          <ExecuteStandardsCard
            open={sectionsOpen.standards}
            onOpenChange={setSectionOpen('standards')}
            hasMassCompositionColumns={hasMassCompositionColumns}
            selectedStandardIds={selectedStandardIds}
            selectedStandardsMissingCertificatePdf={
              selectedStandardsMissingCertificatePdf
            }
            standardsData={standardsData}
            onToggleStandard={toggleStandard}
            convertValueToDisplayUnit={convertValueToDisplayUnit}
            displayUnitFor={displayUnitFor}
          />

          {/* Calibration Location */}
          <ExecuteLocationCard
            open={sectionsOpen.location}
            onOpenChange={setSectionOpen('location')}
            job={job}
            calibrationLocation={calibrationLocation}
            setCalibrationLocation={setCalibrationLocation}
          />

          {/* Environmental Conditions */}
          <ExecuteEnvironmentCard
            open={sectionsOpen.environment}
            onOpenChange={setSectionOpen('environment')}
            envWarnings={envWarnings}
            envLimits={envLimits}
            environment={environment}
            setEnvironment={setEnvironment}
            isEditable={isEditable}
          />

          {/* Data Entry Form */}
          <ExecuteMeasurementCard
            open={sectionsOpen.data}
            onOpenChange={setSectionOpen('data')}
            job={job}
            manualFieldCount={manualFields.length}
            eccentricityFieldCount={eccentricityFields.length}
            selectedIndicatorPosition={selectedIndicatorPosition}
            eccentricityIndicatorVariant={eccentricityIndicatorVariant}
          >
            {displayManualFields.map((field) =>
              renderExecuteMethodField(field, methodFieldContext),
            )}
          </ExecuteMeasurementCard>
        </div>

        {/* Right Column: Results & Validations */}
        <div className="min-w-0 space-y-5 xl:sticky xl:top-4 xl:self-start">
          {/* Formula Results: what the technician checks first */}
          <ExecuteResultsCard
            open={sectionsOpen.results}
            onOpenChange={setSectionOpen('results')}
            activeCalculationFormulas={activeCalculationFormulas}
            resultsSource={resultsSource}
            displayedFormulaResults={displayedFormulaResults}
            displayUnitFor={displayUnitFor}
          />

          {/* Validations */}
          <ExecuteValidationsCard
            open={sectionsOpen.validations}
            onOpenChange={setSectionOpen('validations')}
            validationResults={validationResults}
          />

          {/* Audit trail of the persisted calculation, closed by default */}
          {officialExecution ? (
            <ExecuteOfficialExecutionCard
              officialExecution={officialExecution}
              officialDiagnosticCount={officialDiagnosticCount}
            />
          ) : null}

          {/* Debug Context */}
          <ExecuteCalculationContextCard
            open={sectionsOpen.debug}
            onOpenChange={setSectionOpen('debug')}
            context={context}
          />
        </div>
      </div>
    </div>
  )
}
