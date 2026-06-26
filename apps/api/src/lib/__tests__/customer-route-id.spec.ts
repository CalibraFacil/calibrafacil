import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: {
    results: unknown[][];
    limits: number[];
  } = {
    results: [],
    limits: [],
  };

  class FakeQuery implements PromiseLike<unknown[]> {
    constructor(private readonly result: unknown[]) {}

    from(_table?: unknown) {
      return this;
    }

    where(_condition?: unknown) {
      return this;
    }

    orderBy(_column?: unknown) {
      return this;
    }

    limit(count: number) {
      state.limits.push(count);
      return this;
    }

    // oxlint-disable-next-line unicorn/no-thenable -- FakeQuery intentionally emulates Drizzle's awaitable query builder; `then` is required so `await db.select()...` resolves in the test.
    then<TResult1 = unknown[], TResult2 = never>(
      onfulfilled?:
        | ((value: unknown[]) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ) {
      return Promise.resolve(this.result).then(onfulfilled, onrejected);
    }
  }

  return {
    db: {
      select: vi.fn(() => new FakeQuery(state.results.shift() ?? [])),
    },
    state,
  };
});

vi.mock("@calibra-facil/db", () => ({
  db: mocks.db,
}));

import { resolveCustomerRouteId } from "../customer-route-id";

function useDbResults(...results: unknown[][]) {
  mocks.state.results = [...results];
  mocks.state.limits = [];
}

describe("resolveCustomerRouteId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDbResults();
  });

  it("resolves a direct numeric id without scanning customer slugs", async () => {
    useDbResults([{ id: 42 }]);

    await expect(resolveCustomerRouteId("42", "org-1")).resolves.toBe(42);

    expect(mocks.db.select).toHaveBeenCalledTimes(1);
    expect(mocks.state.limits).toEqual([1]);
  });

  it("caps the slug fallback scan inside the organization scope", async () => {
    useDbResults(
      [],
      [
        {
          id: 17,
          name: "Cliente Matriz",
          taxId: "12345678000190",
        },
      ],
    );

    await expect(
      resolveCustomerRouteId("cliente-matriz", "org-1"),
    ).resolves.toBe(17);

    expect(mocks.db.select).toHaveBeenCalledTimes(2);
    expect(mocks.state.limits).toEqual([1, 500]);
  });
});
