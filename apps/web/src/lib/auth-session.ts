import { authClient } from '@calibra-facil/auth/client'

const SESSION_RETRY_DELAY_MS = 150

type SessionReadResult<TSession> = {
  data: TSession | null
  error?: unknown
}

type SessionReader<TSession> = () => Promise<SessionReadResult<TSession>>

function waitForSessionRetry() {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, SESSION_RETRY_DELAY_MS)
  })
}

export async function readSessionWithRetry<TSession>(
  readSession: SessionReader<TSession>,
): Promise<SessionReadResult<TSession>> {
  try {
    const first = await readSession()
    if (first.data) {
      return first
    }
  } catch {
    // Retry once before treating a navigation-time auth miss as final.
  }

  await waitForSessionRetry()
  return readSession()
}

let inflightSession: ReturnType<typeof authClient.getSession> | null = null

// Deduped one-off session read shared across route guards. Concurrent guards
// during a single navigation reuse one /get-session request instead of each
// firing its own.
export function getClientSession() {
  inflightSession ??= authClient.getSession().finally(() => {
    inflightSession = null
  })
  return inflightSession
}
