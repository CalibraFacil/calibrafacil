import { afterEach, describe, expect, it, vi } from "vitest";
import { reportWorkerError } from "./observability";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reportWorkerError", () => {
  it("writes ONE line and it carries no bound value of the failed statement", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    reportWorkerError(
      new Error(
        'Failed query: insert into "customer" ("email") values ($1)\nparams: maria.souza@cliente.example',
      ),
      { jobType: "CERTIFICATE" },
    );

    expect(stderr).toHaveBeenCalledTimes(1);
    const line = String(stderr.mock.calls[0]?.[0]);
    expect(line).not.toContain("maria.souza@cliente.example");
    expect(JSON.parse(line)).toMatchObject({
      service: "worker",
      tags: { surface: "worker", jobType: "CERTIFICATE" },
    });
  });
});
