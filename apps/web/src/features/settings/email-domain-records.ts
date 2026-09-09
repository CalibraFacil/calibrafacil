/**
 * The DNS records a laboratory publishes to send from its own domain.
 *
 * The provider returns these and we display them verbatim. Reformatting or
 * re-deriving them is how a laboratory ends up publishing something that never
 * verifies, so this only normalises the shape enough to render a table and
 * never invents a value.
 */

export type EmailDnsRecord = {
  type: string
  name: string
  value: string
  priority?: string
  status?: string
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

export function normalizeEmailDnsRecords(records: unknown): EmailDnsRecord[] {
  if (!Array.isArray(records)) return []

  return records.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const source = Object.fromEntries(Object.entries(entry))

    const type = readString(source, 'type').toUpperCase()
    const name = readString(source, 'name')
    const value = readString(source, 'value')
    if (!type || !name) return []

    const priority = readString(source, 'priority')
    const status = readString(source, 'status')

    return [
      {
        type,
        name,
        value,
        ...(priority ? { priority } : {}),
        ...(status ? { status } : {}),
      },
    ]
  })
}

/**
 * A laboratory should send from a subdomain, never the apex.
 *
 * Reputation is then isolated in both directions: our sending cannot damage the
 * domain their people use for ordinary mail, and their marketing cannot damage
 * ours. It also keeps the records we ask for away from whatever already exists
 * at the apex, which is where collisions happen.
 */
export function looksLikeApexDomain(hostname: string): boolean {
  const labels = hostname.trim().toLowerCase().replace(/\.$/, '').split('.')
  if (labels.length < 2) return false

  // Brazilian second-level suffixes (com.br, ind.br, eng.br...) mean an apex
  // has three labels, not two, so counting alone would call every .com.br
  // hostname a subdomain.
  const isBrazilianSecondLevel =
    labels.length >= 3 &&
    labels[labels.length - 1] === 'br' &&
    labels[labels.length - 2].length <= 3

  return isBrazilianSecondLevel ? labels.length === 3 : labels.length === 2
}

/** Suggests `certificados.<apex>` when the laboratory typed its apex. */
export function suggestSendingSubdomain(hostname: string): string | null {
  const trimmed = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!trimmed || !looksLikeApexDomain(trimmed)) return null
  return `certificados.${trimmed}`
}
