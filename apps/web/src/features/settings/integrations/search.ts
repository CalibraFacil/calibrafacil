/**
 * The OAuth callback sends the browser back to this page with
 * `?contaAzulOAuth=error&reason=…` when the connection fails. Everything else
 * on the URL passes through untouched.
 */
export type IntegrationsSearch = {
  contaAzulOAuth?: 'error'
  reason?: string
}

export function validateIntegrationsSearch(
  search: Record<string, unknown>,
): IntegrationsSearch {
  const { contaAzulOAuth, reason, ...rest } = search
  if (contaAzulOAuth !== 'error') {
    return rest
  }

  return {
    ...rest,
    contaAzulOAuth: 'error',
    ...(typeof reason === 'string' ? { reason } : {}),
  }
}

/** What the integrations page needs: the failure, if the callback reported one. */
export function contaAzulOAuthErrorFromSearch(
  search: IntegrationsSearch,
): { reason: string | null } | null {
  return search.contaAzulOAuth === 'error'
    ? { reason: search.reason ?? null }
    : null
}
