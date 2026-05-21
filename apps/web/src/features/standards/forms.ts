import {
  CreateReferenceStandardSchema,
  RenewCertificateSchema,
  UpdateReferenceStandardSchema,
  type CreateReferenceStandardInput,
  type ReferenceStandardStatus,
  type RenewCertificateInput,
  type UncertaintyDistribution,
  type UpdateReferenceStandardInput,
} from '@calibra-facil/schemas'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'
import type { StandardDetail } from './types'

export type StandardCertifiedValueFormData = {
  nominal: string
  value: string
  uncertainty: string
  unit: string
  maxError: string
  drift: string
  buoyancy: string
  coverageFactor: string
}

export type StandardFormData = {
  name: string
  type: string
  serialNumber: string
  manufacturer: string
  model: string
  certificateNumber: string
  calibratedBy: string
  calibrationDate: string
  nextCalibrationDate: string
  referenceValue: string
  uncertainty: string
  uncertaintyUnit: string
  coverageFactor: string
  distribution: UncertaintyDistribution
  drift: string
  certifiedValues: Array<StandardCertifiedValueFormData>
  status: ReferenceStandardStatus
}

export type StandardRenewFormData = Pick<
  StandardFormData,
  | 'certificateNumber'
  | 'calibratedBy'
  | 'calibrationDate'
  | 'nextCalibrationDate'
  | 'referenceValue'
  | 'uncertainty'
  | 'uncertaintyUnit'
  | 'coverageFactor'
  | 'certifiedValues'
> & {
  reason: string
}

export type StandardFormField = keyof StandardFormData
export type StandardRenewFormField = keyof StandardRenewFormData

export type ParseStandardFormOptions = {
  isMultiValue: boolean
}

export const INITIAL_STANDARD_CERTIFIED_VALUE: StandardCertifiedValueFormData =
  {
    nominal: '',
    value: '',
    uncertainty: '',
    unit: '',
    maxError: '',
    drift: '',
    buoyancy: '',
    coverageFactor: '',
  }

export const INITIAL_STANDARD_FORM_DATA: StandardFormData = {
  name: '',
  type: '',
  serialNumber: '',
  manufacturer: '',
  model: '',
  certificateNumber: '',
  calibratedBy: '',
  calibrationDate: '',
  nextCalibrationDate: '',
  referenceValue: '',
  uncertainty: '',
  uncertaintyUnit: '',
  coverageFactor: '2.0',
  distribution: 'normal',
  drift: '',
  certifiedValues: [],
  status: 'ACTIVE',
}

export const STANDARD_STATUS_LABELS: Record<
  StandardFormData['status'],
  string
> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  OUT_OF_TOLERANCE: 'Fora de Tolerância',
  SENT_FOR_CALIBRATION: 'Em Calibração',
}

export function createStandardCertifiedValueDraft(
  value?: Partial<StandardCertifiedValueFormData>,
): StandardCertifiedValueFormData {
  return {
    ...INITIAL_STANDARD_CERTIFIED_VALUE,
    ...value,
  }
}

export function createStandardFormData(
  standard?: StandardDetail,
): StandardFormData {
  if (!standard) {
    return {
      ...INITIAL_STANDARD_FORM_DATA,
      certifiedValues: [],
    }
  }

  return {
    name: standard.name,
    type: standard.type || '',
    serialNumber: standard.serialNumber,
    manufacturer: standard.manufacturer || '',
    model: standard.model || '',
    certificateNumber: standard.certificateNumber,
    calibratedBy: standard.calibratedBy || '',
    calibrationDate: dateInputValue(standard.calibrationDate),
    nextCalibrationDate: dateInputValue(standard.nextCalibrationDate),
    referenceValue: standard.referenceValue?.toString() || '',
    uncertainty: standard.uncertainty?.toString() || '',
    uncertaintyUnit: standard.uncertaintyUnit || '',
    coverageFactor: standard.coverageFactor?.toString() || '2.0',
    distribution: standard.distribution || 'normal',
    drift: standard.drift?.toString() || '',
    certifiedValues:
      standard.certifiedValues?.map((value) =>
        createStandardCertifiedValueDraft({
          nominal: value.nominal,
          value: value.value.toString(),
          uncertainty: value.uncertainty.toString(),
          unit: value.unit,
          maxError: value.maxError?.toString() || '',
          drift: value.drift?.toString() || '',
          buoyancy: value.buoyancy?.toString() || '',
          coverageFactor: value.coverageFactor?.toString() || '',
        }),
      ) ?? [],
    status: standard.status,
  }
}

export function createStandardRenewFormData(
  formData: StandardFormData,
): StandardRenewFormData {
  return {
    certificateNumber: '',
    calibratedBy: formData.calibratedBy,
    calibrationDate: '',
    nextCalibrationDate: '',
    referenceValue: formData.referenceValue,
    uncertainty: formData.uncertainty,
    uncertaintyUnit: formData.uncertaintyUnit,
    coverageFactor: formData.coverageFactor,
    certifiedValues: formData.certifiedValues,
    reason: '',
  }
}

export function hasCertifiedValues(standard: StandardDetail) {
  return Boolean(standard.certifiedValues?.length)
}

export function parseStandardForm(
  data: StandardFormData,
  options: ParseStandardFormOptions,
): FeatureFormValidationResult<
  CreateReferenceStandardInput,
  StandardFormField
> {
  return parseStandardPayload(data, options, CreateReferenceStandardSchema, {
    emptyOptionalValue: undefined,
  })
}

export function parseStandardEditForm(
  data: StandardFormData,
  options: ParseStandardFormOptions,
): FeatureFormValidationResult<
  UpdateReferenceStandardInput,
  StandardFormField
> {
  return parseStandardPayload(data, options, UpdateReferenceStandardSchema, {
    emptyOptionalValue: null,
  })
}

export function parseStandardRenewForm(
  data: StandardRenewFormData,
  options: ParseStandardFormOptions,
): FeatureFormValidationResult<RenewCertificateInput, StandardRenewFormField> {
  const fieldErrors: Array<{
    field: StandardRenewFormField
    message: string
  }> = []

  if (!data.certificateNumber.trim()) {
    fieldErrors.push({
      field: 'certificateNumber',
      message: 'Número do certificado é obrigatório',
    })
  }
  if (!data.calibrationDate) {
    fieldErrors.push({
      field: 'calibrationDate',
      message: 'Data de calibração é obrigatória',
    })
  }
  if (!data.nextCalibrationDate) {
    fieldErrors.push({
      field: 'nextCalibrationDate',
      message: 'Próxima calibração é obrigatória',
    })
  }
  if (!data.reason.trim()) {
    fieldErrors.push({
      field: 'reason',
      message: 'Motivo da renovação é obrigatório',
    })
  }

  const certifiedValues = options.isMultiValue
    ? parseCertifiedValues(data.certifiedValues, fieldErrors, 'certifiedValues')
    : undefined

  const parsed = RenewCertificateSchema.safeParse({
    certificateNumber: data.certificateNumber.trim(),
    calibratedBy: optionalText(data.calibratedBy),
    calibrationDate: data.calibrationDate,
    nextCalibrationDate: data.nextCalibrationDate,
    reason: data.reason.trim(),
    coverageFactor: optionalNumber(data.coverageFactor, undefined),
    ...(options.isMultiValue
      ? { certifiedValues }
      : {
          referenceValue: optionalNumber(data.referenceValue, undefined),
          uncertainty: optionalNumber(data.uncertainty, undefined),
          uncertaintyUnit: optionalText(data.uncertaintyUnit),
        }),
  })

  if (!parsed.success) {
    const schemaErrors = zodFormError(parsed.error.issues, [
      'certificateNumber',
      'calibratedBy',
      'calibrationDate',
      'nextCalibrationDate',
      'referenceValue',
      'uncertainty',
      'uncertaintyUnit',
      'coverageFactor',
      'certifiedValues',
      'reason',
    ])
    if (!schemaErrors.success) {
      appendFieldErrors(fieldErrors, schemaErrors.fieldErrors)
    }
  }

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

function dateInputValue(value?: string | null) {
  return value ? new Date(value).toISOString().split('T')[0] : ''
}

function parseStandardPayload<TData>(
  data: StandardFormData,
  options: ParseStandardFormOptions,
  schema: { safeParse: (value: unknown) => SafeParseResult<TData> },
  payloadOptions: { emptyOptionalValue: null | undefined },
): FeatureFormValidationResult<TData, StandardFormField> {
  const fieldErrors: Array<{ field: StandardFormField; message: string }> = []

  if (!data.name.trim()) {
    fieldErrors.push({ field: 'name', message: 'Nome é obrigatório' })
  }
  if (!data.serialNumber.trim()) {
    fieldErrors.push({
      field: 'serialNumber',
      message: 'Número de série é obrigatório',
    })
  }
  if (!data.certificateNumber.trim()) {
    fieldErrors.push({
      field: 'certificateNumber',
      message: 'Número do certificado é obrigatório',
    })
  }
  if (!data.calibrationDate) {
    fieldErrors.push({
      field: 'calibrationDate',
      message: 'Data de calibração é obrigatória',
    })
  }
  if (!data.nextCalibrationDate) {
    fieldErrors.push({
      field: 'nextCalibrationDate',
      message: 'Próxima calibração é obrigatória',
    })
  }

  const certifiedValues = options.isMultiValue
    ? parseCertifiedValues(data.certifiedValues, fieldErrors, 'certifiedValues')
    : payloadOptions.emptyOptionalValue

  const singleValuePayload = options.isMultiValue
    ? {
        referenceValue: payloadOptions.emptyOptionalValue,
        uncertainty: payloadOptions.emptyOptionalValue,
        uncertaintyUnit: payloadOptions.emptyOptionalValue,
      }
    : parseSingleValueFields(data, fieldErrors, payloadOptions)

  const payload = {
    name: data.name.trim() || 'Padrão',
    type: optionalTextOr(data.type, payloadOptions.emptyOptionalValue),
    serialNumber: data.serialNumber.trim(),
    manufacturer: optionalTextOr(
      data.manufacturer,
      payloadOptions.emptyOptionalValue,
    ),
    model: optionalTextOr(data.model, payloadOptions.emptyOptionalValue),
    certificateNumber: data.certificateNumber.trim(),
    calibratedBy: optionalTextOr(
      data.calibratedBy,
      payloadOptions.emptyOptionalValue,
    ),
    calibrationDate: data.calibrationDate,
    nextCalibrationDate: data.nextCalibrationDate,
    coverageFactor: optionalNumber(data.coverageFactor, 2.0),
    distribution: data.distribution,
    drift: optionalNumber(data.drift, payloadOptions.emptyOptionalValue),
    status: data.status,
    certifiedValues,
    ...singleValuePayload,
  }

  const parsed = schema.safeParse(payload)

  if (!parsed.success) {
    const schemaErrors = zodFormError(parsed.error.issues, [
      'name',
      'type',
      'serialNumber',
      'manufacturer',
      'model',
      'certificateNumber',
      'calibratedBy',
      'calibrationDate',
      'nextCalibrationDate',
      'referenceValue',
      'uncertainty',
      'uncertaintyUnit',
      'coverageFactor',
      'distribution',
      'drift',
      'certifiedValues',
      'status',
    ])
    if (!schemaErrors.success) {
      appendFieldErrors(fieldErrors, schemaErrors.fieldErrors)
    }
  }

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

function parseSingleValueFields(
  data: Pick<
    StandardFormData,
    'referenceValue' | 'uncertainty' | 'uncertaintyUnit'
  >,
  fieldErrors: Array<{ field: StandardFormField; message: string }>,
  payloadOptions: { emptyOptionalValue: null | undefined },
) {
  const hasReferenceValue = data.referenceValue.trim().length > 0
  const hasUncertainty = data.uncertainty.trim().length > 0
  const hasUncertaintyUnit = data.uncertaintyUnit.trim().length > 0

  if (hasReferenceValue || hasUncertainty || hasUncertaintyUnit) {
    if (!hasReferenceValue) {
      fieldErrors.push({
        field: 'referenceValue',
        message: 'Valor de referência é obrigatório',
      })
    }
    if (!hasUncertainty) {
      fieldErrors.push({
        field: 'uncertainty',
        message: 'Incerteza é obrigatória',
      })
    }
    if (!hasUncertaintyUnit) {
      fieldErrors.push({
        field: 'uncertaintyUnit',
        message: 'Unidade da incerteza é obrigatória',
      })
    }
  }

  return {
    referenceValue: optionalNumber(
      data.referenceValue,
      payloadOptions.emptyOptionalValue,
    ),
    uncertainty: optionalNumber(
      data.uncertainty,
      payloadOptions.emptyOptionalValue,
    ),
    uncertaintyUnit: optionalTextOr(
      data.uncertaintyUnit,
      payloadOptions.emptyOptionalValue,
    ),
  }
}

function parseCertifiedValues<TField extends string>(
  values: Array<StandardCertifiedValueFormData>,
  fieldErrors: Array<{ field: TField; message: string }>,
  certifiedValuesField: TField,
) {
  if (values.length === 0) {
    fieldErrors.push({
      field: certifiedValuesField,
      message: 'Adicione pelo menos um valor certificado',
    })
    return []
  }

  return values.map((value, index) => {
    if (
      !value.nominal.trim() ||
      !value.value.trim() ||
      !value.uncertainty.trim() ||
      !value.unit.trim()
    ) {
      fieldErrors.push({
        field: certifiedValuesField,
        message: `Valor ${index + 1}: Preencha todos os campos`,
      })
    }

    for (const field of [
      'value',
      'uncertainty',
      'maxError',
      'drift',
      'buoyancy',
      'coverageFactor',
    ] as const) {
      if (value[field].trim() && !Number.isFinite(Number(value[field]))) {
        fieldErrors.push({
          field: certifiedValuesField,
          message: `Valor ${index + 1}: Campo numérico inválido`,
        })
        break
      }
    }

    return {
      nominal: value.nominal.trim(),
      value: optionalNumber(value.value, 0),
      uncertainty: optionalNumber(value.uncertainty, 0),
      unit: value.unit.trim(),
      maxError: optionalNumber(value.maxError, null),
      drift: optionalNumber(value.drift, null),
      buoyancy: optionalNumber(value.buoyancy, null),
      coverageFactor: optionalNumber(value.coverageFactor, null),
    }
  })
}

function optionalText(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function optionalTextOr<TFallback extends null | undefined>(
  value: string,
  fallback: TFallback,
) {
  const trimmed = value.trim()
  return trimmed ? trimmed : fallback
}

function optionalNumber<TFallback extends null | undefined | number>(
  value: string,
  fallback: TFallback,
) {
  const trimmed = value.trim()
  if (!trimmed) return fallback

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : fallback
}

function appendFieldErrors<TField extends string>(
  errors: Array<{ field: TField; message: string }>,
  nextErrors: Array<{ field: TField; message: string }>,
) {
  for (const error of nextErrors) {
    if (!errors.some((item) => item.field === error.field)) {
      errors.push(error)
    }
  }
}

type SafeParseResult<TData> =
  | { success: true; data: TData }
  | {
      success: false
      error: { issues: Array<{ path: Array<PropertyKey>; message: string }> }
    }
