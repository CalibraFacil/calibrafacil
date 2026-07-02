import {
  CreateMaterialSchema,
  UpdateMaterialSchema,
  type CreateMaterialInput,
  type UpdateMaterialInput,
} from '@calibra-facil/schemas'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'

export type MaterialFormData = {
  name: string
  description: string
  sku: string
  unit: string
  unitCostCents: string
  unitPriceCents: string
  controlsStock: boolean
  isActive: boolean
}

export type MaterialFormField = keyof MaterialFormData

export function parseMaterialForm(
  data: MaterialFormData,
): FeatureFormValidationResult<CreateMaterialInput, MaterialFormField> {
  return parseMaterialPayload(data, CreateMaterialSchema)
}

export function parseMaterialEditForm(
  data: MaterialFormData,
): FeatureFormValidationResult<UpdateMaterialInput, MaterialFormField> {
  return parseMaterialPayload(data, UpdateMaterialSchema)
}

function parseMaterialPayload<TInput>(
  data: MaterialFormData,
  schema: { safeParse: (value: unknown) => SafeParseResult<TInput> },
): FeatureFormValidationResult<TInput, MaterialFormField> {
  const fieldErrors: Array<{ field: MaterialFormField; message: string }> = []
  const name = data.name.trim()
  const description = optionalText(data.description)
  const sku = optionalText(data.sku)
  const unit = optionalText(data.unit)
  const unitCostCents = parseMoneyInCents(data.unitCostCents)
  const unitPriceCents = parseMoneyInCents(data.unitPriceCents)

  if (!name) {
    fieldErrors.push({
      field: 'name',
      message: 'Nome é obrigatório',
    })
  }

  if (unitCostCents === 'invalid') {
    fieldErrors.push({
      field: 'unitCostCents',
      message: 'Custo inválido',
    })
  }

  if (unitPriceCents === 'invalid') {
    fieldErrors.push({
      field: 'unitPriceCents',
      message: 'Preço inválido',
    })
  }

  const parsed = schema.safeParse({
    name: name || 'Material',
    ...(description ? { description } : {}),
    ...(sku ? { sku } : {}),
    ...(unit ? { unit } : {}),
    unitCostCents:
      unitCostCents === 'empty' || unitCostCents === 'invalid'
        ? null
        : unitCostCents,
    unitPriceCents:
      unitPriceCents === 'empty' || unitPriceCents === 'invalid'
        ? null
        : unitPriceCents,
    controlsStock: data.controlsStock,
    isActive: data.isActive,
  })

  if (!parsed.success) {
    const schemaErrors = zodFormError(parsed.error.issues, [
      'name',
      'description',
      'sku',
      'unit',
      'unitCostCents',
      'unitPriceCents',
      'controlsStock',
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

function parseMoneyInCents(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return 'empty'

  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) {
    return 'invalid'
  }

  return Math.round(amount * 100)
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
