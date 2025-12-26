import { Input } from '@/components/ui/input'
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
  type: 'text' | 'number' | 'select'
  options?: string[]
  unit?: string
  required?: boolean
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
            <Field key={field.key}>
              <FieldLabel htmlFor={`spec-${field.key}`}>
                {field.label}
                {field.required && ' *'}
              </FieldLabel>

              {field.type === 'select' && field.options ? (
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
