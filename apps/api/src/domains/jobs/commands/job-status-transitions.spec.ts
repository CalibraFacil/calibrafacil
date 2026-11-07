import { describe, expect, it, vi } from "vitest";
import type { JobStatus } from "@calibra-facil/db/schema";

vi.mock("@calibra-facil/db", () => ({ db: {} }));

import { isCancelableJobStatus } from "./job-status-transitions";

describe("job cancellation allow-list", () => {
  it.each<[JobStatus, boolean]>([
    ["DRAFT", true],
    ["IN_PROGRESS", true],
    ["REVIEW", true],
    ["REJECTED", true],
    // Approval in progress: the worker owns the job until it is APPROVED.
    ["GENERATING_PDF", false],
    ["APPROVED", false],
    ["SUPERSEDED", false],
    ["CANCELED", false],
  ])("REQ-JOBST-001 %s cancellable = %s", (status, expected) => {
    expect(isCancelableJobStatus(status)).toBe(expected);
  });
});
