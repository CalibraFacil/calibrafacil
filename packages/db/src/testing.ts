import { isOrgBoundTransactionCallback } from "./for-org";
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
 * Whether `callback` is the one `orgDb(...).transaction` hands to the driver: a
 * transaction that names the organization for row-level security and runs the
 * caller's statements. The harness that forces the interleaving of a lost
 * compare-and-set skips these (an auth middleware opens one before the handler
 * even reads the job) and fires right before the handler's own write transaction.
 */
export function isOrgBoundTransaction(callback: object): boolean {
  return isOrgBoundTransactionCallback(callback);
}
