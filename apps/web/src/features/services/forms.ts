import {
  CreateServiceSchema,
  UpdateServiceSchema,
  type CreateServiceInput,
  type UpdateServiceInput,
} from '@calibra-facil/schemas'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'

export type ServiceFormData = {
  name: string
  description: string
  methodId: number | null
  assetTypeId: number | null
  price: string
  tat: string
  isActive: boolean
}

export type ServiceFormField = keyof ServiceFormData

export function parseServiceForm(
  data: ServiceFormData,
): FeatureFormValidationResult<CreateServiceInput, ServiceFormField> {
  return parseServicePayload(data, CreateServiceSchema)
}

export function parseServiceEditForm(
  data: ServiceFormData,
): FeatureFormValidationResult<UpdateServiceInput, ServiceFormField> {
  return parseServicePayload(data, UpdateServiceSchema)
}

function parseServicePayload<TInput>(
  data: ServiceFormData,
  schema: { safeParse: (value: unknown) => SafeParseResult<TInput> },
): FeatureFormValidationResult<TInput, ServiceFormField> {
  const fieldErrors: Array<{ field: ServiceFormField; message: string }> = []
  const name = data.name.trim()
  const description = optionalText(data.description)
  const price = parsePriceInCents(data.price)
  const tat = parseTat(data.tat)

  if (!name) {
    fieldErrors.push({
      field: 'name',
      message: 'Nome é obrigatório',
    })
  }

  if (price === 'invalid') {
    fieldErrors.push({
      field: 'price',
      message: 'Preço inválido',
    })
  }

  if (tat === 'invalid') {
    fieldErrors.push({
      field: 'tat',
      message: 'Prazo deve ser pelo menos 1 dia',
    })
  }

  const parsed = schema.safeParse({
    name: name || 'Serviço',
    ...(description ? { description } : {}),
    methodId: data.methodId,
    assetTypeId: data.assetTypeId,
    price: price === 'empty' || price === 'invalid' ? null : price,
    tat: tat === 'empty' || tat === 'invalid' ? null : tat,
    isActive: data.isActive,
  })

  if (!parsed.success) {
    const schemaErrors = zodFormError(parsed.error.issues, [
      'name',
      'description',
      'methodId',
      'assetTypeId',
      'price',
      'tat',
      'isActive',
    ])
    if (!schemaErrors.success) {
      for (const error of schemaErrors.fieldErrors) {
        appendFieldError(fieldErrors, error)
      }
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

function optionalText(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function parsePriceInCents(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return 'empty'

  const price = Number(normalized)
  if (!Number.isFinite(price) || price < 0) {
    return 'invalid'
  }

  return Math.round(price * 100)
}

function parseTat(value: string) {
  const normalized = value.trim()
  if (!normalized) return 'empty'

  const tat = Number(normalized)
  if (!Number.isInteger(tat) || tat < 1) {
    return 'invalid'
  }

  return tat
}

function appendFieldError<TField extends string>(
  errors: Array<{ field: TField; message: string }>,
  error: { field: TField; message: string },
) {
  if (errors.some((item) => item.field === error.field)) {
    return
  }

  errors.push(error)
}

type SafeParseResult<TData> =
  | { success: true; data: TData }
  | {
      success: false
      error: { issues: Array<{ path: Array<PropertyKey>; message: string }> }
    }
