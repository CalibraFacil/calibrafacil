import { CreateServiceOrderSchema } from '@calibra-facil/schemas'
import type { CreateServiceOrderInput as ClientRuntimeCreateServiceOrderInput } from '@calibra-facil/client-runtime'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'

export type ServiceOrderIntakeType =
  | 'counter'
  | 'carrier'
  | 'third_party'
  | 'internal'
  | 'warranty_return'
export type ServiceOrderPriority = 'normal' | 'urgent' | 'contract' | 'warranty'
export type ServiceOrderDeliveryMethod =
  | 'pickup_at_lab'
  | 'ship_to_client'
  | 'third_party_pickup'

export type ServiceOrderFormData = {
  customerId: number | null
  assetId: number | null
  intakeType: ServiceOrderIntakeType
  isExternalService: boolean
  priority: ServiceOrderPriority
  deliveryMethod: ServiceOrderDeliveryMethod
  claimedDefect: string
  intakeCondition: string
  accessories: string
  removedSealingMarkNumber: string
  invoiceRemittanceNumber: string
  invoiceRemittanceKey: string
  carrierName: string
  carrierDocument: string
  thirdPartyName: string
  thirdPartyDocument: string
  thirdPartyPhone: string
  clientVisibleNotes: string
  internalNotes: string
  evaluationFeeCents: string
}

export type ServiceOrderFormField = keyof ServiceOrderFormData
export type ServiceOrderCreatePayload = ClientRuntimeCreateServiceOrderInput

export function parseServiceOrderForm(
  data: ServiceOrderFormData,
): FeatureFormValidationResult<
  ServiceOrderCreatePayload,
  ServiceOrderFormField
> {
  const fieldErrors: Array<{ field: ServiceOrderFormField; message: string }> =
    []

  if (!data.customerId) {
    fieldErrors.push({ field: 'customerId', message: 'Selecione um cliente' })
  }
  if (!data.assetId) {
    fieldErrors.push({ field: 'assetId', message: 'Selecione um instrumento' })
  }
  if (!data.claimedDefect.trim()) {
    fieldErrors.push({
      field: 'claimedDefect',
      message: 'Informe o defeito reclamado',
    })
  }
  if (!data.intakeCondition.trim()) {
    fieldErrors.push({
      field: 'intakeCondition',
      message: 'Informe a condição aparente de recebimento',
    })
  }
  if (data.intakeType === 'carrier' && !data.carrierName.trim()) {
    fieldErrors.push({
      field: 'carrierName',
      message: 'Informe a transportadora',
    })
  }
  if (data.intakeType === 'third_party' && !data.thirdPartyName.trim()) {
    fieldErrors.push({
      field: 'thirdPartyName',
      message: 'Informe o portador terceiro',
    })
  }

  const evaluationFeeCents = parseCurrencyCents(data.evaluationFeeCents)
  if (evaluationFeeCents === 'invalid') {
    fieldErrors.push({
      field: 'evaluationFeeCents',
      message: 'Taxa de avaliação inválida',
    })
  }

  const payload: ServiceOrderCreatePayload = {
    customerId: data.customerId ?? 0,
    assetId: data.assetId ?? 0,
    intakeType: data.intakeType,
    isExternalService: data.isExternalService,
    priority: data.priority,
    deliveryMethod: data.deliveryMethod,
    claimedDefect: data.claimedDefect.trim(),
    intakeCondition: data.intakeCondition.trim(),
    accessories: optionalText(data.accessories),
    removedSealingMarkNumber: optionalText(data.removedSealingMarkNumber),
    invoiceRemittanceNumber: optionalText(data.invoiceRemittanceNumber),
    invoiceRemittanceKey: optionalText(data.invoiceRemittanceKey),
    carrierName:
      data.intakeType === 'carrier' ? optionalText(data.carrierName) : null,
    carrierDocument:
      data.intakeType === 'carrier' ? optionalText(data.carrierDocument) : null,
    thirdPartyName:
      data.intakeType === 'third_party'
        ? optionalText(data.thirdPartyName)
        : null,
    thirdPartyDocument:
      data.intakeType === 'third_party'
        ? optionalText(data.thirdPartyDocument)
        : null,
    thirdPartyPhone:
      data.intakeType === 'third_party'
        ? optionalText(data.thirdPartyPhone)
        : null,
    clientVisibleNotes: optionalText(data.clientVisibleNotes),
    internalNotes: optionalText(data.internalNotes),
    evaluationFeeCents:
      evaluationFeeCents === 'invalid' ? 0 : evaluationFeeCents,
  }
  const parsed = CreateServiceOrderSchema.safeParse(payload)

  if (!parsed.success) {
    const schemaErrors = zodFormError(parsed.error.issues, [
      'customerId',
      'assetId',
      'intakeType',
      'priority',
      'deliveryMethod',
      'claimedDefect',
      'intakeCondition',
      'accessories',
      'removedSealingMarkNumber',
      'invoiceRemittanceNumber',
      'invoiceRemittanceKey',
      'carrierName',
      'carrierDocument',
      'thirdPartyName',
      'thirdPartyDocument',
      'thirdPartyPhone',
      'clientVisibleNotes',
      'internalNotes',
      'evaluationFeeCents',
    ])
    if (!schemaErrors.success) {
      appendFieldErrors(
        fieldErrors,
        schemaErrors.fieldErrors.map((error) =>
          mapServiceOrderSchemaError(error),
        ),
      )
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

  return { success: true, data: payload }
}

function optionalText(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parseCurrencyCents(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return 0

  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) {
    return 'invalid'
  }

  return Math.round(amount * 100)
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

function mapServiceOrderSchemaError(error: {
  field: ServiceOrderFormField
  message: string
}) {
  if (error.field === 'customerId') {
    return { ...error, message: 'Selecione um cliente' }
  }
  if (error.field === 'assetId') {
    return { ...error, message: 'Selecione um instrumento' }
  }

  return error
}

/**
 * The evaluation start is stored as a single timestamp but edited as a date
 * (calendar popover) plus an "HH:mm" field, matching the date+time idiom used
 * elsewhere in the app. These helpers keep the split/join out of JSX.
 */
export type ServiceStartDraft = {
  date: Date | undefined
  time: string
}

function padTimeUnit(value: number): string {
  return String(value).padStart(2, '0')
}

export function serviceStartDraftFromIso(
  iso: string | null | undefined,
): ServiceStartDraft {
  if (!iso) return { date: undefined, time: '' }
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return { date: undefined, time: '' }

  return {
    date: parsed,
    time: `${padTimeUnit(parsed.getHours())}:${padTimeUnit(parsed.getMinutes())}`,
  }
}

/**
 * Joins the draft back into an ISO instant. Returns null when no date is set
 * (the field is optional and clearable); a blank time means midnight local.
 */
export function serviceStartDraftToIso(
  draft: ServiceStartDraft,
): string | null {
  if (!draft.date) return null

  const [hours, minutes] = draft.time.split(':')
  const combined = new Date(draft.date)
  combined.setHours(Number(hours) || 0, Number(minutes) || 0, 0, 0)

  return Number.isNaN(combined.getTime()) ? null : combined.toISOString()
}

/** True when the draft resolves to a different instant than what is stored. */
export function isServiceStartDirty(
  draft: ServiceStartDraft,
  storedIso: string | null | undefined,
): boolean {
  const next = serviceStartDraftToIso(draft)
  const stored = storedIso ? new Date(storedIso).toISOString() : null
  return next !== stored
}
