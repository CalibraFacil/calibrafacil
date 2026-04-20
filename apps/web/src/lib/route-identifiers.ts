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

export function jobRouteId(job: { jobId: string }): string {
  return job.jobId
}

export function apiRouteParam(value: string | number): string {
  const stringValue = String(value)

  try {
    return encodeURIComponent(decodeURIComponent(stringValue))
  } catch {
    return encodeURIComponent(stringValue)
  }
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
