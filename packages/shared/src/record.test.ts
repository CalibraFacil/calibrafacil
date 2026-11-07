import { describe, expect, it } from "vitest";

import { isRecord, toRecord, toRecordArray } from "./record";

describe("record narrowing", () => {
  it("accepts plain objects only", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });

  it("falls back to an empty object and copies the input", () => {
    const source = { a: 1 };
    const copy = toRecord(source);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    expect(toRecord([1])).toEqual({});
    expect(toRecord(undefined)).toEqual({});
  });

  it("keeps the object members of an array", () => {
    expect(toRecordArray([{ a: 1 }, 2, null, [3], { b: 2 }])).toEqual([
      { a: 1 },
      { b: 2 },
    ]);
    expect(toRecordArray({ a: 1 })).toEqual([]);
  });
});
