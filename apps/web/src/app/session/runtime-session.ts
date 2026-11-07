import { readSessionWithRetry } from '@calibra-facil/shared/session-retry'

import { getClientSession } from '@/lib/auth-session'
import { hasDesktopSession } from '@/runtime/desktop-auth'
import { isDesktopRuntime } from '@/runtime/desktop'

/**
 * Whether someone is signed in on this runtime. The one place that knows the
 * two kinds of session: the desktop's (a local snapshot, or the cloud's when
 * online) and the cloud web app's (read with a retry, so one transient miss
 * is not a sign-out). Route guards ask this and decide only what to do next.
 */
export async function hasRuntimeSession(): Promise<boolean> {
  if (isDesktopRuntime()) return hasDesktopSession()

  const { data: session } = await readSessionWithRetry(getClientSession)
  return Boolean(session)
}
