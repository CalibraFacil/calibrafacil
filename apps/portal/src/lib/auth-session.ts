const SESSION_RETRY_DELAY_MS = 150;

type SessionReadResult<TSession> = {
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
