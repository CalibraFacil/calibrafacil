function getErrorPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  return Object.fromEntries(Object.entries(payload))
}

export async function readJsonResponse(
  response: Response,
  options: {
    fallbackMessage?: string
    allowDiagnosticsResponse?: boolean
  } = {},
): Promise<unknown> {
  const fallbackMessage =
    options.fallbackMessage ?? `Endpoint indisponível (${response.status})`
  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (response.ok) {
    return payload
  }

  const errorPayload = getErrorPayload(payload)

  if (
    options.allowDiagnosticsResponse &&
    errorPayload &&
    Array.isArray(errorPayload.diagnostics)
  ) {
    return payload
  }

  const errorMessage =
    typeof errorPayload?.error === 'string' ? errorPayload.error : null

  throw new Error(errorMessage || fallbackMessage)
}
