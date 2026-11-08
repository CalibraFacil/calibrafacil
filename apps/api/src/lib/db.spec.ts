import { describe, expect, it } from "vitest";
import { z } from "zod";
import { executeRowCount, executeRows } from "./db";

const schema = z.object({ id: z.number(), name: z.string().nullable() });

describe("executeRows", () => {
  it("reads the rows of both driver shapes and returns what the schema proves", () => {
    const rows = [{ id: 1, name: "a" }];
    expect(executeRows(rows, schema)).toEqual(rows);
    expect(executeRows({ rows }, schema)).toEqual(rows);
    expect(executeRows([], schema)).toEqual([]);
  });

  it("applies the schema's coercion (a count that arrives as text)", () => {
    expect(
      executeRows([{ n: "3" }], z.object({ n: z.coerce.number() })),
    ).toEqual([{ n: 3 }]);
  });

  it("throws on a result of an unknown shape instead of reading it as no rows", () => {
    expect(() => executeRows(undefined, schema)).toThrow(/unknown shape/);
    expect(() => executeRows({ rowCount: 0 }, schema)).toThrow(/unknown shape/);
    expect(() => executeRows({ rows: "nope" }, schema)).toThrow(
      /unknown shape/,
    );
  });

  it("throws on a row that does not match the schema", () => {
    expect(() => executeRows([{ id: "1", name: null }], schema)).toThrow();
  });
});

describe("executeRowCount", () => {
  it("counts the rows of both shapes and throws on an unknown one", () => {
    expect(executeRowCount([{}, {}])).toBe(2);
    expect(executeRowCount({ rows: [{}] })).toBe(1);
    expect(executeRowCount({ rows: [] })).toBe(0);
    expect(() => executeRowCount(null)).toThrow(/unknown shape/);
  });
});
