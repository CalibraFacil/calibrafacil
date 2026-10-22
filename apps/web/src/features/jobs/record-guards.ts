export function toRecordArray(value: unknown): Array<Record<string, unknown>> {
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

export function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(Object.entries(value))
}

export function isNullableRecord(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'object' && !Array.isArray(value))
  )
}
