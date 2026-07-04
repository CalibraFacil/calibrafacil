/**
 * Search schema for the "Nova calibração" route (DOM-02, #655).
 *
 * REQ-DOM-REP-002: opening the new calibration from a repair OS pre-fills
 * customer + asset inherited from the OS. The OS detail page links to
 * `/dashboard/jobs/new?customerId=..&assetId=..&serviceOrderId=..`; this parser
 * is the route's `validateSearch`, so the feature module receives typed props
 * (it never calls `useSearch`).
 *
 * Params are optional and tolerant: a standalone "Nova calibração" (no source
 * OS) parses to `{}`, and any non-numeric / non-positive value is dropped rather
 * than throwing, so a hand-edited URL never 500s the route.
 */
export type NewJobSearch = {
  customerId?: number
  assetId?: number
  serviceOrderId?: number
}

function toPositiveInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined
  return parsed
}

export function parseNewJobSearch(
  input: Record<string, unknown>,
): NewJobSearch {
  const search: NewJobSearch = {}

  const customerId = toPositiveInt(input.customerId)
  if (customerId !== undefined) search.customerId = customerId

  const assetId = toPositiveInt(input.assetId)
  if (assetId !== undefined) search.assetId = assetId

  const serviceOrderId = toPositiveInt(input.serviceOrderId)
  if (serviceOrderId !== undefined) search.serviceOrderId = serviceOrderId

  return search
}
