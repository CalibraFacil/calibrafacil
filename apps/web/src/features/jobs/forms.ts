import {
  CreateJobSchema,
  resolveExecutionPerformedAt,
  type CreateJobInput,
} from '@calibra-facil/schemas'

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

export type ExecutionPerformedAtForm = {
  /** Calendar day from the date input, `YYYY-MM-DD`, or '' when empty. */
  date: string
  backdateReason: string
}

export type ExecutionPerformedAtState = {
  /** Can be sent with the submit. */
  valid: boolean
  payload: { performedAt: string; backdateReason?: string } | null
  /**
   * The chosen day as an instant whenever the day itself is acceptable, even
   * if a reason is still missing: what a draft save remembers.
   */
  instant: string | null
  /** More than the threshold back: the reason field must be shown and filled. */
  requiresBackdateReason: boolean
  backdateDays: number
  field: 'performedAt' | 'backdateReason' | null
  message: string | null
}

/**
 * The execution date of a calibration, checked with the same rules as the
 * cloud's submit (and the desktop's, which mirrors it): not in the future, and
 * a reason once it is more than 7 days back.
 *
 * The date input is a calendar day; it is sent as noon of that day, except that
 * today (before noon) is sent as the current instant, which would otherwise be
 * read as the future and refused.
 */
export function parseExecutionPerformedAt(
  form: ExecutionPerformedAtForm,
  now: Date,
): ExecutionPerformedAtState {
  const invalid = (
    field: 'performedAt' | 'backdateReason',
    message: string,
    extra: Partial<ExecutionPerformedAtState> = {},
  ): ExecutionPerformedAtState => ({
    valid: false,
    payload: null,
    instant: null,
    requiresBackdateReason: false,
    backdateDays: 0,
    field,
    message,
    ...extra,
  })

  if (!form.date) {
    return invalid('performedAt', 'Informe a data da calibração')
  }

  const dayStart = new Date(`${form.date}T00:00:00`)
  if (Number.isNaN(dayStart.getTime())) {
    return invalid('performedAt', 'Data de execução inválida')
  }
  if (dayStart.getTime() > now.getTime()) {
    return invalid('performedAt', 'A data de execução não pode estar no futuro')
  }

  const noon = new Date(`${form.date}T12:00:00`)
  const instant = noon.getTime() > now.getTime() ? now : noon
  const resolved = resolveExecutionPerformedAt({
    performedAt: instant.toISOString(),
    backdateReason: form.backdateReason,
    now,
  })

  if (!resolved.ok) {
    if (resolved.code === 'reason_required') {
      return invalid('backdateReason', resolved.message, {
        instant: instant.toISOString(),
        requiresBackdateReason: true,
        backdateDays: resolved.backdateDays,
      })
    }
    return invalid('performedAt', resolved.message)
  }

  return {
    valid: true,
    payload: {
      performedAt: resolved.performedAt.toISOString(),
      ...(resolved.backdateReason
        ? { backdateReason: resolved.backdateReason }
        : {}),
    },
    instant: resolved.performedAt.toISOString(),
    requiresBackdateReason: resolved.backdateReason !== null,
    backdateDays: resolved.backdateDays,
    field: null,
    message: null,
  }
}
