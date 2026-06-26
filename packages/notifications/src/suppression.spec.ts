/**
 * REQ-SUP-002: suppressEmail / isEmailSuppressed helpers.
 *
 *  - suppressEmail upserts on (email, scope) so a repeated suppression is
 *    idempotent, and normalizes the address to lowercase/trim before storing.
 *  - isEmailSuppressed returns true when the address is suppressed at the asked
 *    scope OR at the broader 'all' scope.
 *
 * The DB is mocked: the suppression list lives behind drizzle, so the tests bind
 * to (a) the pure normalization + scope-fallback logic and (b) the upsert/select
 * wiring, which is where a regression would silently let suppressed mail through.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    insert: vi.fn(),
    select: vi.fn(),
  },
}));

vi.mock("@calibra-facil/db", () => ({ db: dbMock }));

vi.mock("@calibra-facil/db/schema", () => ({
  emailSuppression: { id: "id", email: "email", scope: "scope" },
}));

import {
  suppressEmail,
  isEmailSuppressed,
  normalizeSuppressionEmail,
  suppressionScopesToCheck,
} from "./suppression";

// ---------------------------------------------------------------------------
// Thenable chain: every builder method returns the chain, awaiting resolves it.
// ---------------------------------------------------------------------------
type Chain = {
  values: ReturnType<typeof vi.fn>;
  onConflictDoUpdate: ReturnType<typeof vi.fn>;
  onConflictDoNothing: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  then: (resolve: (value: unknown[]) => unknown) => unknown;
};

function makeChain(result: unknown[] = []): Chain {
  const chain: Chain = {
    values: vi.fn(() => chain),
    onConflictDoUpdate: vi.fn(() => chain),
    onConflictDoNothing: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    returning: vi.fn(() => chain),
    // oxlint-disable-next-line unicorn/no-thenable -- mocks drizzle's awaitable query builder
    then: (resolve) => resolve(result),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe("REQ-SUP-002: suppressEmail upserts idempotently", () => {
  it("REQ-SUP-002 stores the normalized email and upserts on (email, scope)", async () => {
    const chain = makeChain([]);
    dbMock.insert.mockReturnValue(chain);

    await suppressEmail({
      email: "  Complaint@LAB.com ",
      scope: "all",
      reason: "complaint",
      source: "resend_webhook",
    });

    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    const values = chain.values.mock.calls[0]?.[0];
    expect(values).toMatchObject({
      email: "complaint@lab.com",
      scope: "all",
      reason: "complaint",
      source: "resend_webhook",
    });

    // The upsert must target the (email, scope) unique pair, not insert blindly.
    expect(chain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const conflict = chain.onConflictDoUpdate.mock.calls[0]?.[0];
    expect(conflict?.target).toEqual(["email", "scope"]);
  });
});

describe("REQ-SUP-002: isEmailSuppressed reflects the stored rows", () => {
  it("REQ-SUP-002 returns true when a suppression row exists", async () => {
    dbMock.select.mockReturnValue(makeChain([{ id: 1 }]));
    expect(await isEmailSuppressed("blocked@lab.com", "marketing")).toBe(true);
  });

  it("REQ-SUP-002 returns false when no suppression row exists", async () => {
    dbMock.select.mockReturnValue(makeChain([]));
    expect(await isEmailSuppressed("clean@lab.com", "marketing")).toBe(false);
  });
});
