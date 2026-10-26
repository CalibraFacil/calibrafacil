import { describe, expect, it } from "vitest";

import {
  UNSIGNED_ISSUANCE_REASON_MAX_LENGTH,
  UNSIGNED_ISSUANCE_REASON_MIN_LENGTH,
  UnsignedIssuanceSettingSchema,
} from "./signing-policy";

describe("UnsignedIssuanceSettingSchema (Q51)", () => {
  const reason = "Laboratório deixou de assinar os certificados";

  it("enabling needs a justification, trimmed", () => {
    expect(
      UnsignedIssuanceSettingSchema.parse({
        enabled: true,
        reason: ` ${reason} `,
      }),
    ).toEqual({ enabled: true, reason });
  });

  it("refuses enabling without a reason, with a short one, or with an oversized one", () => {
    expect(
      UnsignedIssuanceSettingSchema.safeParse({ enabled: true }).success,
    ).toBe(false);
    expect(
      UnsignedIssuanceSettingSchema.safeParse({
        enabled: true,
        reason: "a".repeat(UNSIGNED_ISSUANCE_REASON_MIN_LENGTH - 1),
      }).success,
    ).toBe(false);
    expect(
      UnsignedIssuanceSettingSchema.safeParse({
        enabled: true,
        reason: "a".repeat(UNSIGNED_ISSUANCE_REASON_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("disabling needs no reason", () => {
    expect(UnsignedIssuanceSettingSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });
  });
});
