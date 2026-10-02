/**
 * The outbox drains select rows with `attempts < maxAttempts`. A release
 * increments `attempts` by one, so once THIS release pushes it to `maxAttempts`
 * the row will never be selected again — it is dead-lettered at that moment.
 *
 * @param currentAttempts the row's `attempts` BEFORE this release increments it
 */
export function isReleaseExhausting(
  currentAttempts: number,
  maxAttempts: number,
): boolean {
  return currentAttempts + 1 >= maxAttempts;
}
