/**
 * Runs `run` over `items` one at a time, in order, and returns the results.
 *
 * For specs whose requests share global state (the mocked session of
 * `loginAs`, one database role per call), so they cannot be fired in parallel
 * with `Promise.all`.
 */
export async function inSequence<T, R>(
  items: readonly T[],
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  await items.reduce<Promise<void>>(async (previous, item, index) => {
    await previous;
    results.push(await run(item, index));
  }, Promise.resolve());
  return results;
}
