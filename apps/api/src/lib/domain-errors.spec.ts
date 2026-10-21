import { describe, expect, it } from "vitest";
import { API_ERROR_CODES } from "@calibra-facil/contracts";
import {
  DomainError,
  conflict,
  domainErrorBody,
  forbidden,
  invalid,
  notFound,
  unauthenticated,
  unprocessable,
} from "./domain-errors";

describe("DomainError (REQ-DE-1)", () => {
  it.each([
    ["invalid", invalid("invalid_request", "m"), 400],
    ["unauthenticated", unauthenticated("unauthenticated", "m"), 401],
    ["forbidden", forbidden("forbidden", "m"), 403],
    ["notFound", notFound("not_found", "m"), 404],
    ["conflict", conflict("conflict", "m"), 409],
    ["unprocessable", unprocessable("unprocessable", "m"), 422],
  ] as const)(
    "REQ-DE-1: %s helper builds a DomainError with status %i",
    (_name, error, status) => {
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(Error);
      expect(error.status).toBe(status);
      expect(error.message).toBe("m");
    },
  );

  it("REQ-DE-1: body carries error text, stable code and optional details", () => {
    const error = conflict("job_status_conflict", "Status mudou", {
      details: { currentStatus: "REJECTED" },
    });

    expect(domainErrorBody(error)).toEqual({
      error: "Status mudou",
      code: "job_status_conflict",
      details: { currentStatus: "REJECTED" },
    });
    expect(domainErrorBody(conflict("conflict", "x"))).toEqual({
      error: "x",
      code: "conflict",
    });
  });

  it("REQ-DE-1: legacy top-level fields are merged into the body for backwards compatibility", () => {
    const error = conflict("JOB_STATUS_CONFLICT", "Status mudou", {
      legacyBody: { currentStatus: "REJECTED" },
    });

    expect(domainErrorBody(error)).toEqual({
      error: "Status mudou",
      code: "JOB_STATUS_CONFLICT",
      currentStatus: "REJECTED",
    });
  });

  it("REQ-DE-1: every registry code is unique snake_case, except the documented legacy one", () => {
    const nonSnake = API_ERROR_CODES.filter(
      (code) => !/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(code),
    );
    expect(nonSnake).toEqual(["JOB_STATUS_CONFLICT"]);
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
  });
});
