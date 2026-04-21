import type { SpecFieldDefinition } from './dynamic-specs-form'
import {
  formatWeighingRangeSpec,
  isWeighingRangeSpecArray,
} from './method-builder/weighing-range-utils'
import { resolveMassDisplayUnit, type MassUnit } from '@calibra-facil/shared'

interface SpecificationsDisplayProps {
  /** The field definitions from the asset type */
  definition: SpecFieldDefinition[]
  /** Current specification values */
  specifications: Record<string, unknown> | null | undefined
  activeMassUnit?: MassUnit | null
}

/**
 * Read-only display component for asset specifications.
 * Renders specification values with their labels and units based on the asset type definition.
 */
export function SpecificationsDisplay({
  definition,
  specifications,
  activeMassUnit = null,
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

        if (
          field.type === 'weighing_ranges' &&
          isWeighingRangeSpecArray(value)
        ) {
          displayValue = value.map(formatWeighingRangeSpec).join('\n')
        } else if (field.type === 'number' && typeof value === 'number') {
          const displayUnit = resolveMassDisplayUnit(activeMassUnit, field.unit)
          displayValue = displayUnit ? `${value} ${displayUnit}` : String(value)
        } else {
          displayValue = String(value)
        }

        return (
          <div
            key={field.key}
            className={field.type === 'weighing_ranges' ? 'sm:col-span-2' : ''}
          >
            <label className="text-sm font-medium text-muted-foreground">
              {field.label}
            </label>
            <p className="whitespace-pre-line text-sm">{displayValue}</p>
          </div>
        )
      })}
    </div>
  )
}
