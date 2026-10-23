import { isMassMeasurementUnit } from '@calibra-facil/shared'
import {
  resolveDisplayUnit,
  type MeasurementUnit,
} from '@calibra-facil/shared/units'
import type {
  FormulaResult,
  MethodInputField,
} from '@/components/method-runtime/types'
import {
  type AddressData,
  type CalibrationPhaseMode,
  type JobData,
} from './types'
import { resolvePointDisplayUnit } from './formulas'

export const JOB_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  IN_PROGRESS: 'Em Execução',
  REVIEW: 'Em Revisão',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  CANCELED: 'Cancelado',
}

export function previewFormulaErrorMessage(result: FormulaResult): string {
  if (!result.error) return ''

  if (result.errorCode === 'UNKNOWN_IDENTIFIER') {
    return 'Aguardando entrada ou resultado dependente.'
  }

  if (/missing a required variable/i.test(result.error)) {
    return 'Aguardando entrada ou resultado dependente.'
  }

  if (/allowed function whitelist/i.test(result.error)) {
    return 'Função disponível apenas na execução oficial do método compilado.'
  }

  return result.error
}

export function phaseModeLabel(mode: CalibrationPhaseMode) {
  switch (mode) {
    case 'before_only':
      return 'Somente antes'
    case 'after_only':
      return 'Somente após'
    case 'not_performed':
      return 'Não executado'
    case 'before_and_after':
    default:
      return 'Antes e após'
  }
}

export function formatAddress(address: AddressData | null | undefined) {
  if (!address) return ''
  return [
    address.street,
    address.number,
    address.complement,
    address.neighbourhood,
    address.city,
    address.state,
    address.cep,
  ]
    .filter(Boolean)
    .join(', ')
}

export function formatLabAddress(job: JobData) {
  return formatAddress({
    street: job.labStreet,
    number: job.labNumber,
    complement: job.labComplement,
    neighbourhood: job.labNeighbourhood,
    city: job.labCity,
    state: job.labState,
    cep: job.labCep,
  })
}

export function resolveFieldForDisplay(
  field: MethodInputField,
  baseMeasurementUnit: MeasurementUnit | null | undefined,
): MethodInputField {
  if (!baseMeasurementUnit) {
    return field
  }

  return {
    ...field,
    unit: resolveDisplayUnit(baseMeasurementUnit, field.unit),
    weighingRangeResolver: field.weighingRangeResolver
      ? {
          ...field.weighingRangeResolver,
          pointUnit: resolvePointDisplayUnit(
            baseMeasurementUnit,
            field.weighingRangeResolver.pointUnit,
          ),
        }
      : field.weighingRangeResolver,
    columns: field.columns?.map((column) => ({
      ...column,
      unit: resolveDisplayUnit(baseMeasurementUnit, column.unit),
      massComposition: column.massComposition
        ? {
            ...column.massComposition,
            // Mass composition is mass-only: only retarget when the asset's base
            // unit is itself a mass unit.
            targetUnit:
              column.massComposition.targetUnit &&
              isMassMeasurementUnit(column.massComposition.targetUnit) &&
              isMassMeasurementUnit(baseMeasurementUnit)
                ? baseMeasurementUnit
                : column.massComposition.targetUnit,
          }
        : column.massComposition,
    })),
  }
}
