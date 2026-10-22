import { Input } from '@calibra-facil/ui/input'
import { Field, FieldLabel } from '@calibra-facil/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@calibra-facil/ui/select'
import {
  TableInputRenderer,
  type CertifiedValueOption,
} from '@/components/method-runtime/table-input-renderer'
import type { MassCompositionOption } from '@/components/method-runtime/mass-composition-utils'
import type { StandardCertifiedValueOption } from '@/components/method-runtime/standard-value-utils'
import { EccentricityIndicator } from '@/components/eccentricity-indicator'
import type { MethodInputField } from '@/components/method-runtime/types'
import {
  DEFAULT_PHASE_MODE,
  getCircularEccentricityLoadPositions,
  getEccentricityIndicatorVariant,
  phaseBlockKey,
  phaseModeLabel,
  resolveSelectedIndicatorPosition,
  type CalibrationPhaseSnapshot,
} from '@/features/jobs/execution'
import { toRecordArray } from '../record-guards'
import { toCalibrationPhaseMode, toStringValue } from '../execute-page-helpers'
import type { AssetBaseMeasurementUnit } from '../use-asset-unit-conversion'
import type { useExecutionFieldModel } from '../use-execution-field-model'

export type ExecuteMethodFieldContext = {
  formData: Record<string, unknown>
  calibrationPhases: CalibrationPhaseSnapshot
  isEditable: boolean
  updateField: (key: string, value: unknown) => void
  updateCalibrationPhase: (
    blockKey: string,
    patch: Partial<CalibrationPhaseSnapshot['blocks'][string]>,
  ) => void
  certifiedValueOptions: CertifiedValueOption[]
  massCompositionOptions: MassCompositionOption[]
  standardCertifiedValueOptions: StandardCertifiedValueOption[]
  displayAssetSpecifications: ReturnType<
    typeof useExecutionFieldModel
  >['displayAssetSpecifications']
  assetBaseMeasurementUnit: AssetBaseMeasurementUnit
  selectedIndicatorPosition: ReturnType<typeof resolveSelectedIndicatorPosition>
}

/**
 * One method input field as the form renders it. A plain function rather than a
 * component so the tree React sees is exactly the one the form used to inline.
 */
export function renderExecuteMethodField(
  field: MethodInputField,
  {
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
  }: ExecuteMethodFieldContext,
) {
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
                  <SelectItem value="before_and_after">Antes e após</SelectItem>
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
          standardCertifiedValueOptions={standardCertifiedValueOptions}
          assetSpecifications={displayAssetSpecifications}
          assetBaseMeasurementUnit={assetBaseMeasurementUnit}
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
