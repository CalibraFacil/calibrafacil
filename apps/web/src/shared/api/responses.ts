export async function readJsonResponse<T>(
  response: Response,
  options: {
    fallbackMessage?: string
    allowDiagnosticsResponse?: boolean
  } = {},
): Promise<T> {
  const fallbackMessage =
    options.fallbackMessage ?? `Endpoint indisponível (${response.status})`
  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (response.ok) {
    return payload as T
  }

  const errorPayload = payload as {
    error?: string
    diagnostics?: unknown
  } | null

  if (
    options.allowDiagnosticsResponse &&
    errorPayload &&
    Array.isArray(errorPayload.diagnostics)
  ) {
    return payload as T
  }

  throw new Error(errorPayload?.error || fallbackMessage)
}
