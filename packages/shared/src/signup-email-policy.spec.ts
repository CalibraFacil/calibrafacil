import { describe, expect, it } from "vitest";

import {
  checkSignupEmail,
  emailDomain,
  isCorporateSignupEmail,
  SIGNUP_EMAIL_REJECTION_MESSAGES,
} from "./signup-email-policy";

describe("checkSignupEmail", () => {
  it("accepts an address at the laboratory's own domain", () => {
    const result = checkSignupEmail("carla@metrologiaexemplo.com.br");
    expect(result).toEqual({
      ok: true,
      email: "carla@metrologiaexemplo.com.br",
      domain: "metrologiaexemplo.com.br",
    });
  });

  it("normalises case and surrounding whitespace before deciding", () => {
    const result = checkSignupEmail("  Carla@Lab-Metrologia.COM.BR ");
    expect(result).toEqual({
      ok: true,
      email: "carla@lab-metrologia.com.br",
      domain: "lab-metrologia.com.br",
    });
  });

  it.each([
    "alguem@gmail.com",
    "alguem@hotmail.com",
    "alguem@outlook.com.br",
    "alguem@uol.com.br",
    "alguem@bol.com.br",
    "alguem@terra.com.br",
    "alguem@yahoo.com.br",
    "alguem@icloud.com",
    "alguem@proton.me",
  ])("refuses the free provider %s", (email) => {
    const result = checkSignupEmail(email);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("public_provider");
  });

  it("refuses a throwaway inbox with its own reason", () => {
    const result = checkSignupEmail("alguem@mailinator.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("disposable");
  });

  it.each([
    "sem-arroba",
    "@semlocal.com",
    "alguem@",
    "alguem@localhost",
    "alguem@dominio",
    "alguem@dominio..com",
    "alguem@-.com",
    "alguem@dominio.c",
  ])("refuses the malformed address %s", (email) => {
    const result = checkSignupEmail(email);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_format");
  });

  it("does not refuse a domain merely because a provider name appears inside it", () => {
    // A real lab could own gmail-consultoria.com.br; only the exact domain is
    // on the list, never a substring of it.
    expect(isCorporateSignupEmail("contato@gmail-consultoria.com.br")).toBe(
      true,
    );
    expect(isCorporateSignupEmail("contato@meugmail.com")).toBe(true);
  });

  it("uses the last @ so a quoted local part cannot smuggle a domain in", () => {
    expect(emailDomain('"a@gmail.com"@laboratorio.com.br')).toBe(
      "laboratorio.com.br",
    );
  });

  it("has copy for every rejection reason", () => {
    for (const reason of [
      "invalid_format",
      "public_provider",
      "disposable",
    ] as const) {
      expect(SIGNUP_EMAIL_REJECTION_MESSAGES[reason].length).toBeGreaterThan(
        10,
      );
    }
  });
});
