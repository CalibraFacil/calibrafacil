import {
  CreateCapaSchema,
  CreateNonConformanceSchema,
  type CreateCapaInput,
  type CreateNonConformanceInput,
} from '@calibra-facil/schemas/quality'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'

export type NonConformanceFormData = {
  type: CreateNonConformanceInput['type']
  description: string
  jobId?: string
}

export type CapaFormData = {
  title: string
  description: string
  source: string
  sourceReference: string
  type: string
  severity: string
  category: string
  actionPlan: string
  responsibleId: string
  rootCauseAnalysis: string
  rootCauseAnalysisMethod: string
  preventiveMeasures: string
}

export type NonConformanceFormField = keyof NonConformanceFormData
export type CapaFormField = keyof CapaFormData

export function parseNonConformanceForm(
  data: NonConformanceFormData,
  detectedDate: Date | undefined,
  detectedTime: string,
): FeatureFormValidationResult<
  CreateNonConformanceInput,
  NonConformanceFormField
> {
  if (!detectedDate) {
    return {
      success: false,
      message: 'Data de detecção é obrigatória',
      fieldErrors: [],
    }
  }

  const payload = {
    type: data.type,
    description: data.description,
    detectedAt: combineDateAndTime(detectedDate, detectedTime).toISOString(),
    jobId: data.jobId ? Number(data.jobId) : undefined,
  }

  const parsed = CreateNonConformanceSchema.safeParse(payload)
  if (!parsed.success) {
    return zodFormError(parsed.error.issues, ['type', 'description', 'jobId'])
  }

  return { success: true, data: parsed.data }
}

export function parseCapaForm(
  data: CapaFormData,
  detectionDate: Date | undefined,
  dueDate: Date | undefined,
): FeatureFormValidationResult<CreateCapaInput, CapaFormField> {
  if (!detectionDate) {
    return {
      success: false,
      message: 'Data de detecção é obrigatória',
      fieldErrors: [],
    }
  }

  if (!dueDate) {
    return {
      success: false,
      message: 'Data alvo é obrigatória',
      fieldErrors: [],
    }
  }

  const payload = {
    title: data.title,
    description: data.description,
    source: data.source,
    sourceReference: data.sourceReference || undefined,
    detectionDate: detectionDate.toISOString(),
    type: data.type,
    severity: data.severity,
    category: data.category,
    actionPlan: data.actionPlan,
    responsibleId: data.responsibleId,
    dueDate: dueDate.toISOString(),
    rootCauseAnalysis: data.rootCauseAnalysis || undefined,
    rootCauseAnalysisMethod: data.rootCauseAnalysisMethod || undefined,
    preventiveMeasures: data.preventiveMeasures || undefined,
  }

  const parsed = CreateCapaSchema.safeParse(payload)
  if (!parsed.success) {
    return zodFormError(parsed.error.issues, [
      'title',
      'description',
      'source',
      'sourceReference',
      'type',
      'severity',
      'category',
      'actionPlan',
      'responsibleId',
      'rootCauseAnalysis',
      'rootCauseAnalysisMethod',
      'preventiveMeasures',
    ])
  }

  return { success: true, data: parsed.data }
}

function combineDateAndTime(date: Date, time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  const combined = new Date(date)
  combined.setHours(hours ?? 0, minutes ?? 0, 0, 0)
  return combined
}
