import { describe, expect, it } from "vitest";

import { getLockedOfferId } from "../public-checkout";

/**
 * The row lock in `startCommercialPublicCheckout` goes through `db.execute`,
 * whose result shape depends on the driver. Both shapes must resolve, or the
 * public checkout silently rejects every payment on one of them.
 */
describe("getLockedOfferId", () => {
  it("reads a postgres-js result (bare array, Bun/Node/Vercel)", () => {
    expect(getLockedOfferId([{ id: "offer-1" }])).toBe("offer-1");
  });

  it("reads a Neon serverless result ({ rows }, Cloudflare Workers)", () => {
    expect(getLockedOfferId({ rows: [{ id: "offer-1" }] })).toBe("offer-1");
  });

  it("returns undefined when no row was locked", () => {
    expect(getLockedOfferId([])).toBeUndefined();
    expect(getLockedOfferId({ rows: [] })).toBeUndefined();
    expect(getLockedOfferId(undefined)).toBeUndefined();
    expect(getLockedOfferId({ rows: [{ id: 42 }] })).toBeUndefined();
  });
});
