import { describe, it, expect } from "vitest";
import { isReleaseExhausting } from "./outbox-release";

describe("REQ-REL-OBS-003: outbox dead-letter decider", () => {
  it("is not exhausting while a retry remains", () => {
    // maxAttempts=3: a row at attempts 0 or 1 still has retries left after release.
    expect(isReleaseExhausting(0, 3)).toBe(false);
    expect(isReleaseExhausting(1, 3)).toBe(false);
  });

  it("is exhausting when this release pushes attempts to maxAttempts", () => {
    // attempts=2 → after release attempts=3 → never selected again → dead-letter.
    expect(isReleaseExhausting(2, 3)).toBe(true);
    expect(isReleaseExhausting(4, 3)).toBe(true);
  });
});
