import {
  isMarkedTransactionScopeCallback,
  transactionScopeStorage,
} from "./transaction-scope.js";

/**
 * Test seams for the transaction scope (`runInTransactionScope`). TEST CODE
 * ONLY: production code under apps/ and packages/ must not import
 * `@calibra-facil/db/testing` (an oxlint rule enforces it).
 */

/**
 * Whether `callback` is the one a transaction scope hands to `db.transaction`.
 * The harness that forces the interleaving of a lost compare-and-set must wait
 * for the write's own transaction, which inside a scope is a savepoint and not
 * this one.
 */
export function isTransactionScopeCallback(callback: object): boolean {
  return isMarkedTransactionScopeCallback(callback);
}

/**
 * Runs `callback` as if no transaction scope were open: `db` resolves to a
 * connection of its own. For the harness that plays another actor writing while
 * a request holds its transaction.
 */
export function outsideTransactionScope<T>(callback: () => T): T {
  return transactionScopeStorage.exit(callback);
}

/**
 * For the application-role harness (apps/api/test/integration/app-role-mode.ts): it
 * must open a request's transaction scope on its `calibra_app` pool, and keep
 * `db` resolving to that scope's transaction inside it.
 */
export {
  createTransactionScopeRunner,
  currentTransactionScope,
} from "./transaction-scope.js";
