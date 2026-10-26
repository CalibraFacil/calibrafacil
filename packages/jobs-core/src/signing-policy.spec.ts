import { describe, it, expect } from "vitest";

import { resolveSigningPolicy } from "./signing-policy";

describe("resolveSigningPolicy (#644 / CMP-01)", () => {
  it("signs when a certificate is available", () => {
    expect(
      resolveSigningPolicy({
        hasMasterKey: true,
        hasCertificate: true,
        hadCertificate: true,
        requireSignature: false,
      }),
    ).toEqual({ action: "SIGN" });
    expect(
      resolveSigningPolicy({
        hasMasterKey: true,
        hasCertificate: true,
        hadCertificate: true,
        requireSignature: true,
      }),
    ).toEqual({ action: "SIGN" });
  });

  it("REQ-CMP-SIGN-003: never had a certificate + policy allows => emits unsigned (marked, not silent)", () => {
    const decision = resolveSigningPolicy({
      hasMasterKey: true,
      hasCertificate: false,
      hadCertificate: false,
      requireSignature: false,
    });
    expect(decision.action).toBe("EMIT_UNSIGNED");
  });

  it("never had a certificate + assinatura obrigatória => FAIL with a named pt-BR reason", () => {
    const decision = resolveSigningPolicy({
      hasMasterKey: true,
      hasCertificate: false,
      hadCertificate: false,
      requireSignature: true,
    });
    expect(decision.action).toBe("FAIL");
    if (decision.action === "FAIL") {
      expect(decision.reason).toContain("Assinatura obrigatória");
      expect(decision.reason).toContain("nenhum certificado");
      // Not a lapse: nobody signed here before, so no alert goes to the admins.
      expect(decision.code).toBeUndefined();
    }
  });

  it("missing SIGNING_MASTER_KEY follows the same flag (fail when required, unsigned otherwise)", () => {
    expect(
      resolveSigningPolicy({
        hasMasterKey: false,
        hasCertificate: false,
        hadCertificate: false,
        requireSignature: true,
      }).action,
    ).toBe("FAIL");
    expect(
      resolveSigningPolicy({
        hasMasterKey: false,
        hasCertificate: false,
        hadCertificate: false,
        requireSignature: false,
      }).action,
    ).toBe("EMIT_UNSIGNED");
  });
});

describe("resolveSigningPolicy — an expired/revoked certificate fails closed (P0-8, Q44)", () => {
  it.each([false, true])(
    "a unit that has had a certificate and has none valid FAILS, require_signature=%s",
    (requireSignature) => {
      const decision = resolveSigningPolicy({
        hasMasterKey: true,
        hasCertificate: false,
        hadCertificate: true,
        lapse: "o último certificado expirou em 12/03/2026",
        requireSignature,
      });
      expect(decision.action).toBe("FAIL");
      if (decision.action === "FAIL") {
        expect(decision.code).toBe("SIGNING_CERTIFICATE_LAPSED");
        expect(decision.reason).toContain("expirado/ausente");
        expect(decision.reason).toContain("12/03/2026");
        expect(decision.reason).toContain("bloqueada");
      }
    },
  );

  it("a missing platform key also fails once the unit has signed before", () => {
    const decision = resolveSigningPolicy({
      hasMasterKey: false,
      hasCertificate: false,
      hadCertificate: true,
      requireSignature: false,
    });
    expect(decision.action).toBe("FAIL");
    if (decision.action === "FAIL") {
      expect(decision.code).toBe("SIGNING_CERTIFICATE_LAPSED");
      expect(decision.reason).toContain("chave de assinatura da plataforma");
    }
  });

  it("a unit that never had one is unchanged: unsigned unless require_signature", () => {
    const decision = resolveSigningPolicy({
      hasMasterKey: true,
      hasCertificate: false,
      hadCertificate: false,
      requireSignature: false,
    });
    expect(decision.action).toBe("EMIT_UNSIGNED");
    if (decision.action === "EMIT_UNSIGNED") {
      expect(decision.unsignedByPolicy).toBeNull();
    }
  });
});

describe("resolveSigningPolicy — the unit's explicit 'emitir sem assinatura digital' (Q51)", () => {
  const REASON = "O laboratório decidiu deixar de assinar.";

  it("a unit that signed before may issue unsigned again ONLY with the setting, and the reason is carried", () => {
    const decision = resolveSigningPolicy({
      hasMasterKey: true,
      hasCertificate: false,
      hadCertificate: true,
      unsignedIssuanceReason: REASON,
      requireSignature: false,
    });
    expect(decision).toMatchObject({
      action: "EMIT_UNSIGNED",
      unsignedByPolicy: REASON,
    });
    // Same facts, setting off: fails closed.
    expect(
      resolveSigningPolicy({
        hasMasterKey: true,
        hasCertificate: false,
        hadCertificate: true,
        unsignedIssuanceReason: null,
        requireSignature: false,
      }).action,
    ).toBe("FAIL");
  });

  it("a blank reason is not a choice", () => {
    expect(
      resolveSigningPolicy({
        hasMasterKey: true,
        hasCertificate: false,
        hadCertificate: true,
        unsignedIssuanceReason: "   ",
        requireSignature: false,
      }).action,
    ).toBe("FAIL");
  });

  it("works when the platform key is missing too", () => {
    expect(
      resolveSigningPolicy({
        hasMasterKey: false,
        hasCertificate: false,
        hadCertificate: true,
        unsignedIssuanceReason: REASON,
        requireSignature: false,
      }),
    ).toMatchObject({ action: "EMIT_UNSIGNED", unsignedByPolicy: REASON });
  });

  it("only relaxes the lapsed failure: a valid certificate still signs, and require_signature still fails", () => {
    expect(
      resolveSigningPolicy({
        hasMasterKey: true,
        hasCertificate: true,
        hadCertificate: true,
        unsignedIssuanceReason: REASON,
        requireSignature: false,
      }),
    ).toEqual({ action: "SIGN" });
    expect(
      resolveSigningPolicy({
        hasMasterKey: true,
        hasCertificate: false,
        hadCertificate: true,
        unsignedIssuanceReason: REASON,
        requireSignature: true,
      }).action,
    ).toBe("FAIL");
  });
});
