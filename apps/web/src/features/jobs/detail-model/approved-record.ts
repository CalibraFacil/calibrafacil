import {
  denormalizeMethodDataForDisplay,
  denormalizeMethodResultsForDisplay,
  denormalizeSpecificationsForDisplay,
  resolveDisplayUnit,
} from '@calibra-facil/shared/units'
import { normalizeMethodValidations } from '@/components/method-runtime/math-runtime'
import {
  formatWeighingRangeSpec,
  isWeighingRangeSpecArray,
} from '@/components/method-runtime/weighing-range-utils'
import {
  type ApprovedJobRecordData,
  type ReviewContextItem,
  type ReviewMethodField,
} from './types'
import {
  PRIORITY_REVIEW_FIELD_KEYS,
  formatDateTime,
  formatReviewValue,
} from './display'
import { numericValues } from './job-values'
import { formatExpandedUncertainty } from './verdict'

type AssetSpecDefinition = {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'weighing_ranges'
  unit?: string
}

function parseAssetSpecDefinitionType(
  type: string,
): AssetSpecDefinition['type'] {
  switch (type) {
    case 'number':
    case 'select':
    case 'weighing_ranges':
      return type
    default:
      return 'text'
  }
}

export function buildReviewAssetSpecDefinitions(
  dataFields: ReviewMethodField[],
): AssetSpecDefinition[] {
  return [
    ...dataFields
      .filter((field) => field.source === 'asset_spec' && field.assetSpecKey)
      .map((field) => ({
        key: field.assetSpecKey!,
        label: field.label,
        type: parseAssetSpecDefinitionType(field.type),
        unit: field.unit ?? undefined,
      })),
    ...dataFields
      .filter((field) => field.weighingRangeResolver?.assetSpecKey)
      .map((field) => ({
        key: field.weighingRangeResolver!.assetSpecKey!,
        label: 'Faixas de pesagem e resolução',
        type: 'weighing_ranges' as const,
      })),
  ]
}

export function buildReviewEquipmentSpecItems({
  assetSpecDefinitions,
  displayAssetSpecs,
  displayUnitFor,
}: {
  assetSpecDefinitions: AssetSpecDefinition[]
  displayAssetSpecs: Record<string, unknown> | null | undefined
  displayUnitFor: (unit?: string | null) => string | undefined
}): ReviewContextItem[] {
  return assetSpecDefinitions
    .map((definition) => {
      const value = displayAssetSpecs?.[definition.key]
      if (value === null || value === undefined || value === '') return null

      const displayValue =
        definition.type === 'weighing_ranges' && isWeighingRangeSpecArray(value)
          ? value.map(formatWeighingRangeSpec).join(' | ')
          : definition.type === 'number'
            ? formatReviewValue(value, displayUnitFor(definition.unit))
            : String(value)

      return {
        key: definition.key,
        label: definition.label,
        value: displayValue,
      }
    })
    .filter((item): item is ReviewContextItem => Boolean(item))
}

export function buildReviewSupportContextItems({
  dataFields,
  displayData,
  displayUnitFor,
  excludePriorityFields = false,
  excludeTableFields = false,
}: {
  dataFields: ReviewMethodField[]
  displayData: Record<string, unknown> | null | undefined
  displayUnitFor: (unit?: string | null) => string | undefined
  excludePriorityFields?: boolean
  excludeTableFields?: boolean
}): ReviewContextItem[] {
  return dataFields
    .filter((field) => field.source !== 'asset_spec')
    .filter(
      (field) =>
        !excludePriorityFields ||
        !PRIORITY_REVIEW_FIELD_KEYS.includes(field.key),
    )
    .filter((field) => !excludeTableFields || field.type !== 'table')
    .map((field) => {
      const value = displayData?.[field.key]
      if (value === null || value === undefined || value === '') return null

      return {
        key: field.key,
        label: field.label,
        value: formatReviewValue(value, displayUnitFor(field.unit)),
      }
    })
    .filter((item): item is ReviewContextItem => Boolean(item))
}

export function getApprovedReviewMeasurementFields(
  dataFields: ReviewMethodField[],
) {
  const nonAssetDataFields = dataFields.filter(
    (field) => field.source !== 'asset_spec',
  )
  const priorityMeasurementFields = nonAssetDataFields.filter((field) =>
    PRIORITY_REVIEW_FIELD_KEYS.includes(field.key),
  )

  return {
    nonAssetDataFields,
    measurementFields:
      priorityMeasurementFields.length > 0
        ? priorityMeasurementFields
        : nonAssetDataFields,
  }
}

export function buildApprovedRecordTimelineContextItems(
  job: Pick<ApprovedJobRecordData, 'approvedAt' | 'createdAt' | 'performedAt'>,
): ReviewContextItem[] {
  return [
    {
      key: 'createdAt',
      label: 'Criado',
      value: formatDateTime(job.createdAt),
    },
    {
      key: 'performedAt',
      label: 'Executado',
      value: formatDateTime(job.performedAt),
    },
    {
      key: 'approvedAt',
      label: 'Aprovado',
      value: formatDateTime(job.approvedAt),
    },
  ]
}

export function buildApprovedJobRecordModel(job: ApprovedJobRecordData) {
  const { methodSnapshot, data, results } = job
  const validations = normalizeMethodValidations(methodSnapshot.validations)
  const assetBaseMeasurementUnit =
    job.assetSnapshot?.baseMeasurementUnit ?? null
  const displayUnitFor = (unit?: string | null) =>
    resolveDisplayUnit(assetBaseMeasurementUnit, unit) ?? unit ?? undefined
  const displayData =
    denormalizeMethodDataForDisplay(
      data,
      methodSnapshot.dataFields,
      assetBaseMeasurementUnit,
    ) ?? data
  const displayResults =
    denormalizeMethodResultsForDisplay(
      results,
      methodSnapshot.formulas,
      assetBaseMeasurementUnit,
    ) ?? results
  const assetSpecDefinitions = buildReviewAssetSpecDefinitions(
    methodSnapshot.dataFields,
  )
  const displayAssetSpecs =
    denormalizeSpecificationsForDisplay(
      job.assetSnapshot?.specifications,
      assetSpecDefinitions,
      assetBaseMeasurementUnit,
    ) ?? job.assetSnapshot?.specifications
  const equipmentSpecItems = buildReviewEquipmentSpecItems({
    assetSpecDefinitions,
    displayAssetSpecs,
    displayUnitFor,
  })
  const supportContextItems = buildReviewSupportContextItems({
    dataFields: methodSnapshot.dataFields,
    displayData,
    displayUnitFor,
    excludePriorityFields: true,
    excludeTableFields: true,
  })
  const timelineContextItems = buildApprovedRecordTimelineContextItems(job)
  const { measurementFields, nonAssetDataFields } =
    getApprovedReviewMeasurementFields(methodSnapshot.dataFields)

  const aposMargins = numericValues(displayResults?.margem_conformidade_apos)
  const pointsTotal = aposMargins.length
  const pointsWithin = aposMargins.filter((margin) => margin >= 0).length
  const expandedUncertainty = formatExpandedUncertainty(
    displayResults,
    methodSnapshot.formulas,
    displayUnitFor,
  )

  return {
    validations,
    assetBaseMeasurementUnit,
    displayUnitFor,
    displayData,
    displayResults,
    equipmentSpecItems,
    supportContextItems,
    timelineContextItems,
    approvedContextItems: [
      ...equipmentSpecItems,
      ...supportContextItems,
      ...timelineContextItems,
    ],
    nonAssetDataFields,
    measurementFields,
    pointsTotal,
    pointsWithin,
    expandedUncertainty,
  }
}
