import {
  CreateCheckStandardReadingSchema,
  CreateControlChartSchema,
  UpdateControlChartSchema,
  type CreateCheckStandardReadingInput,
  type CreateControlChartInput,
  type UpdateControlChartInput,
} from '@calibra-facil/schemas'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'
import type { SpcChartType } from './types'

export type ControlChartFormData = {
  standardId: string
  parameter: string
  chartType: SpcChartType
  baselineWindow: string
  subgroupSize: string
}

export type ControlChartFormField = keyof ControlChartFormData

export type ChartConfigFormData = {
  chartType: SpcChartType
  baselineWindow: string
  subgroupSize: string
}

export type ChartConfigFormField = keyof ChartConfigFormData

export type SpcReadingFormData = {
  value: string
  uncertainty: string
  measuredAt: string
}

export type SpcReadingFormField = keyof SpcReadingFormData

function chartParamsPayload(data: {
  baselineWindow: string
  subgroupSize: string
}) {
  const baselineWindow = data.baselineWindow.trim()
  const subgroupSize = data.subgroupSize.trim()
  if (!baselineWindow && !subgroupSize) return undefined

  return {
    baselineWindow: baselineWindow || undefined,
    subgroupSize: subgroupSize || undefined,
  }
}

export function parseControlChartForm(
  data: ControlChartFormData,
): FeatureFormValidationResult<CreateControlChartInput, ControlChartFormField> {
  if (!data.standardId) {
    return {
      success: false,
      message: 'Selecione o padrão de referência',
      fieldErrors: [],
    }
  }

  const payload = {
    standardId: data.standardId,
    parameter: data.parameter,
    chartType: data.chartType,
    params: chartParamsPayload(data),
  }

  const parsed = CreateControlChartSchema.safeParse(payload)
  if (!parsed.success) {
    return zodFormError(parsed.error.issues, [
      'standardId',
      'parameter',
      'chartType',
    ])
  }

  return { success: true, data: parsed.data }
}

export function parseChartConfigForm(
  data: ChartConfigFormData,
): FeatureFormValidationResult<UpdateControlChartInput, ChartConfigFormField> {
  const payload = {
    chartType: data.chartType,
    params: chartParamsPayload(data),
  }

  const parsed = UpdateControlChartSchema.safeParse(payload)
  if (!parsed.success) {
    return zodFormError(parsed.error.issues, ['chartType'])
  }

  return { success: true, data: parsed.data }
}

export function parseReadingForm(
  standardId: number,
  parameter: string,
  data: SpcReadingFormData,
): FeatureFormValidationResult<
  CreateCheckStandardReadingInput,
  SpcReadingFormField
> {
  if (data.value.trim() === '') {
    return {
      success: false,
      message: 'Informe o valor medido',
      fieldErrors: [{ field: 'value', message: 'Informe o valor medido' }],
    }
  }

  const payload = {
    standardId,
    parameter,
    value: data.value,
    uncertainty: data.uncertainty.trim() === '' ? undefined : data.uncertainty,
    measuredAt: data.measuredAt,
  }

  const parsed = CreateCheckStandardReadingSchema.safeParse(payload)
  if (!parsed.success) {
    return zodFormError(parsed.error.issues, [
      'value',
      'uncertainty',
      'measuredAt',
    ])
  }

  return {
    success: true,
    data: {
      ...parsed.data,
      measuredAt: new Date(parsed.data.measuredAt).toISOString(),
    },
  }
}
