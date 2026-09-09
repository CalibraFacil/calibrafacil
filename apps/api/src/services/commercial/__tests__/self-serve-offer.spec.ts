import { describe, expect, it } from "vitest";

import {
  buildSelfServeIdempotencyKey,
  isSelfServeOffer,
} from "../self-serve-offer";

describe("self-serve offer marker", () => {
  const key = buildSelfServeIdempotencyKey({
    organizationId: "org-1",
    planId: "PROFESSIONAL",
    billingCycle: "YEARLY",
    nonce: "abc",
  });

  it("recognizes an offer the customer issued for itself", () => {
    expect(isSelfServeOffer({ termsSnapshot: { idempotencyKey: key } })).toBe(
      true,
    );
  });

  it("leaves an operator-issued offer alone", () => {
    // A plan change prepared by a human is reconciled by that human, so the
    // customer-facing guards must not reach into it.
    expect(
      isSelfServeOffer({
        termsSnapshot: { idempotencyKey: "backoffice:org-1:offer" },
      }),
    ).toBe(false);
  });

  it("treats a snapshot with no key as operator-issued", () => {
    expect(isSelfServeOffer({ termsSnapshot: {} })).toBe(false);
    expect(isSelfServeOffer({ termsSnapshot: null })).toBe(false);
    expect(isSelfServeOffer({ termsSnapshot: { idempotencyKey: 7 } })).toBe(
      false,
    );
  });
});
