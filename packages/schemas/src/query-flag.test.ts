import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queryFlag } from "./query-flag";

const Query = z.object({ overdue: queryFlag.optional() });

describe("queryFlag", () => {
  it.each([
    ["true", true],
    ["1", true],
    [true, true],
    ["false", false],
    ["0", false],
    [false, false],
  ])("reads %j as %j", (input, expected) => {
    expect(Query.parse({ overdue: input })).toEqual({ overdue: expected });
  });

  it("leaves an absent flag absent", () => {
    expect(Query.parse({})).toEqual({});
  });

  it("refuses any other text", () => {
    expect(Query.safeParse({ overdue: "yes" }).success).toBe(false);
    expect(Query.safeParse({ overdue: "" }).success).toBe(false);
  });
});
