import { CreateJobSchema, type CreateJobInput } from '@calibra-facil/schemas'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'
import type { NewJobSearch } from './new-job-search'

export type JobFormData = {
  customerId: number | null
  assetId: number | null
  serviceId: number | null
  technicianId: string | null
  dueDate: Date | null
  // DOM-02 (#655): the repair OS this calibration was opened from, when any.
  // Seeded from the route search and threaded into the create payload so the
  // job records the back-link. Optional + not a user-editable field, so a
  // standalone calibration form omits it entirely.
  sourceServiceOrderId?: number | null
}

export type JobFormField = keyof JobFormData

export const emptyJobFormData: JobFormData = {
  customerId: null,
  assetId: null,
  serviceId: null,
  technicianId: null,
  dueDate: null,
  sourceServiceOrderId: null,
}

/**
 * REQ-DOM-REP-002: seed the new-calibration form from the source repair OS.
 * Customer + asset are inherited so the technician does not re-enter them; the
 * source OS id is carried (hidden) so the created job records the link.
 */
export function buildInitialJobFormData(search: NewJobSearch): JobFormData {
  return {
    ...emptyJobFormData,
    customerId: search.customerId ?? null,
    assetId: search.assetId ?? null,
    sourceServiceOrderId: search.serviceOrderId ?? null,
  }
}

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
    // Only carried when present so a standalone calibration's payload is
    // unchanged (keeps the existing forms.test.ts contract exact).
    sourceServiceOrderId: data.sourceServiceOrderId ?? undefined,
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
