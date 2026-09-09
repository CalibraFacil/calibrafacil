import { parseNumericValue } from '@calibra-facil/shared'

import type { StandardFormData } from './forms'

/**
 * Non-blocking warnings shown while a reference standard is being entered.
 *
 * Every one of these is already caught somewhere later: an expired certificate
 * is rejected when a job selects the standard, and a wrong coverage factor
 * surfaces as a wrong uncertainty on an issued certificate. Catching them here
 * turns a blocked job, or a reissued laudo, into a ten-second correction while
 * the calibration certificate is still open on the desk.
 *
 * They warn and never block, and nothing is auto-corrected. The standard's own
 * calibration certificate is the authority on every one of these values, and a
 * laboratory has legitimate reasons to record something that looks unusual.
 */

export type StandardWarning = {
  field:
    | 'nextCalibrationDate'
    | 'calibrationDate'
    | 'coverageFactor'
    | 'uncertaintyUnit'
  message: string
}

/** Parses the `yyyy-MM-dd` the date inputs produce. Returns null when partial. */
function parseIsoDate(value: string): Date | null {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  const parsed = new Date(`${trimmed}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function startOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function describeStandardWarnings(
  data: Pick<
    StandardFormData,
    | 'calibrationDate'
    | 'nextCalibrationDate'
    | 'coverageFactor'
    | 'distribution'
    | 'uncertaintyUnit'
    | 'certifiedValues'
  >,
  now: Date = new Date(),
): StandardWarning[] {
  const warnings: StandardWarning[] = []

  const calibrationDate = parseIsoDate(data.calibrationDate)
  const nextCalibrationDate = parseIsoDate(data.nextCalibrationDate)

  if (nextCalibrationDate && nextCalibrationDate < startOfToday(now)) {
    warnings.push({
      field: 'nextCalibrationDate',
      message:
        'A validade do certificado já passou. Este padrão será recusado ao criar uma calibração.',
    })
  }

  if (
    calibrationDate &&
    nextCalibrationDate &&
    nextCalibrationDate <= calibrationDate
  ) {
    warnings.push({
      field: 'calibrationDate',
      message:
        'A data de validade não é posterior à data de calibração. Confira as duas no certificado.',
    })
  }

  // k = 2 is the convention for a normal distribution at roughly 95%. A
  // rectangular distribution is usually declared with its own divisor, so the
  // pair is worth a second look rather than a silent acceptance.
  const coverageFactor = parseNumericValue(data.coverageFactor)
  if (
    data.distribution === 'rectangular' &&
    coverageFactor !== null &&
    Math.abs(coverageFactor - 2) < 1e-9
  ) {
    warnings.push({
      field: 'coverageFactor',
      message:
        'Fator de abrangência 2 com distribuição retangular. Confira o que o certificado do padrão declara.',
    })
  }

  // An uncertainty in a different unit from the values it qualifies is almost
  // always a transcription slip, and it propagates straight into the budget.
  const uncertaintyUnit = data.uncertaintyUnit.trim().toLowerCase()
  if (uncertaintyUnit) {
    const valueUnits = new Set(
      data.certifiedValues
        .map((value) => value.unit.trim().toLowerCase())
        .filter((unit) => unit !== ''),
    )

    if (valueUnits.size > 0 && !valueUnits.has(uncertaintyUnit)) {
      warnings.push({
        field: 'uncertaintyUnit',
        message: `A incerteza está em ${data.uncertaintyUnit.trim()} e os valores certificados em ${[...valueUnits].join(', ')}. Confira as unidades.`,
      })
    }
  }

  return warnings
}
