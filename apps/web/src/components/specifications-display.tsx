import type { SpecFieldDefinition } from './dynamic-specs-form'

interface SpecificationsDisplayProps {
  /** The field definitions from the asset type */
  definition: SpecFieldDefinition[]
  /** Current specification values */
  specifications: Record<string, unknown> | null | undefined
}

/**
 * Read-only display component for asset specifications.
 * Renders specification values with their labels and units based on the asset type definition.
 */
export function SpecificationsDisplay({
  definition,
  specifications,
}: SpecificationsDisplayProps) {
  if (!definition || definition.length === 0 || !specifications) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma especificação registrada.
      </p>
    )
  }

  // Filter to only show fields that have values
  const fieldsWithValues = definition.filter((field) => {
    const value = specifications[field.key]
    return value !== undefined && value !== null && value !== ''
  })

  if (fieldsWithValues.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma especificação registrada.
      </p>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fieldsWithValues.map((field) => {
        const value = specifications[field.key]
        let displayValue: string

        if (field.type === 'number' && typeof value === 'number') {
          displayValue = field.unit ? `${value} ${field.unit}` : String(value)
        } else {
          displayValue = String(value)
        }

        return (
          <div key={field.key}>
            <label className="text-sm font-medium text-muted-foreground">
              {field.label}
            </label>
            <p className="text-sm">{displayValue}</p>
          </div>
        )
      })}
    </div>
  )
}
