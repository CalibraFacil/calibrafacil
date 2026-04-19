import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'

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
}

/**
 * Dynamic form component that renders specification fields based on asset type definition.
 * Supports text, number (with unit addon), and select field types.
 */
export function DynamicSpecsForm({
  definition,
  value,
  onChange,
  disabled = false,
  errors = {},
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
    const ranges = Array.isArray(value[key])
      ? ([...(value[key] as WeighingRangeSpec[])] as WeighingRangeSpec[])
      : []
    ranges[index] = { ...ranges[index], ...updates }
    updateField(key, ranges)
  }

  const addWeighingRange = (key: string) => {
    const ranges = Array.isArray(value[key])
      ? ([...(value[key] as WeighingRangeSpec[])] as WeighingRangeSpec[])
      : []
    updateField(key, [
      ...ranges,
      {
        label: `Faixa ${ranges.length + 1}`,
        min: null,
        max: null,
        rangeUnit: 'kg',
        resolution: null,
        resolutionUnit: 'g',
      },
    ])
  }

  const removeWeighingRange = (key: string, index: number) => {
    const ranges = Array.isArray(value[key])
      ? ([...(value[key] as WeighingRangeSpec[])] as WeighingRangeSpec[])
      : []
    updateField(
      key,
      ranges.filter((_, itemIndex) => itemIndex !== index),
    )
  }

  if (!definition || definition.length === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      <div className="border-t pt-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-4">
          Especificações Técnicas
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
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
                <div className="space-y-3 rounded-md border p-3 sm:col-span-2">
                  {(Array.isArray(value[field.key])
                    ? (value[field.key] as WeighingRangeSpec[])
                    : []
                  ).map((range, index) => (
                    <div
                      key={index}
                      className="grid gap-2 rounded-md bg-muted/40 p-2 md:grid-cols-[1fr_90px_90px_80px_100px_80px_auto]"
                    >
                      <Input
                        value={range.label}
                        onChange={(event) =>
                          updateWeighingRange(field.key, index, {
                            label: event.target.value,
                          })
                        }
                        placeholder="Faixa 1"
                        disabled={disabled}
                      />
                      <Input
                        type="number"
                        step="any"
                        value={range.min ?? ''}
                        onChange={(event) =>
                          updateWeighingRange(field.key, index, {
                            min:
                              event.target.value === ''
                                ? null
                                : parseFloat(event.target.value),
                          })
                        }
                        placeholder="Min"
                        disabled={disabled}
                      />
                      <Input
                        type="number"
                        step="any"
                        value={range.max ?? ''}
                        onChange={(event) =>
                          updateWeighingRange(field.key, index, {
                            max:
                              event.target.value === ''
                                ? null
                                : parseFloat(event.target.value),
                          })
                        }
                        placeholder="Max"
                        disabled={disabled}
                      />
                      <Input
                        value={range.rangeUnit}
                        onChange={(event) =>
                          updateWeighingRange(field.key, index, {
                            rangeUnit: event.target.value,
                          })
                        }
                        placeholder="kg"
                        disabled={disabled}
                      />
                      <Input
                        type="number"
                        step="any"
                        value={range.resolution ?? ''}
                        onChange={(event) =>
                          updateWeighingRange(field.key, index, {
                            resolution:
                              event.target.value === ''
                                ? null
                                : parseFloat(event.target.value),
                          })
                        }
                        placeholder="Res."
                        disabled={disabled}
                      />
                      <Input
                        value={range.resolutionUnit}
                        onChange={(event) =>
                          updateWeighingRange(field.key, index, {
                            resolutionUnit: event.target.value,
                          })
                        }
                        placeholder="g"
                        disabled={disabled}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-md border px-2 text-sm disabled:opacity-50"
                        onClick={() => removeWeighingRange(field.key, index)}
                        disabled={disabled}
                      >
                        Remover
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                    onClick={() => addWeighingRange(field.key)}
                    disabled={disabled}
                  >
                    Adicionar faixa
                  </Button>
                </div>
              ) : field.type === 'select' && field.options ? (
                <Select
                  value={(value[field.key] as string) || ''}
                  onValueChange={(val) => updateField(field.key, val)}
                  disabled={disabled}
                >
                  <SelectTrigger id={`spec-${field.key}`}>
                    <span>
                      {(value[field.key] as string) || 'Selecione...'}
                    </span>
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
                    type="number"
                    step="any"
                    value={(value[field.key] as string | number) ?? ''}
                    onChange={(e) => {
                      const val = e.target.value
                      updateField(field.key, val === '' ? '' : parseFloat(val))
                    }}
                    disabled={disabled}
                    className={field.unit ? 'rounded-r-none' : ''}
                  />
                  {field.unit && (
                    <span className="inline-flex items-center px-3 text-sm text-muted-foreground bg-muted border border-l-0 border-input rounded-r-md">
                      {field.unit}
                    </span>
                  )}
                </div>
              ) : (
                <Input
                  id={`spec-${field.key}`}
                  type="text"
                  value={(value[field.key] as string) ?? ''}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  disabled={disabled}
                />
              )}

              {errors[field.key] && (
                <FieldError>{errors[field.key]}</FieldError>
              )}
            </Field>
          ))}
        </div>
      </div>
    </div>
  )
}
