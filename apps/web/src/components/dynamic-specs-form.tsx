import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { resolveMassDisplayUnit, type MassUnit } from '@calibra-facil/shared'

/**
 * Field definition for dynamic asset specifications.
 * Matches the AssetTypeFieldDefinition from the database schema.
 */
export type SpecFieldDefinition = {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'weighing_ranges'
  options?: string[]
  unit?: string
  required?: boolean
}

export type WeighingRangeSpec = {
  label: string
  min: number | null
  max: number | null
  rangeUnit: string
  resolution: number | null
  resolutionUnit: string
}

interface DynamicSpecsFormProps {
  /** The field definitions from the asset type */
  definition: SpecFieldDefinition[]
  /** Current specification values */
  value: Record<string, unknown>
  /** Callback when values change */
  onChange: (specs: Record<string, unknown>) => void
  /** Disable all fields */
  disabled?: boolean
  /** Field-level errors */
  errors?: Record<string, string>
  /** Active asset mass unit for mass-based instruments */
  activeMassUnit?: MassUnit | null
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(Object.entries(value))
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function numberInputValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? value : ''
}

function weighingRangeFromUnknown(value: unknown): WeighingRangeSpec {
  const record = recordFromUnknown(value)
  return {
    label: stringValue(record.label),
    min: numberOrNull(record.min),
    max: numberOrNull(record.max),
    rangeUnit: stringValue(record.rangeUnit) || 'kg',
    resolution: numberOrNull(record.resolution),
    resolutionUnit: stringValue(record.resolutionUnit) || 'g',
  }
}

function weighingRangesFromUnknown(value: unknown) {
  return Array.isArray(value) ? value.map(weighingRangeFromUnknown) : []
}

/**
 * Dynamic form component that renders specification fields based on asset type definition.
 * Supports text, number (with unit addon), and select field types.
 */
const EMPTY_ERRORS: Record<string, string> = {}

export function DynamicSpecsForm({
  definition,
  value,
  onChange,
  disabled = false,
  errors = EMPTY_ERRORS,
  activeMassUnit = null,
}: DynamicSpecsFormProps) {
  const updateField = (key: string, fieldValue: unknown) => {
    onChange({
      ...value,
      [key]: fieldValue,
    })
  }

  const updateWeighingRange = (
    key: string,
    index: number,
    updates: Partial<WeighingRangeSpec>,
  ) => {
    const ranges = weighingRangesFromUnknown(value[key])
    ranges[index] = { ...ranges[index], ...updates }
    updateField(key, ranges)
  }

  const addWeighingRange = (key: string) => {
    const ranges = weighingRangesFromUnknown(value[key])
    updateField(key, [
      ...ranges,
      {
        label: `Faixa ${ranges.length + 1}`,
        min: null,
        max: null,
        rangeUnit: activeMassUnit ?? 'kg',
        resolution: null,
        resolutionUnit: activeMassUnit ?? 'g',
      },
    ])
  }

  const removeWeighingRange = (key: string, index: number) => {
    const ranges = weighingRangesFromUnknown(value[key])
    updateField(
      key,
      ranges.filter((_, itemIndex) => itemIndex !== index),
    )
  }

  const getDisplayUnit = (unit?: string) =>
    resolveMassDisplayUnit(activeMassUnit, unit) ?? unit

  if (!definition || definition.length === 0) {
    return null
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {definition.map((field) => (
        <Field
          key={field.key}
          className={
            field.type === 'weighing_ranges' ? 'sm:col-span-2' : undefined
          }
        >
          <FieldLabel htmlFor={`spec-${field.key}`}>
            {field.label}
            {field.required && ' *'}
          </FieldLabel>

          {field.type === 'weighing_ranges' ? (
            <div className="space-y-3 border-y py-3 sm:col-span-2">
              {weighingRangesFromUnknown(value[field.key]).map(
                (range, index) => (
                  <div
                    key={index}
                    className={`grid gap-2 border-b pb-3 last:border-b-0 last:pb-0 ${
                      activeMassUnit
                        ? 'md:grid-cols-[1fr_100px_100px_120px_auto]'
                        : 'md:grid-cols-[1fr_90px_90px_80px_100px_80px_auto]'
                    }`}
                  >
                    <Input
                      value={range.label}
                      onChange={(event) =>
                        updateWeighingRange(field.key, index, {
                          label: event.target.value,
                        })
                      }
                      placeholder="Faixa 1…"
                      disabled={disabled}
                      aria-label={`${field.label}: nome da faixa ${index + 1}`}
                      autoComplete="off"
                    />
                    <Input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={range.min ?? ''}
                      onChange={(event) =>
                        updateWeighingRange(field.key, index, {
                          min:
                            event.target.value === ''
                              ? null
                              : parseFloat(event.target.value),
                        })
                      }
                      placeholder="Mín…"
                      disabled={disabled}
                      aria-label={`${field.label}: mínimo da faixa ${index + 1}`}
                      autoComplete="off"
                    />
                    <Input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={range.max ?? ''}
                      onChange={(event) =>
                        updateWeighingRange(field.key, index, {
                          max:
                            event.target.value === ''
                              ? null
                              : parseFloat(event.target.value),
                        })
                      }
                      placeholder="Máx…"
                      disabled={disabled}
                      aria-label={`${field.label}: máximo da faixa ${index + 1}`}
                      autoComplete="off"
                    />
                    {activeMassUnit ? (
                      <div className="flex h-9 items-center border-y border-r bg-muted/40 px-3 text-sm text-muted-foreground">
                        {activeMassUnit}
                      </div>
                    ) : (
                      <Input
                        value={range.rangeUnit}
                        onChange={(event) =>
                          updateWeighingRange(field.key, index, {
                            rangeUnit: event.target.value,
                          })
                        }
                        placeholder="kg…"
                        disabled={disabled}
                        aria-label={`${field.label}: unidade da faixa ${
                          index + 1
                        }`}
                        autoComplete="off"
                      />
                    )}
                    <Input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={range.resolution ?? ''}
                      onChange={(event) =>
                        updateWeighingRange(field.key, index, {
                          resolution:
                            event.target.value === ''
                              ? null
                              : parseFloat(event.target.value),
                        })
                      }
                      placeholder="Res…"
                      disabled={disabled}
                      aria-label={`${field.label}: resolução da faixa ${
                        index + 1
                      }`}
                      autoComplete="off"
                    />
                    {activeMassUnit ? (
                      <div className="flex h-9 items-center border-y border-r bg-muted/40 px-3 text-sm text-muted-foreground">
                        {activeMassUnit}
                      </div>
                    ) : (
                      <Input
                        value={range.resolutionUnit}
                        onChange={(event) =>
                          updateWeighingRange(field.key, index, {
                            resolutionUnit: event.target.value,
                          })
                        }
                        placeholder="g…"
                        disabled={disabled}
                        aria-label={`${field.label}: unidade da resolução da faixa ${
                          index + 1
                        }`}
                        autoComplete="off"
                      />
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="md:justify-self-end"
                      onClick={() => removeWeighingRange(field.key, index)}
                      disabled={disabled}
                    >
                      Remover
                    </Button>
                  </div>
                ),
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addWeighingRange(field.key)}
                disabled={disabled}
              >
                Adicionar faixa
              </Button>
            </div>
          ) : field.type === 'select' && field.options ? (
            <Select
              value={stringValue(value[field.key])}
              onValueChange={(val) => updateField(field.key, val)}
              disabled={disabled}
            >
              <SelectTrigger id={`spec-${field.key}`}>
                <span>{stringValue(value[field.key]) || 'Selecione…'}</span>
              </SelectTrigger>
              <SelectContent>
                {field.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : field.type === 'number' ? (
            <div className="flex">
              <Input
                id={`spec-${field.key}`}
                name={`spec-${field.key}`}
                type="number"
                step="any"
                inputMode="decimal"
                value={numberInputValue(value[field.key])}
                onChange={(e) => {
                  const val = e.target.value
                  updateField(field.key, val === '' ? '' : parseFloat(val))
                }}
                disabled={disabled}
                autoComplete="off"
                className={getDisplayUnit(field.unit) ? 'rounded-r-none' : ''}
              />
              {getDisplayUnit(field.unit) && (
                <span className="inline-flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">
                  {getDisplayUnit(field.unit)}
                </span>
              )}
            </div>
          ) : (
            <Input
              id={`spec-${field.key}`}
              name={`spec-${field.key}`}
              type="text"
              value={stringValue(value[field.key])}
              onChange={(e) => updateField(field.key, e.target.value)}
              disabled={disabled}
              autoComplete="off"
            />
          )}

          {errors[field.key] && <FieldError>{errors[field.key]}</FieldError>}
        </Field>
      ))}
    </div>
  )
}
