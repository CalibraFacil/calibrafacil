export function slugifyRouteIdentifier(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'item'
}

export function methodRouteId(method: {
  name: string
  version: number
}): string {
  return `${slugifyRouteIdentifier(method.name)}-v${method.version}`
}

export function standardRouteId(standard: { serialNumber: string }): string {
  return slugifyRouteIdentifier(standard.serialNumber)
}

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

export function assetRouteId(asset: { tag: string }): string {
  return slugifyRouteIdentifier(asset.tag)
}

export function clientRouteId(client: {
  name: string
  taxId?: string | null
}): string {
  return slugifyRouteIdentifier(client.taxId || client.name)
}

export function serviceRouteId(service: { name: string }): string {
  return slugifyRouteIdentifier(service.name)
}
