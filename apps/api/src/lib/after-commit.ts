import type { OrgDb } from "@calibra-facil/db/for-org";

/**
 * Side effects that must wait for an org-bound transaction to commit.
 *
 * A handler that runs in `orgDb(org).transaction((tx) => ...)` and calls a lib
 * function that fires a side effect reading what the transaction wrote (a
 * notification that reads the new row back, a queue job for a record the
 * transaction inserted) hands the lib `queue.add` instead: the lib registers the
 * effect, the handler runs the queue once the transaction has committed, and a
 * rolled-back transaction never runs it.
 *
 *   const queue = afterCommitQueue();
 *   const result = await orgDb(org).transaction((tx) =>
 *     createThing(input, { executor: tx, afterCommit: queue.add }),
 *   );
 *   await queue.run();
 */
export type AfterCommitTask = () => unknown;

/**
 * What a lib function that writes AND has side effects takes to join its
 * caller's org-bound transaction: the transaction handle and where to register
 * the effects. Absent, the function writes through the plain `db` and fires
 * its effects itself, as before.
 */
export type OrgScope = {
  readonly executor: OrgDb;
  readonly afterCommit: (task: AfterCommitTask) => void;
};

export type AfterCommitQueue = {
  /** Registers a task; it runs, in order, when `run()` is called. */
  add: (task: AfterCommitTask) => void;
  /** Runs the registered tasks one after the other; the first failure propagates. */
  run: () => Promise<void>;
};

export function afterCommitQueue(): AfterCommitQueue {
  const tasks: AfterCommitTask[] = [];
  return {
    add(task) {
      tasks.push(task);
    },
    async run() {
      for (const task of tasks.splice(0)) {
        await task();
      }
    },
  };
}
