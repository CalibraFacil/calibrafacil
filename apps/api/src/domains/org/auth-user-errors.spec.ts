import { describe, expect, it } from "vitest";
import { userCreateErrorWasDuplicate } from "./auth-user-errors";

describe("userCreateErrorWasDuplicate", () => {
  it("accepts conflict status errors", () => {
    expect(userCreateErrorWasDuplicate({ status: 409 })).toBe(true);
  });

  it("accepts nested unique constraint messages", () => {
    expect(
      userCreateErrorWasDuplicate({
        body: { message: "Unique constraint failed on user.email" },
      }),
    ).toBe(true);
  });

  it("rejects unrelated auth failures", () => {
    expect(userCreateErrorWasDuplicate(new Error("network unavailable"))).toBe(
      false,
    );
  });
});
