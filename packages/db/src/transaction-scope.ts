import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The transaction a request is running its work in, when it asked for one with
 * `runInTransactionScope` (db.ts).
 *
 * While a scope is open, `db` (the exported proxy) resolves to that
 * transaction for everything that runs in the same async call chain: the
 * handler's own queries and those of every helper it calls, none of which has
 * to be rewritten to accept a transaction handle. A `db.transaction(...)` made
 * inside it is a savepoint, so a helper that opens its own transaction still
 * nests correctly, and a failure it catches rolls back only its own part.
 *
 * Work that must not run inside the transaction (a notification that reads
 * what the transaction wrote, anything fire-and-forget) is handed to
 * `afterTransactionCommit`.
 */
export type TransactionScope = {
  /** The Drizzle transaction handle; opaque here, it is only forwarded. */
  readonly tx: object;
  /** Callbacks to run once the transaction has committed. */
  readonly afterCommit: Array<() => void | Promise<void>>;
  /** Set once the work is over: a stray continuation falls back to a fresh connection. */
  closed: boolean;
};

export const transactionScopeStorage =
  new AsyncLocalStorage<TransactionScope>();

/** The open scope of the running call chain, or undefined outside one. */
export function currentTransactionScope(): TransactionScope | undefined {
  const scope = transactionScopeStorage.getStore();
  return scope && !scope.closed ? scope : undefined;
}

/**
 * Runs `callback` once the surrounding transaction committed (and never when it
 * rolled back). Outside a transaction scope it runs at once. Errors thrown by a
 * deferred callback are logged, not propagated: the transaction is already
 * durable, and the callbacks are side effects (notifications, wake-ups).
 */
export function afterTransactionCommit(
  callback: () => void | Promise<void>,
): void {
  const scope = currentTransactionScope();
  if (scope) {
    scope.afterCommit.push(callback);
    return;
  }
  void callback();
}
