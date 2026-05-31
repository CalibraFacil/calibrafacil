import { CreateCompetenceRequestSchema } from '@calibra-facil/schemas'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'

export type CompetenceRequestFormData = {
  userId: string
  assetTypeId: string
  scopeDescription: string
}

export type CompetenceRequestFormField = keyof CompetenceRequestFormData
export type CompetenceRequestPayload = {
  userId: string
  assetTypeId?: number
  scopeDescription: string
}

export function parseCompetenceRequestForm(
  data: CompetenceRequestFormData,
): FeatureFormValidationResult<
  CompetenceRequestPayload,
  CompetenceRequestFormField
> {
  const payload = {
    userId: data.userId,
    ...(data.assetTypeId ? { assetTypeId: Number(data.assetTypeId) } : {}),
    scopeDescription: data.scopeDescription.trim(),
  }
  const parsed = CreateCompetenceRequestSchema.safeParse(payload)

  if (!parsed.success) {
    const schemaErrors = zodFormError(parsed.error.issues, [
      'userId',
      'assetTypeId',
      'scopeDescription',
    ])
    if (!schemaErrors.success) {
      return {
        success: false,
        message: schemaErrors.message,
        fieldErrors: schemaErrors.fieldErrors.map((error) =>
          mapCompetenceSchemaError(error),
        ),
      }
    }

    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos',
      fieldErrors: [],
    }
  }

  return { success: true, data: payload }
}

function mapCompetenceSchemaError(error: {
  field: CompetenceRequestFormField
  message: string
}) {
  if (error.field === 'userId') {
    return { ...error, message: 'Selecione um técnico' }
  }

  return error
}
