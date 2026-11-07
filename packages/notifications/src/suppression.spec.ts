/**
 * REQ-SUP-002: the pure half of the suppression ledger helpers.
 *
 *  - the address is normalized to lowercase/trim before it is stored or looked up;
 *  - checking a narrower scope also checks the broader 'all' scope.
 *
 * The database half (the upsert on (email, scope), the lookup) is not mocked here:
 * a drizzle-builder double only repeats the shape of the query, never the behaviour.
 */
import { describe, expect, it, vi } from "vitest";

// The module reads `db` at import time only; nothing below touches it.
vi.mock("@calibra-facil/db", () => ({ db: {}, systemDb: {} }));
vi.mock("@calibra-facil/db/schema", () => ({
  emailSuppression: { id: "id", email: "email", scope: "scope" },
}));

import {
  normalizeSuppressionEmail,
  suppressionScopesToCheck,
} from "./suppression";

describe("REQ-SUP-002: normalization + scope fallback (pure)", () => {
  it("REQ-SUP-002 normalizes the address to lowercase + trimmed", () => {
    expect(normalizeSuppressionEmail("  USER@Example.COM ")).toBe(
      "user@example.com",
    );
  });

  it("REQ-SUP-002 checking 'marketing' also checks the broader 'all' scope", () => {
    expect(suppressionScopesToCheck("marketing")).toEqual(["marketing", "all"]);
  });

  it("REQ-SUP-002 checking 'all' only checks 'all'", () => {
    expect(suppressionScopesToCheck("all")).toEqual(["all"]);
  });
});
