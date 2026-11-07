function decodeRouteIdentifier(value: string): string {
  let decodedValue = value

  for (let index = 0; index < 3; index += 1) {
    try {
      const nextValue = decodeURIComponent(decodedValue)
      if (nextValue === decodedValue) break
      decodedValue = nextValue
    } catch {
      break
    }
  }

  return decodedValue
}

export function jobRouteId(job: { jobId: string }): string {
  return encodeURIComponent(decodeRouteIdentifier(job.jobId))
}

export function apiRouteParam(value: string | number): string {
  const decodedValue = decodeRouteIdentifier(String(value))
  return encodeURIComponent(encodeURIComponent(decodedValue))
}
