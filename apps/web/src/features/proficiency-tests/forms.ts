import {
  CreateProficiencyTestSchema,
  CreatePtPlanItemSchema,
  RecordPtResultsSchema,
  type CreateProficiencyTestInput,
  type CreatePtPlanItemInput,
  type RecordPtResultsInput,
} from '@calibra-facil/schemas'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'
import type { PtActivityType, PtScoreType } from './types'

export type PtRoundFormData = {
  activityType: PtActivityType
  provider: string
  providerAccreditation: string
  ptRound: string
  scopePart: string
  metrologyKind: string
  standardId: string
  notes: string
}

export type PtRoundFormField = keyof PtRoundFormData

export type PtResultPointFormData = {
  label: string
  unit: string
  scoreType: PtScoreType
  labValue: string
  labUncertainty: string
  refValue: string
  refUncertainty: string
  sigmaPt: string
}

export type PtResultsFormData = {
  results: PtResultPointFormData[]
}

export type PtResultsFormField = 'resultReportedAt' | 'results'

export type PtPlanItemFormData = {
  scopePart: string
  riskJustification: string
  frequencyMonths: string
}

export type PtPlanItemFormField = keyof PtPlanItemFormData

export function emptyPtResultPointForm(): PtResultPointFormData {
  return {
    label: '',
    unit: '',
    scoreType: 'en',
    labValue: '',
    labUncertainty: '',
    refValue: '',
    refUncertainty: '',
    sigmaPt: '',
  }
}

export function parsePtRoundForm(
  data: PtRoundFormData,
  registrationDate: Date | undefined,
  participationDate: Date | undefined,
): FeatureFormValidationResult<CreateProficiencyTestInput, PtRoundFormField> {
  const payload = {
    activityType: data.activityType,
    provider: data.provider,
    providerAccreditation: data.providerAccreditation.trim() || undefined,
    ptRound: data.ptRound,
    scopePart: data.scopePart,
    metrologyKind: data.metrologyKind.trim() || undefined,
    standardId: data.standardId ? Number(data.standardId) : undefined,
    registrationDate: registrationDate?.toISOString(),
    participationDate: participationDate?.toISOString(),
    notes: data.notes.trim() || undefined,
  }

  const parsed = CreateProficiencyTestSchema.safeParse(payload)
  if (!parsed.success) {
    return zodFormError(parsed.error.issues, [
      'activityType',
      'provider',
      'providerAccreditation',
      'ptRound',
      'scopePart',
      'metrologyKind',
      'standardId',
      'notes',
    ])
  }

  return { success: true, data: parsed.data }
}

export function parsePtResultsForm(
  data: PtResultsFormData,
  resultReportedAt: Date | undefined,
): FeatureFormValidationResult<RecordPtResultsInput, PtResultsFormField> {
  if (!resultReportedAt) {
    return {
      success: false,
      message: 'Data do relatório do provedor é obrigatória',
      fieldErrors: [],
    }
  }

  for (const [index, row] of data.results.entries()) {
    if (row.labValue.trim() === '' || row.refValue.trim() === '') {
      return {
        success: false,
        message: `Informe o valor do laboratório e o valor de referência no ponto ${index + 1}`,
        fieldErrors: [],
      }
    }
  }

  const payload = {
    resultReportedAt: resultReportedAt.toISOString(),
    results: data.results.map((row) => ({
      label: row.label,
      unit: row.unit.trim() || undefined,
      labValue: row.labValue,
      labUncertainty:
        row.labUncertainty.trim() === '' ? undefined : row.labUncertainty,
      refValue: row.refValue,
      refUncertainty:
        row.refUncertainty.trim() === '' ? undefined : row.refUncertainty,
      sigmaPt: row.sigmaPt.trim() === '' ? undefined : row.sigmaPt,
      scoreType: row.scoreType,
    })),
  }

  const parsed = RecordPtResultsSchema.safeParse(payload)
  if (!parsed.success) {
    return zodFormError(parsed.error.issues, ['resultReportedAt', 'results'])
  }

  return { success: true, data: parsed.data }
}

export function parsePtPlanItemForm(
  data: PtPlanItemFormData,
  lastSatisfactoryAt: Date | undefined,
): FeatureFormValidationResult<CreatePtPlanItemInput, PtPlanItemFormField> {
  const payload = {
    scopePart: data.scopePart,
    riskJustification: data.riskJustification.trim() || undefined,
    frequencyMonths:
      data.frequencyMonths.trim() === '' ? undefined : data.frequencyMonths,
    lastSatisfactoryAt: lastSatisfactoryAt?.toISOString(),
  }

  const parsed = CreatePtPlanItemSchema.safeParse(payload)
  if (!parsed.success) {
    return zodFormError(parsed.error.issues, [
      'scopePart',
      'riskJustification',
      'frequencyMonths',
    ])
  }

  return { success: true, data: parsed.data }
}
