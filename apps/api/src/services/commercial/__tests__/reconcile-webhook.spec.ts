import { describe, expect, it } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";
import { isUniqueConstraintError } from "../reconcile-webhook";

describe("isUniqueConstraintError", () => {
  it("returns true for a DrizzleQueryError wrapper whose cause is the unique violation (postgres-js)", () => {
    // Mirrors what the postgres-js driver actually throws on a duplicate insert:
    // a DrizzleQueryError wrapper with `code` undefined at the top level and the
    // real Postgres `23505` (unique_violation) carried on `.cause`.
    const cause = Object.assign(new Error("duplicate key value"), {
      code: "23505",
    });
    const error = new DrizzleQueryError("insert ...", [], cause);

    expect(error.constructor.name).toBe("DrizzleQueryError");
    expect(Reflect.get(error, "code")).toBeUndefined();
    expect(Reflect.get(error.cause ?? {}, "code")).toBe("23505");

    expect(isUniqueConstraintError(error)).toBe(true);
  });

  it("returns true for a plain object wrapper whose cause carries the 23505 code", () => {
    expect(isUniqueConstraintError({ cause: { code: "23505" } })).toBe(true);
  });

  it("returns true for a bare error with a top-level 23505 code (backward compat)", () => {
    expect(isUniqueConstraintError({ code: "23505" })).toBe(true);
  });

  it("returns false for a non-unique-violation Postgres code", () => {
    expect(isUniqueConstraintError({ code: "23503" })).toBe(false);
    expect(isUniqueConstraintError({ cause: { code: "23503" } })).toBe(false);
  });

  it("returns false for null, undefined, and non-object inputs", () => {
    expect(isUniqueConstraintError(null)).toBe(false);
    expect(isUniqueConstraintError(undefined)).toBe(false);
    expect(isUniqueConstraintError("23505")).toBe(false);
    expect(isUniqueConstraintError(23505)).toBe(false);
    expect(isUniqueConstraintError({})).toBe(false);
  });
});
