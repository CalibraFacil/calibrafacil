import { describe, expect, it } from "vitest";

import { createRng, hashSeed } from "./prng";

describe("createRng", () => {
  it("replays the same sequence for the same seed", () => {
    const a = createRng("calibra");
    const b = createRng("calibra");
    expect(Array.from({ length: 8 }, () => a.next())).toEqual(
      Array.from({ length: 8 }, () => b.next()),
    );
  });

  it("draws different sequences for different seeds", () => {
    expect(createRng("a").next()).not.toBe(createRng("b").next());
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
  });

  it("keeps ints inside the inclusive bounds", () => {
    const rng = createRng(7);
    const draws = Array.from({ length: 500 }, () => rng.int(3, 5));
    expect(Math.min(...draws)).toBe(3);
    expect(Math.max(...draws)).toBe(5);
  });

  it("shuffles without losing items", () => {
    const rng = createRng(1);
    expect(rng.shuffle([1, 2, 3, 4, 5, 6]).toSorted()).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it("honours weights", () => {
    const rng = createRng(11);
    const hits = Array.from({ length: 1000 }, () =>
      rng.weighted(["rare", "common"], [1, 19]),
    ).filter((value) => value === "common").length;
    expect(hits).toBeGreaterThan(900);
  });

  it("centres normal draws on the mean", () => {
    const rng = createRng(3);
    const draws = Array.from({ length: 2000 }, () => rng.normal(10, 2));
    const mean = draws.reduce((sum, value) => sum + value, 0) / draws.length;
    expect(mean).toBeGreaterThan(9.8);
    expect(mean).toBeLessThan(10.2);
  });

  it("forks independent, reproducible generators", () => {
    const parent = createRng("root");
    parent.next();
    const a = createRng("root").fork("assets");
    const b = parent.fork("assets");
    expect(a.next()).toBe(b.next());
    expect(createRng("root").fork("x").next()).not.toBe(
      createRng("root").fork("y").next(),
    );
  });

  it("rejects picking from an empty list", () => {
    expect(() => createRng(1).pick([])).toThrow();
  });
});
