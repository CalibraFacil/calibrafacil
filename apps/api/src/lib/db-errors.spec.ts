import { describe, expect, it } from "vitest";
import { extractPgErrorCode, isUniqueViolation } from "./db-errors";

// Supports REQ-SEC-TAG-005a: the tag-conflict catch relies on recognizing a
// Postgres unique_violation (23505) even when postgres-js wraps it in a Drizzle
// `DrizzleQueryError` whose own `code` is undefined and the real 23505 lives on
// `.cause`. A regression to a bare `error.code === "23505"` check would 500
// cross-org duplicates; these assertions pin the recursive unwrap.

describe("db-errors: isUniqueViolation / extractPgErrorCode", () => {
  it("detects a bare PostgresError (code on the top-level object)", () => {
    const bare = { code: "23505", constraint_name: "asset_tag_unique" };
    expect(isUniqueViolation(bare)).toBe(true);
    expect(extractPgErrorCode(bare)).toBe("23505");
  });

  it("detects a Drizzle-wrapped error (own code undefined, 23505 on .cause)", () => {
    // Shape mirrors DrizzleQueryError over postgres-js: outer `.code` is
    // undefined, the real SQLSTATE is on the wrapped cause.
    const wrapped = {
      name: "DrizzleQueryError",
      code: undefined,
      cause: { code: "23505", constraint_name: "asset_tag_uidx" },
    };
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(extractPgErrorCode(wrapped)).toBe("23505");
  });

  it("returns false for a non-unique Postgres error (e.g. 23503 FK violation)", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation({ cause: { code: "23503" } })).toBe(false);
  });

  it("returns false for non-Postgres errors and empty inputs", () => {
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
    expect(extractPgErrorCode({})).toBeUndefined();
  });
});
