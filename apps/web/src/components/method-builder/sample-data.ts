import type {
  MethodDraft,
  MethodDraftInput,
  MethodDraftMeasurementModelSource,
} from './types'

/**
 * Placeholder for every numeric slot of the generated sample data.
 *
 * It must be NON-ZERO. This payload is a smoke test for the compiled formula
 * graph, and real GUM methods divide by their inputs — the k of the standard's
 * certificate, the eccentricity test load, a nominal load. Seeding zeros made
 * Preview fail with "Division by zero is not allowed" on those formulas and
 * then cascade "Formula input is missing a required variable" through every
 * formula downstream, so no method with a divisor input could pass the
 * publish-preview gate unless the lab hand-wrote the JSON. `1` divides cleanly
 * and keeps every derived quantity finite.
 *
 * These values are synthetic: they exercise the graph, they do not stand for a
 * measurement. The lab edits this JSON before reading anything into a result.
 */
const SAMPLE_NUMBER = 1

/**
 * Plausible lab ambient conditions, in the units the certificate renders
 * (°C, %UR, hPa — see `packages/certificate-data`). Same reasoning as
 * SAMPLE_NUMBER: a formula dividing by ambient pressure must not blow up.
 */
const SAMPLE_ENVIRONMENT: Record<string, number> = {
  temperature: 20,
  humidity: 50,
  pressure: 1013.25,
}

function sampleEnvironmentValue(field: string): number {
  return SAMPLE_ENVIRONMENT[field] ?? SAMPLE_NUMBER
}

/**
 * Row `index` gets `index + 1`, so a table seeds distinct rows. A column whose
 * rows all held the same number had a sample standard deviation of exactly 0,
 * which zeroed the Type A contribution and divided by zero in the
 * Welch–Satterthwaite degrees-of-freedom formula.
 */
function sampleRowNumber(index: number): number {
  return SAMPLE_NUMBER * (index + 1)
}

function sampleNumberFromDefault(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed !== 0) return parsed
  }
  return SAMPLE_NUMBER
}

export function parseJsonObject(value: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('JSON inválido')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('O preview precisa de um objeto JSON')
  }

  return Object.fromEntries(Object.entries(parsed))
}

export function buildInitialSampleData(
  draft: MethodDraft,
): Record<string, unknown> {
  const sample: Record<string, unknown> = Object.fromEntries(
    draft.inputs.map((input) => [
      input.key,
      input.type === 'number'
        ? sampleNumberFromDefault(input.defaultValue)
        : input.type === 'table'
          ? buildInitialTableRows(input.columns ?? [])
          : (input.defaultValue ?? ''),
    ]),
  )
  sample.environment = { ...SAMPLE_ENVIRONMENT }

  for (const variable of draft.variables) {
    if (variable.source === 'environment') {
      const environment = ensureRecord(sample, 'environment')
      environment[variable.field] = sampleEnvironmentValue(variable.field)
      continue
    }

    if (variable.source === 'standard') {
      addStandardSampleBinding(sample, variable.standardId, variable.valueKey)
      continue
    }

    if (
      variable.source === 'table_column' ||
      variable.source === 'table_statistic'
    ) {
      const rowsRequired =
        variable.source === 'table_statistic' &&
        variable.statistic === 'sample_stddev'
          ? 2
          : 1
      const rows = toRecordArray(sample[variable.fieldKey])
      while (rows.length < rowsRequired) rows.push({})
      for (const [index, row] of rows.entries()) {
        row[variable.columnKey] =
          row[variable.columnKey] ?? sampleRowNumber(index)
      }
      sample[variable.fieldKey] = rows
      continue
    }

    if (variable.source === 'data_field') {
      sample[variable.fieldKey] = sample[variable.fieldKey] ?? SAMPLE_NUMBER
    }
  }

  for (const model of draft.measurementModels) {
    for (const quantity of model.quantities) {
      addMeasurementSourceSample(sample, quantity.source)
      if (quantity.uncertainty.kind === 'type_a') {
        for (const source of quantity.uncertainty.observations ?? []) {
          addMeasurementSourceSample(sample, source)
        }
        const observationsInputKey = quantity.uncertainty.observationsInputKey
        if (observationsInputKey) {
          sample[observationsInputKey] = sample[observationsInputKey] ?? [
            sampleRowNumber(0),
            sampleRowNumber(1),
          ]
        }
      }
    }
  }

  return sample
}

function buildInitialTableRows(
  columns: NonNullable<MethodDraftInput['columns']>,
): Array<Record<string, unknown>> {
  const numericColumns = columns.filter((column) => column.type === 'number')
  if (numericColumns.length === 0) return []

  return [0, 1].map((index) =>
    Object.fromEntries(
      numericColumns.map((column) => [column.key, sampleRowNumber(index)]),
    ),
  )
}

function ensureRecord(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = source[key]
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = Object.fromEntries(Object.entries(value))
    source[key] = record
    return record
  }
  const record: Record<string, unknown> = {}
  source[key] = record
  return record
}

function addStandardSampleBinding(
  sample: Record<string, unknown>,
  standardId: number | undefined,
  valueKey: string,
): void {
  const standards = toRecordArray(sample.standards)
  const targetId = standardId ?? 0
  let standard = standards.find((item) => item.id === targetId)

  if (!standard) {
    standard = {
      id: targetId,
      uncertainty: SAMPLE_NUMBER,
      coverageFactor: 2,
      drift: SAMPLE_NUMBER,
      certifiedValues: [],
    }
    standards.push(standard)
  }

  if (!Array.isArray(standard.certifiedValues)) {
    standard.certifiedValues = []
  }

  if (
    valueKey &&
    valueKey !== 'uncertainty' &&
    valueKey !== 'coverageFactor' &&
    valueKey !== 'k' &&
    valueKey !== 'drift'
  ) {
    const nominal = valueKey.endsWith('_u') ? valueKey.slice(0, -2) : valueKey
    const certifiedValues = toRecordArray(standard.certifiedValues)
    if (!certifiedValues.some((item) => item.nominal === nominal)) {
      certifiedValues.push({
        nominal,
        value: SAMPLE_NUMBER,
        uncertainty: SAMPLE_NUMBER,
      })
    }
    standard.certifiedValues = certifiedValues
  }

  sample.standards = standards
}

function addMeasurementSourceSample(
  sample: Record<string, unknown>,
  source: MethodDraftMeasurementModelSource,
): void {
  if (source.kind === 'input') {
    sample[source.key] = sample[source.key] ?? SAMPLE_NUMBER
    return
  }
  if (source.kind !== 'table_column') return

  const rows = toRecordArray(sample[source.tableKey])
  while (rows.length < 2) rows.push({})
  for (const [index, row] of rows.entries()) {
    row[source.columnKey] = row[source.columnKey] ?? sampleRowNumber(index)
  }
  sample[source.tableKey] = rows
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }

    return [Object.fromEntries(Object.entries(item))]
  })
}
