import {
  CreateReferenceStandardSchema,
  RenewCertificateSchema,
  UpdateReferenceStandardSchema,
  type CreateReferenceStandardInput,
  type ReferenceStandardKind,
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
import { metrologyKindDefinition } from './metrology-kinds'

export type StandardCertifiedValueFormData = {
  nominal: string
  authentication: string
  value: string
  uncertainty: string
  unit: string
  maxError: string
  drift: string
  buoyancy: string
  coverageFactor: string
}

export type StandardMetrologyPointFormData = {
  reference: string
  indication: string
  meanReading: string
  correction: string
  uncertainty: string
  unit: string
  coverageFactor: string
  degreesOfFreedom: string
  degreesOfFreedomOperator: 'exact' | 'greater_than' | 'infinity'
  repeatability: string
  metadata?: Record<string, unknown>
}

export type StandardMetrologyChannelFormData = {
  key: string
  label: string
  quantity: string
  value: string
  correction: string
  uncertainty: string
  unit: string
  coverageFactor: string
  drift: string
  notes: string
  points: Array<StandardMetrologyPointFormData>
}

export type StandardCompositionProfileFormData = {
  profileKey: string
  profileClass: string
  nominal: string
  value: string
  uncertainty: string
  unit: string
  maxError: string
  drift: string
  buoyancy: string
  coverageFactor: string
  quantityAvailable: string
}

export type StandardFormData = {
  name: string
  kind: ReferenceStandardKind
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
  channels: Array<StandardMetrologyChannelFormData>
  certifiedValues: Array<StandardCertifiedValueFormData>
  compositionProfiles: Array<StandardCompositionProfileFormData>
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
  | 'channels'
  | 'certifiedValues'
  | 'compositionProfiles'
> & {
  reason: string
}

export type StandardFormField = keyof StandardFormData
export type StandardRenewFormField = keyof StandardRenewFormData

export type ParseStandardFormOptions = {
  isMultiValue?: boolean
}

export const INITIAL_STANDARD_CERTIFIED_VALUE: StandardCertifiedValueFormData =
  {
    nominal: '',
    authentication: '',
    value: '',
    uncertainty: '',
    unit: '',
    maxError: '',
    drift: '',
    buoyancy: '',
    coverageFactor: '',
  }

export const INITIAL_STANDARD_CHANNEL: StandardMetrologyChannelFormData = {
  key: '',
  label: '',
  quantity: '',
  value: '',
  correction: '',
  uncertainty: '',
  unit: '',
  coverageFactor: '',
  drift: '',
  notes: '',
  points: [],
}

export const INITIAL_STANDARD_POINT: StandardMetrologyPointFormData = {
  reference: '',
  indication: '',
  meanReading: '',
  correction: '',
  uncertainty: '',
  unit: '',
  coverageFactor: '',
  degreesOfFreedom: '',
  degreesOfFreedomOperator: 'exact',
  repeatability: '',
}

export const INITIAL_STANDARD_COMPOSITION_PROFILE: StandardCompositionProfileFormData =
  {
    profileKey: '',
    profileClass: '',
    nominal: '',
    value: '',
    uncertainty: '',
    unit: '',
    maxError: '',
    drift: '',
    buoyancy: '',
    coverageFactor: '',
    quantityAvailable: '',
  }

export const INITIAL_STANDARD_FORM_DATA: StandardFormData = {
  name: '',
  kind: 'generic_scalar',
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
  channels: [],
  certifiedValues: [],
  compositionProfiles: [],
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

export function createStandardChannelDraft(
  value?: Partial<StandardMetrologyChannelFormData>,
): StandardMetrologyChannelFormData {
  return {
    ...INITIAL_STANDARD_CHANNEL,
    ...value,
  }
}

export function createStandardPointDraft(
  value?: Partial<StandardMetrologyPointFormData>,
): StandardMetrologyPointFormData {
  return {
    ...INITIAL_STANDARD_POINT,
    ...value,
  }
}

export function createStandardCompositionProfileDraft(
  value?: Partial<StandardCompositionProfileFormData>,
): StandardCompositionProfileFormData {
  return {
    ...INITIAL_STANDARD_COMPOSITION_PROFILE,
    ...value,
  }
}

export function createChannelsForKind(kind: ReferenceStandardKind) {
  return metrologyKindDefinition(kind).channels.map((channel) =>
    createStandardChannelDraft(channel),
  )
}

export function inferStandardKind(
  standard?: Pick<
    StandardDetail,
    'kind' | 'name' | 'type' | 'certifiedValues' | 'referenceValue'
  >,
): ReferenceStandardKind {
  if (standard?.kind && standard.kind !== 'generic_scalar') {
    return standard.kind
  }

  const label = `${standard?.name ?? ''} ${standard?.type ?? ''}`.toLowerCase()
  const certifiedValues = standard?.certifiedValues ?? []
  const hasCompositionProfiles = certifiedValues.some(
    (value) => value.compositionProfile === true,
  )

  if (label.includes('temperatura') && label.includes('umidade')) {
    return 'thermohygrometer'
  }
  if (label.includes('pressão') || label.includes('pressao')) {
    return 'barometer'
  }
  if (label.includes('peso') || label.includes('kg') || label.includes(' g')) {
    return certifiedValues.length > 1 || hasCompositionProfiles
      ? 'mass_set'
      : 'mass_single'
  }
  if (certifiedValues.length > 1) return 'mass_set'
  if (certifiedValues.length === 1) return 'mass_single'
  return 'generic_scalar'
}

export function createStandardFormData(
  standard?: StandardDetail,
): StandardFormData {
  if (!standard) {
    return {
      ...INITIAL_STANDARD_FORM_DATA,
      channels: [],
      certifiedValues: [],
      compositionProfiles: [],
    }
  }

  const kind = inferStandardKind(standard)
  const metrologyData = standard.metrologyData
  const legacyValues = standard.certifiedValues ?? []
  const massValues =
    metrologyData?.massValues.length === 0
      ? legacyValues.filter((value) => value.compositionProfile !== true)
      : (metrologyData?.massValues ??
        legacyValues.filter((value) => value.compositionProfile !== true))
  const compositionProfiles =
    metrologyData?.compositionProfiles.length === 0
      ? legacyValues
          .filter((value) => value.compositionProfile === true)
          .map((value) => ({
            profileKey: value.profileKey ?? value.nominal,
            profileClass: value.profileClass ?? '',
            nominal: value.nominal,
            value: value.value,
            uncertainty: value.uncertainty,
            unit: value.unit,
            maxError: value.maxError,
            drift: value.drift,
            buoyancy: value.buoyancy,
            coverageFactor: value.coverageFactor,
            quantityAvailable: value.profileQuantityAvailable,
          }))
      : (metrologyData?.compositionProfiles ??
        legacyValues
          .filter((value) => value.compositionProfile === true)
          .map((value) => ({
            profileKey: value.profileKey ?? value.nominal,
            profileClass: value.profileClass ?? '',
            nominal: value.nominal,
            value: value.value,
            uncertainty: value.uncertainty,
            unit: value.unit,
            maxError: value.maxError,
            drift: value.drift,
            buoyancy: value.buoyancy,
            coverageFactor: value.coverageFactor,
            quantityAvailable: value.profileQuantityAvailable,
          })))
  const channels =
    metrologyData?.channels.length === 0
      ? createChannelsForKind(kind)
      : (metrologyData?.channels ?? createChannelsForKind(kind))

  return {
    name: standard.name,
    kind,
    type: standard.type || metrologyKindDefinition(kind).typeLabel,
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
    channels: channels.map((channel) =>
      createStandardChannelDraft({
        key: channel.key,
        label: channel.label,
        quantity: channel.quantity,
        value: channel.value?.toString() ?? '',
        correction: channel.correction?.toString() ?? '',
        uncertainty: channel.uncertainty?.toString() ?? '',
        unit: channel.unit,
        coverageFactor: channel.coverageFactor?.toString() ?? '',
        drift: channel.drift?.toString() ?? '',
        notes: channel.notes ?? '',
        points:
          channel.points?.map((point) =>
            createStandardPointDraft({
              reference: point.reference?.toString() ?? '',
              indication: point.indication?.toString() ?? '',
              meanReading: point.meanReading?.toString() ?? '',
              correction: point.correction?.toString() ?? '',
              uncertainty: point.uncertainty?.toString() ?? '',
              unit: point.unit,
              coverageFactor: point.coverageFactor?.toString() ?? '',
              degreesOfFreedom: point.degreesOfFreedom?.toString() ?? '',
              degreesOfFreedomOperator:
                point.degreesOfFreedomOperator ?? 'exact',
              repeatability: point.repeatability?.toString() ?? '',
              metadata: point.metadata,
            }),
          ) ?? [],
      }),
    ),
    certifiedValues: massValues.map((value) =>
      createStandardCertifiedValueDraft({
        nominal: value.nominal,
        authentication: value.authentication ?? '',
        value: value.value.toString(),
        uncertainty: value.uncertainty.toString(),
        unit: value.unit,
        maxError: value.maxError?.toString() || '',
        drift: value.drift?.toString() || '',
        buoyancy: value.buoyancy?.toString() || '',
        coverageFactor: value.coverageFactor?.toString() || '',
      }),
    ),
    compositionProfiles: compositionProfiles.map((value) =>
      createStandardCompositionProfileDraft({
        profileKey: value.profileKey,
        profileClass: value.profileClass ?? '',
        nominal: value.nominal,
        value: value.value.toString(),
        uncertainty: value.uncertainty.toString(),
        unit: value.unit,
        maxError: value.maxError?.toString() || '',
        drift: value.drift?.toString() || '',
        buoyancy: value.buoyancy?.toString() || '',
        coverageFactor: value.coverageFactor?.toString() || '',
        quantityAvailable: value.quantityAvailable?.toString() || '',
      }),
    ),
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
    channels: formData.channels,
    certifiedValues: formData.certifiedValues,
    compositionProfiles: formData.compositionProfiles,
    reason: '',
  }
}

export function hasCertifiedValues(standard: StandardDetail) {
  return Boolean(
    standard.metrologyData?.massValues.length ||
    standard.certifiedValues?.length,
  )
}

export function parseStandardForm(
  data: StandardFormData,
  options: ParseStandardFormOptions = {},
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
  options: ParseStandardFormOptions = {},
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
  _options: ParseStandardFormOptions = {},
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

  const massValues = parseMassValues(
    data.certifiedValues,
    fieldErrors,
    'certifiedValues',
    { requireRows: false },
  )
  const compositionProfiles = parseCompositionProfiles(
    data.compositionProfiles,
    fieldErrors,
    'compositionProfiles',
  )
  const channels = parseChannels(data.channels, fieldErrors, 'channels')
  const certifiedValues = [
    ...massValues,
    ...compositionProfiles.map((profile) => ({
      nominal: profile.nominal,
      value: profile.value,
      uncertainty: profile.uncertainty,
      unit: profile.unit,
      maxError: profile.maxError,
      drift: profile.drift,
      buoyancy: profile.buoyancy,
      coverageFactor: profile.coverageFactor,
      compositionProfile: true,
      profileKey: profile.profileKey,
      profileClass: profile.profileClass,
      profileQuantityAvailable: profile.quantityAvailable,
    })),
  ]

  const parsed = RenewCertificateSchema.safeParse({
    certificateNumber: data.certificateNumber.trim(),
    calibratedBy: optionalText(data.calibratedBy),
    calibrationDate: data.calibrationDate,
    nextCalibrationDate: data.nextCalibrationDate,
    reason: data.reason.trim(),
    coverageFactor: optionalNumber(data.coverageFactor, undefined),
    referenceValue: optionalNumber(data.referenceValue, undefined),
    uncertainty: optionalNumber(data.uncertainty, undefined),
    uncertaintyUnit: optionalText(data.uncertaintyUnit),
    certifiedValues: certifiedValues.length > 0 ? certifiedValues : undefined,
    metrologyData: {
      version: 1,
      channels,
      massValues,
      compositionProfiles,
    },
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
      'compositionProfiles',
      'channels',
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

function dateInputValue(value?: string | Date | null) {
  return value ? new Date(value).toISOString().split('T')[0] : ''
}

function parseStandardPayload<TData>(
  data: StandardFormData,
  _options: ParseStandardFormOptions,
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

  const definition = metrologyKindDefinition(data.kind)
  const massValues = parseMassValues(
    data.certifiedValues,
    fieldErrors,
    'certifiedValues',
    { requireRows: definition.mode === 'mass' },
  )
  const channels = parseChannels(data.channels, fieldErrors, 'channels')
  const compositionProfiles = parseCompositionProfiles(
    data.compositionProfiles,
    fieldErrors,
    'compositionProfiles',
  )
  const singleValuePayload =
    definition.mode === 'scalar'
      ? parseSingleValueFields(data, fieldErrors, payloadOptions)
      : {
          referenceValue:
            definition.mode === 'channels'
              ? optionalNumber(
                  firstFilledChannel(channels)?.value?.toString() ?? '',
                  payloadOptions.emptyOptionalValue,
                )
              : payloadOptions.emptyOptionalValue,
          uncertainty:
            definition.mode === 'channels'
              ? optionalNumber(
                  firstFilledChannel(channels)?.uncertainty?.toString() ?? '',
                  payloadOptions.emptyOptionalValue,
                )
              : payloadOptions.emptyOptionalValue,
          uncertaintyUnit:
            definition.mode === 'channels'
              ? (firstFilledChannel(channels)?.unit ??
                payloadOptions.emptyOptionalValue)
              : payloadOptions.emptyOptionalValue,
        }

  const certifiedValues = [
    ...massValues,
    ...compositionProfiles.map((profile) => ({
      nominal: profile.nominal,
      value: profile.value,
      uncertainty: profile.uncertainty,
      unit: profile.unit,
      maxError: profile.maxError,
      drift: profile.drift,
      buoyancy: profile.buoyancy,
      coverageFactor: profile.coverageFactor,
      compositionProfile: true,
      profileKey: profile.profileKey,
      profileClass: profile.profileClass,
      profileQuantityAvailable: profile.quantityAvailable,
    })),
  ]

  const payload = {
    name: data.name.trim() || 'Padrão',
    kind: data.kind,
    type: optionalTextOr(
      data.type || definition.typeLabel,
      payloadOptions.emptyOptionalValue,
    ),
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
    certifiedValues: certifiedValues.length
      ? certifiedValues
      : payloadOptions.emptyOptionalValue,
    metrologyData: {
      version: 1,
      channels,
      massValues,
      compositionProfiles,
    },
    ...singleValuePayload,
  }

  const parsed = schema.safeParse(payload)

  if (!parsed.success) {
    const schemaErrors = zodFormError(parsed.error.issues, [
      'name',
      'kind',
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
      'channels',
      'certifiedValues',
      'compositionProfiles',
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

function firstFilledChannel(
  channels: Array<{
    value?: number | null
    uncertainty?: number | null
    unit: string
  }>,
) {
  return (
    channels.find(
      (channel) => channel.value != null || channel.uncertainty != null,
    ) ?? channels[0]
  )
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

function parseMassValues<TField extends string>(
  values: Array<StandardCertifiedValueFormData>,
  fieldErrors: Array<{ field: TField; message: string }>,
  fieldName: TField,
  options: { requireRows: boolean },
) {
  const filledValues = values.filter((value) =>
    [
      value.nominal,
      value.authentication,
      value.value,
      value.uncertainty,
      value.unit,
      value.maxError,
      value.drift,
      value.buoyancy,
      value.coverageFactor,
    ].some((part) => part.trim()),
  )

  if (options.requireRows && filledValues.length === 0) {
    fieldErrors.push({
      field: fieldName,
      message: 'Adicione pelo menos um valor de massa',
    })
  }

  return filledValues.map((value, index) => {
    if (
      !value.nominal.trim() ||
      !value.value.trim() ||
      !value.uncertainty.trim() ||
      !value.unit.trim()
    ) {
      fieldErrors.push({
        field: fieldName,
        message: `Valor ${index + 1}: preencha nominal, valor, incerteza e unidade`,
      })
    }

    pushNumericErrors(value, fieldErrors, fieldName, `Valor ${index + 1}`)

    return {
      nominal: value.nominal.trim(),
      authentication: optionalTextOr(value.authentication, null),
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

function parseChannels<TField extends string>(
  values: Array<StandardMetrologyChannelFormData>,
  fieldErrors: Array<{ field: TField; message: string }>,
  fieldName: TField,
) {
  const filledValues = values.filter((value) =>
    [
      value.key,
      value.label,
      value.quantity,
      value.value,
      value.correction,
      value.uncertainty,
      value.unit,
      value.coverageFactor,
      value.drift,
      value.notes,
    ].some((part) => part.trim()),
  )

  return filledValues.map((value, index) => {
    if (!value.key.trim() || !value.label.trim() || !value.unit.trim()) {
      fieldErrors.push({
        field: fieldName,
        message: `Canal ${index + 1}: preencha chave, nome e unidade`,
      })
    }
    pushNumericErrors(value, fieldErrors, fieldName, `Canal ${index + 1}`, [
      'value',
      'correction',
      'uncertainty',
      'coverageFactor',
      'drift',
    ])

    return {
      key: normalizeKey(value.key),
      label: value.label.trim(),
      quantity: value.quantity.trim() || normalizeKey(value.label),
      value: optionalNumber(value.value, null),
      correction: optionalNumber(value.correction, null),
      uncertainty: optionalNumber(value.uncertainty, null),
      unit: value.unit.trim(),
      coverageFactor: optionalNumber(value.coverageFactor, null),
      drift: optionalNumber(value.drift, null),
      notes: optionalTextOr(value.notes, null),
      points: parseChannelPoints(value.points, fieldErrors, fieldName, index),
    }
  })
}

function parseChannelPoints<TField extends string>(
  points: Array<StandardMetrologyPointFormData>,
  fieldErrors: Array<{ field: TField; message: string }>,
  fieldName: TField,
  channelIndex: number,
) {
  return points.map((point, pointIndex) => {
    pushNumericErrors(
      point,
      fieldErrors,
      fieldName,
      `Canal ${channelIndex + 1}, ponto ${pointIndex + 1}`,
      [
        'reference',
        'indication',
        'meanReading',
        'correction',
        'uncertainty',
        'coverageFactor',
        'repeatability',
        ...(point.degreesOfFreedomOperator === 'infinity'
          ? []
          : (['degreesOfFreedom'] as const)),
      ],
    )

    if (
      point.degreesOfFreedomOperator === 'greater_than' &&
      !point.degreesOfFreedom.trim()
    ) {
      fieldErrors.push({
        field: fieldName,
        message: `Canal ${channelIndex + 1}, ponto ${pointIndex + 1}: graus de liberdade exige valor quando o operador é >`,
      })
    }

    if (!point.unit.trim()) {
      fieldErrors.push({
        field: fieldName,
        message: `Canal ${channelIndex + 1}, ponto ${pointIndex + 1}: unidade é obrigatória`,
      })
    }

    return {
      reference: optionalNumber(point.reference, null),
      indication: optionalNumber(point.indication, null),
      meanReading: optionalNumber(point.meanReading, null),
      correction: optionalNumber(point.correction, null),
      uncertainty: optionalNumber(point.uncertainty, null),
      unit: point.unit.trim(),
      coverageFactor: optionalNumber(point.coverageFactor, null),
      degreesOfFreedom:
        point.degreesOfFreedomOperator === 'infinity'
          ? null
          : optionalNumber(point.degreesOfFreedom, null),
      degreesOfFreedomOperator: point.degreesOfFreedomOperator,
      repeatability: optionalNumber(point.repeatability, null),
      ...(point.metadata ? { metadata: point.metadata } : {}),
    }
  })
}

function parseCompositionProfiles<TField extends string>(
  values: Array<StandardCompositionProfileFormData>,
  fieldErrors: Array<{ field: TField; message: string }>,
  fieldName: TField,
) {
  const filledValues = values.filter((value) =>
    [
      value.profileKey,
      value.profileClass,
      value.nominal,
      value.value,
      value.uncertainty,
      value.unit,
      value.maxError,
      value.drift,
      value.buoyancy,
      value.coverageFactor,
      value.quantityAvailable,
    ].some((part) => part.trim()),
  )

  return filledValues.map((value, index) => {
    if (
      !value.profileKey.trim() ||
      !value.nominal.trim() ||
      !value.value.trim() ||
      !value.uncertainty.trim() ||
      !value.unit.trim()
    ) {
      fieldErrors.push({
        field: fieldName,
        message: `Perfil ${index + 1}: preencha perfil, nominal, valor, incerteza e unidade`,
      })
    }

    pushNumericErrors(value, fieldErrors, fieldName, `Perfil ${index + 1}`, [
      'value',
      'uncertainty',
      'maxError',
      'drift',
      'buoyancy',
      'coverageFactor',
      'quantityAvailable',
    ])

    return {
      profileKey: value.profileKey.trim(),
      profileClass: optionalTextOr(value.profileClass, null),
      nominal: value.nominal.trim(),
      value: optionalNumber(value.value, 0),
      uncertainty: optionalNumber(value.uncertainty, 0),
      unit: value.unit.trim(),
      maxError: optionalNumber(value.maxError, null),
      drift: optionalNumber(value.drift, null),
      buoyancy: optionalNumber(value.buoyancy, null),
      coverageFactor: optionalNumber(value.coverageFactor, null),
      quantityAvailable: optionalNumber(value.quantityAvailable, null),
    }
  })
}

function pushNumericErrors<TField extends string>(
  value: Record<string, unknown>,
  fieldErrors: Array<{ field: TField; message: string }>,
  fieldName: TField,
  label: string,
  fields: Array<string> = [
    'value',
    'uncertainty',
    'maxError',
    'drift',
    'buoyancy',
    'coverageFactor',
  ],
) {
  for (const field of fields) {
    const fieldValue = value[field]
    if (
      typeof fieldValue === 'string' &&
      fieldValue.trim() &&
      !Number.isFinite(Number(fieldValue))
    ) {
      fieldErrors.push({
        field: fieldName,
        message: `${label}: campo numérico inválido`,
      })
      break
    }
  }
}

function normalizeKey(value: string) {
  const normalized = value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  return normalized || 'channel'
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
