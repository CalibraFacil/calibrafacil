export type ClientErrorContext = {
  route: string
  componentStack?: string | null
}

/**
 * Self-hosted error reporting: one structured line on the browser console
 * (collectable by whatever the operator runs), no third-party SDK and no
 * network call. Never throws, so a failing report cannot mask the crash.
 */
export function reportClientError(
  error: unknown,
  { route, componentStack }: ClientErrorContext,
): void {
  try {
    const failure = error instanceof Error ? error : new Error(String(error))
    console.error(
      JSON.stringify({
        message: failure.message,
        name: failure.name,
        stack: failure.stack ?? null,
        route,
        componentStack: componentStack ?? null,
        app: 'web',
        timestamp: new Date().toISOString(),
      }),
    )
  } catch {
    // Reporting must never throw out of the router's error handler.
  }
}
