import { describe, expect, it } from "vitest";

import { API_ERROR_CODES } from "./api-errors";

describe("API error code registry", () => {
  it("lists every code once", () => {
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
  });
});
