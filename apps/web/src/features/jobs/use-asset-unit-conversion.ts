import { useCallback } from 'react'
import {
  canonicalUnitFor,
  convertUnitValue,
  resolveDisplayUnit,
  unitKind,
} from '@calibra-facil/shared/units'
import { type JobData } from '@/features/jobs/execution'

export type AssetBaseMeasurementUnit =
  | NonNullable<JobData['assetSnapshot']>['baseMeasurementUnit']
  | null

/**
 * Unit helpers bound to the asset's base measurement unit: what the screen
 * shows for a unit, and the conversions that feed it.
 */
export function useAssetUnitConversion(
  assetBaseMeasurementUnit: AssetBaseMeasurementUnit,
) {
  const displayUnitFor = useCallback(
    (unit?: string | null) =>
      resolveDisplayUnit(assetBaseMeasurementUnit, unit) ?? unit ?? undefined,
    [assetBaseMeasurementUnit],
  )
  const convertValueToDisplayUnit = useCallback(
    (value: number, unit?: string | null) => {
      const kind = unitKind(assetBaseMeasurementUnit)
      if (kind == null || unitKind(unit) !== kind) {
        return value
      }

      return convertUnitValue(value, unit, assetBaseMeasurementUnit) ?? value
    },
    [assetBaseMeasurementUnit],
  )
  const convertCanonicalValueToDisplayUnit = useCallback(
    (value: unknown, unit?: string | null) => {
      const kind = unitKind(assetBaseMeasurementUnit)
      if (
        typeof value !== 'number' ||
        kind == null ||
        unitKind(unit) !== kind
      ) {
        return value
      }

      return (
        convertUnitValue(
          value,
          canonicalUnitFor(kind),
          assetBaseMeasurementUnit,
        ) ?? value
      )
    },
    [assetBaseMeasurementUnit],
  )

  return {
    displayUnitFor,
    convertValueToDisplayUnit,
    convertCanonicalValueToDisplayUnit,
  }
}
