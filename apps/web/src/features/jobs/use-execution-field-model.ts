import { useMemo } from 'react'
import {
  denormalizeSpecificationsForDisplay,
  normalizeRangeSpecsForDisplay,
} from '@calibra-facil/shared/units'
import {
  collectPhaseBlocks,
  getAssetIndicatorPosition,
  getEccentricityIndicatorVariant,
  resolveFieldForDisplay,
  resolveSelectedIndicatorPosition,
  type JobData,
} from '@/features/jobs/execution'
import type { AssetBaseMeasurementUnit } from './use-asset-unit-conversion'
import { toAssetSpecificationFieldDefinition } from './execute-page-helpers'

/** The method's fields split and resolved for display against the asset's unit. */
export function useExecutionFieldModel({
  job,
  assetBaseMeasurementUnit,
  assetIndicatorPosition,
}: {
  job: JobData
  assetBaseMeasurementUnit: AssetBaseMeasurementUnit
  assetIndicatorPosition: ReturnType<typeof getAssetIndicatorPosition>
}) {
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
      denormalizeSpecificationsForDisplay(
        rawSpecifications,
        displayAssetSpecificationDefinition,
        assetBaseMeasurementUnit,
      ) ?? rawSpecifications

    if (!denormalized || !assetBaseMeasurementUnit) {
      return denormalized
    }

    return {
      ...denormalized,
      weighingRanges: normalizeRangeSpecsForDisplay(
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
  const selectedIndicatorPosition = resolveSelectedIndicatorPosition(
    assetIndicatorPosition,
    eccentricityIndicatorVariant,
  )

  return {
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
  }
}
