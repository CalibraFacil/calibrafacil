import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, getDb } from "./db";
import { isTransactionScopeCallback } from "./testing";
import {
  afterTransactionCommit,
  createTransactionScopeRunner,
  isInTransactionScope,
  type OpenTransaction,
} from "./transaction-scope";

// The transaction scope, against a fake database: what the scope itself
// promises (which transaction `db` resolves to, when deferred work runs, what a
// stray continuation sees). That the real Postgres commits, rolls back and
// nests savepoints as the fake models is proved in apps/api
// (src/lib/transaction-scope.int.spec.ts and the sync specs).

type FakeTx = {
  marker: string;
  select: () => string;
  transaction: <T>(inner: (tx: FakeTx) => Promise<T>) => Promise<T>;
};

function fakeDatabase() {
  const log: string[] = [];
  let sequence = 0;

  const open: OpenTransaction = async (callback) => {
    sequence += 1;
    const id = sequence;
    const tx: FakeTx = {
      marker: `tx-${id}`,
      select: () => `select on tx-${id}`,
      transaction: async (inner) => {
        log.push(`savepoint ${id}`);
        try {
          const result = await inner(tx);
          log.push(`release ${id}`);
          return result;
        } catch (error) {
          log.push(`rollback to savepoint ${id}`);
          throw error;
        }
      },
    };
    log.push(`begin ${id}`);
    try {
      const result = await callback(tx);
      log.push(`commit ${id}`);
      return result;
    } catch (error) {
      log.push(`rollback ${id}`);
      throw error;
    }
  };

  return { open, log, transactions: () => sequence };
}

function marker(): unknown {
  return Reflect.get(db, "marker");
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  // Nothing connects: the driver is lazy, and the unscoped branch only builds it.
  vi.stubEnv("DATABASE_URL", "postgres://u:p@127.0.0.1:1/unused");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("what `db` resolves to", () => {
  it("D4: inside a scope `db` is the transaction; outside it is not", async () => {
    const { open } = fakeDatabase();
    const run = createTransactionScopeRunner(open);

    expect(marker()).toBeUndefined();
    const inside = await run(async () => {
      expect(isInTransactionScope()).toBe(true);
      return { marker: marker(), query: Reflect.get(db, "select")() };
    });

    expect(inside).toEqual({ marker: "tx-1", query: "select on tx-1" });
    expect(isInTransactionScope()).toBe(false);
    expect(marker()).toBeUndefined();
  });

  it("D4: concurrent scopes are isolated: each call chain keeps seeing its own transaction across awaits", async () => {
    const { open } = fakeDatabase();
    const run = createTransactionScopeRunner(open);

    const seen = async (id: string, delays: number[]) =>
      run(async () => {
        const markers: unknown[] = [marker()];
        for (const delay of delays) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- the interleaving is the point.
          await sleep(delay);
          markers.push(marker());
        }
        return { id, markers };
      });

    const results = await Promise.all([
      seen("a", [15, 5, 15]),
      seen("b", [5, 15, 5]),
      seen("c", [1, 1, 30]),
    ]);

    for (const { markers } of results) {
      expect(new Set(markers).size).toBe(1);
    }
    expect(new Set(results.flatMap((result) => result.markers)).size).toBe(3);
  });

  it("D4: a scope opened inside a scope joins it: one transaction, the outer one owns the commit", async () => {
    const { open, log, transactions } = fakeDatabase();
    const run = createTransactionScopeRunner(open);

    await run(async () => {
      const outer = marker();
      await run(async () => {
        expect(marker()).toBe(outer);
      });
    });

    expect(transactions()).toBe(1);
    expect(log).toEqual(["begin 1", "commit 1"]);
  });
});

describe("savepoints", () => {
  it("D4: a nested transaction that fails rolls back to its savepoint only; the scope still commits", async () => {
    const { open, log } = fakeDatabase();
    const run = createTransactionScopeRunner(open);

    await run(async () => {
      await expect(
        Reflect.get(
          db,
          "transaction",
        )(async () => {
          throw new Error("inner failed");
        }),
      ).rejects.toThrow("inner failed");
      // Work after the failed part still runs on the same transaction.
      expect(marker()).toBe("tx-1");
    });

    expect(log).toEqual([
      "begin 1",
      "savepoint 1",
      "rollback to savepoint 1",
      "commit 1",
    ]);
  });

  it("D4: a nested transaction that succeeds is released; an error that escapes the scope rolls everything back", async () => {
    const { open, log } = fakeDatabase();
    const run = createTransactionScopeRunner(open);

    await expect(
      run(async () => {
        await Reflect.get(db, "transaction")(async () => "ok");
        throw new Error("the event failed");
      }),
    ).rejects.toThrow("the event failed");

    expect(log).toEqual(["begin 1", "savepoint 1", "release 1", "rollback 1"]);
  });
});

describe("afterTransactionCommit", () => {
  it("D4: runs after the commit, in registration order, and never before", async () => {
    const { open, log } = fakeDatabase();
    const run = createTransactionScopeRunner(open);

    await run(async () => {
      afterTransactionCommit(() => {
        log.push("after 1");
      });
      afterTransactionCommit(async () => {
        await sleep(5);
        log.push("after 2");
      });
      log.push("work done");
    });

    expect(log).toEqual([
      "begin 1",
      "work done",
      "commit 1",
      "after 1",
      "after 2",
    ]);
  });

  it("D4: is discarded when the scope rolls back", async () => {
    const { open } = fakeDatabase();
    const run = createTransactionScopeRunner(open);
    const callback = vi.fn();

    await expect(
      run(async () => {
        afterTransactionCommit(callback);
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");

    expect(callback).not.toHaveBeenCalled();
  });

  it("D4: a callback that fails is logged and does not fail the committed scope or the callbacks after it", async () => {
    const { open } = fakeDatabase();
    const run = createTransactionScopeRunner(open);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const later = vi.fn();

    const result = await run(async () => {
      afterTransactionCommit(() => {
        throw new Error("wake-up failed");
      });
      afterTransactionCommit(later);
      return "committed";
    });

    expect(result).toBe("committed");
    expect(later).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("D4: outside a scope it runs at once", () => {
    const callback = vi.fn();

    afterTransactionCommit(callback);

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("work that outlives the scope", () => {
  it("D4: a fire-and-forget started inside the scope that reads `db` after it closed falls back to the pool, not to the closed transaction", async () => {
    const { open } = fakeDatabase();
    const run = createTransactionScopeRunner(open);
    const readLater: { value: unknown; settled: boolean } = {
      value: "not read",
      settled: false,
    };

    await run(async () => {
      void (async () => {
        await sleep(20);
        readLater.value = marker();
        readLater.settled = true;
      })();
      expect(marker()).toBe("tx-1");
    });
    await sleep(40);

    expect(readLater.settled).toBe(true);
    expect(readLater.value).toBeUndefined();
  });

  it("D4: once the scope closed, `isInTransactionScope` is false even in a continuation of the scope's own chain", async () => {
    const { open } = fakeDatabase();
    const run = createTransactionScopeRunner(open);
    let late: Promise<boolean> = Promise.resolve(true);

    await run(async () => {
      late = sleep(20).then(() => isInTransactionScope());
    });

    expect(await late).toBe(false);
  });
});

describe("second connections", () => {
  it("D4: getDb() inside a scope is refused (development and test): it is a second connection", async () => {
    const { open } = fakeDatabase();
    const run = createTransactionScopeRunner(open);

    await run(async () => {
      expect(() => getDb()).toThrow(/second database connection/);
    });

    expect(() => getDb()).not.toThrow();
  });
});

describe("test seam (db/testing)", () => {
  it("D4: recognises the callback a scope hands to the database, by identity, and no other function", async () => {
    const handed: unknown[] = [];
    const run = createTransactionScopeRunner(async (callback) => {
      handed.push(callback);
      return callback({});
    });

    await run(async () => "done");

    expect(handed).toHaveLength(1);
    const [callback] = handed;
    expect(
      typeof callback === "function" && isTransactionScopeCallback(callback),
    ).toBe(true);
    expect(isTransactionScopeCallback(async () => "done")).toBe(false);
  });
});
