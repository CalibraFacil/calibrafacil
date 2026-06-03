import type {
  MethodDraft,
  MethodDraftInput,
  MethodDraftMeasurementModelSource,
} from './types'

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
        ? 0
        : input.type === 'table'
          ? buildInitialTableRows(input.columns ?? [])
          : (input.defaultValue ?? ''),
    ]),
  )
  sample.environment = { temperature: 0, humidity: 0, pressure: 0 }

  for (const variable of draft.variables) {
    if (variable.source === 'environment') {
      const environment = ensureRecord(sample, 'environment')
      environment[variable.field] = 0
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
      for (const row of rows) {
        row[variable.columnKey] = row[variable.columnKey] ?? 0
      }
      sample[variable.fieldKey] = rows
      continue
    }

    if (variable.source === 'data_field') {
      sample[variable.fieldKey] = sample[variable.fieldKey] ?? 0
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
          sample[observationsInputKey] = sample[observationsInputKey] ?? [0, 0]
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

  return [0, 1].map(() =>
    Object.fromEntries(numericColumns.map((column) => [column.key, 0])),
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
      uncertainty: 0,
      coverageFactor: 2,
      drift: 0,
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
      certifiedValues.push({ nominal, value: 0, uncertainty: 0 })
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
    sample[source.key] = sample[source.key] ?? 0
    return
  }
  if (source.kind !== 'table_column') return

  const rows = toRecordArray(sample[source.tableKey])
  while (rows.length < 2) rows.push({})
  for (const row of rows) {
    row[source.columnKey] = row[source.columnKey] ?? 0
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
