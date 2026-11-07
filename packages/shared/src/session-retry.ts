/**
 * The one retry policy for reading the auth session while a navigation is in
 * flight: the lab app and the client portal both read the session in their
 * route guards, and a read can miss for a moment right after sign-in or a
 * tab restore. One retry after a short pause settles it; a second miss is final.
 */

export const SESSION_RETRY_DELAY_MS = 150;

export type SessionReadResult<TSession> = {
  data: TSession | null;
  error?: unknown;
};

type SessionReader<TSession> = () => Promise<SessionReadResult<TSession>>;

function waitForSessionRetry() {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, SESSION_RETRY_DELAY_MS);
  });
}

export async function readSessionWithRetry<TSession>(
  readSession: SessionReader<TSession>,
): Promise<SessionReadResult<TSession>> {
  try {
    const first = await readSession();
    if (first.data) {
      return first;
    }
  } catch {
    // Retry once before treating a navigation-time auth miss as final.
  }

  await waitForSessionRetry();
  return readSession();
}
