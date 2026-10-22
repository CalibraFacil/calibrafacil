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

/** Whether the running call chain is inside a transaction scope. */
export function isInTransactionScope(): boolean {
  return currentTransactionScope() !== undefined;
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
  try {
    void Promise.resolve(callback()).catch(logAfterCommitFailure);
  } catch (error) {
    logAfterCommitFailure(error);
  }
}

function logAfterCommitFailure(error: unknown) {
  console.error("[db] An after-commit callback failed:", error);
}

/** Opens a database transaction and hands its handle to `callback`. */
export type OpenTransaction = <T>(
  callback: (tx: object) => Promise<T>,
) => Promise<T>;

/**
 * The scope runner for a way of opening a transaction (`db.ts` passes the real
 * one; the unit tests pass a fake). `work` runs in ONE transaction that every
 * `db` access in its async call chain joins. The transaction commits when
 * `work` resolves and rolls back, discarding the deferred
 * `afterTransactionCommit` callbacks, when it throws. Called inside a scope it
 * just runs `work`: the outer transaction owns the commit.
 */
export function createTransactionScopeRunner(open: OpenTransaction) {
  return async function runInTransactionScope<T>(
    work: () => Promise<T>,
  ): Promise<T> {
    if (currentTransactionScope()) return work();

    const afterCommit: Array<() => void | Promise<void>> = [];
    const scopedTransaction = async (tx: object) => {
      const scope: TransactionScope = { tx, afterCommit, closed: false };
      try {
        return await transactionScopeStorage.run(scope, work);
      } finally {
        scope.closed = true;
      }
    };
    markTransactionScopeCallback(scopedTransaction);
    const result = await open(scopedTransaction);
    for (const callback of afterCommit) {
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- in registration order, one at a time.
        await callback();
      } catch (error) {
        logAfterCommitFailure(error);
      }
    }
    return result;
  };
}

/**
 * The functions `runInTransactionScope` has handed to `db.transaction`. A
 * WeakSet, not a name: a minifier renames functions, and the harness that needs
 * to tell a scope's transaction from an ordinary one (db/testing.ts) must not
 * depend on it.
 */
const scopeCallbacks = new WeakSet<object>();

export function markTransactionScopeCallback(callback: object): void {
  scopeCallbacks.add(callback);
}

export function isMarkedTransactionScopeCallback(callback: object): boolean {
  return scopeCallbacks.has(callback);
}
