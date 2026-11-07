import { authClient } from '@calibra-facil/auth/client'

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
