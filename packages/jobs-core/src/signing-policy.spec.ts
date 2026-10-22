import { describe, it, expect } from "vitest";

import { resolveSigningPolicy } from "./signing-policy";

describe("resolveSigningPolicy (#644 / CMP-01)", () => {
  it("signs when a certificate is available", () => {
    expect(
      resolveSigningPolicy({
        hasMasterKey: true,
        hasCertificate: true,
        requireSignature: false,
      }),
    ).toEqual({ action: "SIGN" });
    expect(
      resolveSigningPolicy({
        hasMasterKey: true,
        hasCertificate: true,
        requireSignature: true,
      }),
    ).toEqual({ action: "SIGN" });
  });

  it("REQ-CMP-SIGN-003: no certificate + policy allows => emits unsigned (marked, not silent)", () => {
    const decision = resolveSigningPolicy({
      hasMasterKey: true,
      hasCertificate: false,
      requireSignature: false,
    });
    expect(decision.action).toBe("EMIT_UNSIGNED");
  });

  it("no certificate + assinatura obrigatória => FAIL with a named pt-BR reason", () => {
    const decision = resolveSigningPolicy({
      hasMasterKey: true,
      hasCertificate: false,
      requireSignature: true,
    });
    expect(decision.action).toBe("FAIL");
    if (decision.action === "FAIL") {
      expect(decision.reason).toContain("Assinatura obrigatória");
      expect(decision.reason).toContain("nenhum certificado");
    }
  });

  it("missing SIGNING_MASTER_KEY follows the same flag (fail when required, unsigned otherwise)", () => {
    expect(
      resolveSigningPolicy({
        hasMasterKey: false,
        hasCertificate: false,
        requireSignature: true,
      }).action,
    ).toBe("FAIL");
    expect(
      resolveSigningPolicy({
        hasMasterKey: false,
        hasCertificate: false,
        requireSignature: false,
      }).action,
    ).toBe("EMIT_UNSIGNED");
  });
});
