export function isNullableRecord(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'object' && !Array.isArray(value))
  )
}
