import {
  AssetStatusSchema,
  CreateAssetSchema,
  UpdateAssetSchema,
  type AssetStatus,
  type CreateAssetInput,
  type MeasurementUnit,
  type UpdateAssetInput,
} from '@calibra-facil/schemas'
import {
  dominantKindForAssetType,
  MEASUREMENT_UNITS,
  unitsForKind,
  type SpecificationFieldLike,
} from '@calibra-facil/shared/units'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'

/**
 * Unit options for the asset's base-unit picker, narrowed to the dominant
 * quantity kind of the selected asset type's field definition (e.g. a balance
 * → mg/g/kg, a paquímetro → length units). Falls back to every registry unit
 * when no field carries a recognizable unit.
 */
export function baseMeasurementUnitOptions(
  definition: SpecificationFieldLike[] | null | undefined,
): readonly MeasurementUnit[] {
  const kind = dominantKindForAssetType(definition)
  return kind ? unitsForKind(kind) : MEASUREMENT_UNITS
}

export const ASSET_FORM_STATUSES = AssetStatusSchema.options

// NOTE: the lab no longer authors a calibration periodicity / next-calibration
// date. Periodicity is the equipment owner's (customer's) decision, set in the
// client portal (ISO/IEC 17025:2017 §7.8.4.3 + ILAC-G24 / OIML D 10). The old
// `buildCalibrationPeriodicityPresets` quick-select was removed for that reason.

export type AssetFormData = {
  customerId: number | null
  assetTypeId: number | null
  name: string
  manufacturer: string
  model: string
  serialNumber: string
  tag: string
  status: AssetStatus
  baseMeasurementUnit: MeasurementUnit | null
  lastCalibrationDate: Date | undefined
  comments: string
  subjectToLegalMetrology: boolean
  specifications: Record<string, unknown>
}

export type AssetEditFormData = Omit<
  AssetFormData,
  'customerId' | 'assetTypeId' | 'baseMeasurementUnit'
>

export type AssetFormField = keyof AssetFormData | `spec_${string}`
export type AssetEditFormField = keyof AssetEditFormData | `spec_${string}`

export type AssetSpecificationField = {
  key: string
  label: string
  type?: string
  required?: boolean
}

export type ParseAssetFormOptions = {
  requiresMassBaseUnit?: boolean
  specificationFields?: readonly AssetSpecificationField[]
}

export function isAssetFormStatus(value: unknown): value is AssetStatus {
  return (
    typeof value === 'string' &&
    ASSET_FORM_STATUSES.some((status) => status === value)
  )
}

export function isAssetSpecificationErrorField(
  field: string,
): field is `spec_${string}` {
  return field.startsWith('spec_')
}

export function parseAssetForm(
  data: AssetFormData,
  options: ParseAssetFormOptions = {},
): FeatureFormValidationResult<CreateAssetInput, AssetFormField> {
  const fieldErrors: Array<{ field: AssetFormField; message: string }> = []

  const hasCustomerId =
    typeof data.customerId === 'number' && data.customerId > 0
  const hasAssetTypeId =
    typeof data.assetTypeId === 'number' && data.assetTypeId > 0
  const name = data.name.trim()
  const manufacturer = optionalText(data.manufacturer)
  const model = optionalText(data.model)
  const lastCalibrationDate = data.lastCalibrationDate?.toISOString()
  const comments = optionalText(data.comments)
  const specifications =
    Object.keys(data.specifications).length > 0
      ? data.specifications
      : undefined

  if (!hasCustomerId) {
    fieldErrors.push({
      field: 'customerId',
      message: 'Cliente é obrigatório',
    })
  }

  if (!hasAssetTypeId) {
    fieldErrors.push({
      field: 'assetTypeId',
      message: 'Tipo de instrumento é obrigatório',
    })
  }

  if (!name) {
    fieldErrors.push({
      field: 'name',
      message: 'Nome é obrigatório',
    })
  }

  const parsed = CreateAssetSchema.safeParse({
    customerId: hasCustomerId ? data.customerId : 1,
    assetTypeId: hasAssetTypeId ? data.assetTypeId : 1,
    name: name || 'Ativo',
    serialNumber: data.serialNumber.trim(),
    tag: data.tag.trim(),
    status: data.status,
    baseMeasurementUnit: data.baseMeasurementUnit,
    subjectToLegalMetrology: data.subjectToLegalMetrology,
    ...(manufacturer ? { manufacturer } : {}),
    ...(model ? { model } : {}),
    ...(lastCalibrationDate ? { lastCalibrationDate } : {}),
    ...(comments ? { comments } : {}),
    ...(specifications ? { specifications } : {}),
  })

  if (!parsed.success) {
    const schemaErrors = zodFormError(parsed.error.issues, [
      'customerId',
      'assetTypeId',
      'name',
      'manufacturer',
      'model',
      'serialNumber',
      'tag',
      'status',
      'baseMeasurementUnit',
      'lastCalibrationDate',
      'comments',
      'specifications',
    ])
    if (!schemaErrors.success) {
      fieldErrors.push(...schemaErrors.fieldErrors)
    }
  }

  if (options.requiresMassBaseUnit && !data.baseMeasurementUnit) {
    fieldErrors.push({
      field: 'baseMeasurementUnit',
      message: 'Selecione a unidade base do instrumento',
    })
  }

  fieldErrors.push(
    ...collectSpecificationErrors(
      data.specifications,
      options.specificationFields,
    ),
  )

  if (fieldErrors.length > 0) {
    return {
      success: false,
      message: fieldErrors[0]?.message ?? 'Dados inválidos',
      fieldErrors,
    }
  }

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos',
      fieldErrors,
    }
  }

  return { success: true, data: parsed.data }
}

export function parseAssetEditForm(
  data: AssetEditFormData,
  options: ParseAssetFormOptions = {},
): FeatureFormValidationResult<UpdateAssetInput, AssetEditFormField> {
  const fieldErrors: Array<{ field: AssetEditFormField; message: string }> = []
  const name = data.name.trim()
  const manufacturer = optionalText(data.manufacturer)
  const model = optionalText(data.model)
  const lastCalibrationDate = data.lastCalibrationDate?.toISOString()
  const comments = optionalText(data.comments)
  const specifications =
    Object.keys(data.specifications).length > 0
      ? data.specifications
      : undefined

  if (!name) {
    fieldErrors.push({
      field: 'name',
      message: 'Nome é obrigatório',
    })
  }

  const parsed = UpdateAssetSchema.safeParse({
    name: name || 'Ativo',
    serialNumber: data.serialNumber.trim(),
    tag: data.tag.trim(),
    status: data.status,
    subjectToLegalMetrology: data.subjectToLegalMetrology,
    ...(manufacturer ? { manufacturer } : {}),
    ...(model ? { model } : {}),
    ...(lastCalibrationDate ? { lastCalibrationDate } : {}),
    ...(comments ? { comments } : {}),
    ...(specifications ? { specifications } : {}),
  })

  if (!parsed.success) {
    const schemaErrors = zodFormError(parsed.error.issues, [
      'name',
      'manufacturer',
      'model',
      'serialNumber',
      'tag',
      'status',
      'lastCalibrationDate',
      'comments',
      'specifications',
    ])
    if (!schemaErrors.success) {
      fieldErrors.push(...schemaErrors.fieldErrors)
    }
  }

  fieldErrors.push(
    ...collectSpecificationErrors(
      data.specifications,
      options.specificationFields,
    ),
  )

  if (fieldErrors.length > 0) {
    return {
      success: false,
      message: fieldErrors[0]?.message ?? 'Dados inválidos',
      fieldErrors,
    }
  }

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos',
      fieldErrors,
    }
  }

  return { success: true, data: parsed.data }
}

function optionalText(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function isMissingSpecificationValue(
  value: unknown,
  field: AssetSpecificationField,
) {
  if (value === undefined || value === null || value === '') {
    return true
  }

  return (
    field.type === 'weighing_ranges' &&
    (!Array.isArray(value) || value.length === 0)
  )
}

function collectSpecificationErrors(
  specifications: Record<string, unknown>,
  fields: readonly AssetSpecificationField[] | undefined,
): Array<{ field: `spec_${string}`; message: string }> {
  const fieldErrors: Array<{ field: `spec_${string}`; message: string }> = []

  for (const field of fields ?? []) {
    if (!field.required) {
      continue
    }

    if (isMissingSpecificationValue(specifications[field.key], field)) {
      fieldErrors.push({
        field: `spec_${field.key}`,
        message: `${field.label} é obrigatório`,
      })
    }
  }

  return fieldErrors
}
