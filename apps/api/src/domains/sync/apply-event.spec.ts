import { describe, expect, it } from "vitest";
import { DomainError, invalid, notFound } from "../../lib/domain-errors";
import { applyFailureCode } from "./apply-event";

describe("applyFailureCode", () => {
  it("answers a permanent refusal for a typed 4xx refusal, whatever its wording", () => {
    expect(
      applyFailureCode(notFound("service_not_found", "qualquer texto novo")),
    ).toBe("DOMAIN_VALIDATION_FAILED");
    expect(applyFailureCode(invalid("unit_asset_mismatch", "outro"))).toBe(
      "DOMAIN_VALIDATION_FAILED",
    );
  });

  it("keeps a plain Error, even one that reuses a refusal's sentence, transient", () => {
    expect(applyFailureCode(new Error("Ativo nao encontrado"))).toBe(
      "DESKTOP_SYNC_APPLY_FAILED",
    );
  });

  it("keeps a 5xx or rate-limit domain error transient", () => {
    expect(
      applyFailureCode(
        new DomainError({
          code: "invalid_request",
          status: 503,
          message: "down",
        }),
      ),
    ).toBe("DESKTOP_SYNC_APPLY_FAILED");
    expect(
      applyFailureCode(
        new DomainError({
          code: "invalid_request",
          status: 429,
          message: "slow",
        }),
      ),
    ).toBe("DESKTOP_SYNC_APPLY_FAILED");
  });
});
