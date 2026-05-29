/**
 * Search schema for the Recebíveis workspace. Drives both the active tab and
 * the pre-applied table filters, so other surfaces can deep-link straight into
 * a filtered view (e.g. the console "Vencido" tile → ?tab=recebimentos&parcela=OVERDUE).
 * Parsing lives here so it is unit-testable and reused by the route adapter.
 */
export type ReceivablesTab = 'documentos' | 'recebimentos'

export type ReceivablesSearch = {
  tab?: ReceivablesTab
  status?: string
  export?: string
  parcela?: string
  query?: string
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function parseReceivablesSearch(
  input: Record<string, unknown>,
): ReceivablesSearch {
  const tab =
    input.tab === 'recebimentos'
      ? 'recebimentos'
      : input.tab === 'documentos'
        ? 'documentos'
        : undefined

  return {
    tab,
    status: optionalString(input.status),
    export: optionalString(input.export),
    parcela: optionalString(input.parcela),
    query: optionalString(input.query),
  }
}
