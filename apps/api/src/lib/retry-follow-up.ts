/**
 * Waits before attempts 2 and 3 of a follow-up transaction (3 attempts in all).
 * Short on purpose: a follow-up runs after a committed approval, off the
 * request's critical path, and a transient audit failure clears in moments.
 */
export const FOLLOW_UP_BACKOFF_MS: readonly number[] = [100, 300];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a follow-up transaction and, if it throws, runs it again after each
 * delay of `backoffMs` (3 attempts with the default). The last failure is
 * rethrown for the caller to log.
 *
 * `run` must be ONE transaction (the change and its audit row together): a
 * failed attempt rolls back whole, so a retry never finds half of it. The
 * follow-ups that use this (the asset OOT event and the asset calibration-date
 * advance after an approval) stay atomic with their audit row, and become
 * durable against a transient failure instead of vanishing on the first one.
 */
export async function retryFollowUp<T>(
  run: () => Promise<T>,
  backoffMs: readonly number[] = FOLLOW_UP_BACKOFF_MS,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const [delay, ...rest] = backoffMs;
    if (delay === undefined) throw error;
    await sleep(delay);
    return retryFollowUp(run, rest);
  }
}
