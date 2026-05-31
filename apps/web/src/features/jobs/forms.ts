import { CreateJobSchema, type CreateJobInput } from '@calibra-facil/schemas'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'

export type JobFormData = {
  customerId: number | null
  assetId: number | null
  serviceId: number | null
  technicianId: string | null
  dueDate: Date | null
}

export type JobFormField = keyof JobFormData

export function parseJobForm(
  data: JobFormData,
): FeatureFormValidationResult<CreateJobInput, JobFormField> {
  const fieldErrors: Array<{ field: JobFormField; message: string }> = []

  if (!data.customerId) {
    fieldErrors.push({ field: 'customerId', message: 'Selecione um cliente' })
  }

  const parsed = CreateJobSchema.safeParse({
    assetId: data.assetId ?? 0,
    serviceId: data.serviceId ?? 0,
    technicianId: data.technicianId || undefined,
    dueDate: data.dueDate?.toISOString(),
  })

  if (!parsed.success) {
    const schemaErrors = zodFormError(parsed.error.issues, [
      'assetId',
      'serviceId',
      'technicianId',
      'dueDate',
    ])
    if (!schemaErrors.success) {
      for (const error of schemaErrors.fieldErrors) {
        fieldErrors.push(mapJobSchemaError(error))
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

function mapJobSchemaError(error: { field: JobFormField; message: string }) {
  if (error.field === 'assetId') {
    return { ...error, message: 'Selecione um ativo' }
  }

  if (error.field === 'serviceId') {
    return { ...error, message: 'Selecione um servico' }
  }

  return error
}
