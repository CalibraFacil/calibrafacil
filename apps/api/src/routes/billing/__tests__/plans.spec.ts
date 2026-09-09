import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_METADATA,
  FEATURE_FLAGS,
  PLANS,
  getEnabledEntitlements,
  getPlan,
  hasEntitlement,
  hasFeature,
} from "@calibra-facil/shared";

describe("shared plan contracts", () => {
  it("has no flag for anything ISO/IEC 17025 requires", () => {
    // The guarantee is structural, not editorial: uncertainty calculation,
    // method review and approval, and the audit trail cannot be gated because
    // there is no longer a flag to gate them with. Method publication sat
    // behind `approval_workflow` for a while, which made the entry tier unable
    // to open a single job — this is what stops that from recurring.
    const forbidden = [
      "math_engine",
      "approval_workflow",
      "advanced_audit_trail",
    ];

    for (const flag of forbidden) {
      expect(FEATURE_FLAGS).not.toContain(flag);
    }
  });

  it("gates nothing that the API does not really refuse", () => {
    // Every surviving flag has real enforcement behind it. A flag that gates
    // nothing is an invitation to wire it into a route later.
    expect([...FEATURE_FLAGS].sort()).toEqual(
      [
        "api",
        "custom_domain",
        "customer_group",
        "email_sender_domain",
        "financial",
        "financial_integrations",
        "multi_unit",
        "portal",
        "sso",
      ].sort(),
    );
  });

  it("puts the client portal at Professional, not Standard", () => {
    // Essencial sends the certificate by e-mail from the lab's own domain;
    // giving the lab's customers a login of their own is what Profissional
    // adds.
    expect(hasEntitlement("STANDARD", "portal")).toBe(false);
    expect(hasFeature("STANDARD", "portal")).toBe(false);
    expect(hasEntitlement("PROFESSIONAL", "portal")).toBe(true);
    expect(hasEntitlement("ADVANCED", "portal")).toBe(true);
    expect(hasEntitlement("ENTERPRISE", "portal")).toBe(true);
  });

  it("leaves Essencial with the lab's own sending domain and nothing gated", () => {
    expect(getEnabledEntitlements("STANDARD")).toEqual(["email_sender_domain"]);
  });

  it("includes native financial ERP integrations from Professional up", () => {
    expect(hasEntitlement("FREE", "financial_integrations")).toBe(false);
    expect(hasEntitlement("STANDARD", "financial_integrations")).toBe(false);
    expect(hasEntitlement("PROFESSIONAL", "financial_integrations")).toBe(true);
    expect(hasFeature("PROFESSIONAL", "financial_integrations")).toBe(true);
    expect(hasEntitlement("ENTERPRISE", "financial_integrations")).toBe(true);
  });

  it("gives Escala its own fence: branches of the laboratory", () => {
    // Without this the tier is a surcharge, not a tier — its entitlements were
    // byte-identical to Profissional.
    expect(hasEntitlement("PROFESSIONAL", "multi_unit")).toBe(false);
    expect(hasEntitlement("ADVANCED", "multi_unit")).toBe(true);
    expect(hasEntitlement("ENTERPRISE", "multi_unit")).toBe(true);
  });

  it("keeps SSO for Enterprise alone", () => {
    expect(hasEntitlement("ADVANCED", "sso")).toBe(false);
    expect(hasEntitlement("ENTERPRISE", "sso")).toBe(true);
  });

  it("climbs the certificate ladder at volumes a real lab reaches", () => {
    expect(PLANS.STANDARD.limits.certificates).toBe(100);
    expect(PLANS.PROFESSIONAL.limits.certificates).toBe(300);
    expect(PLANS.ADVANCED.limits.certificates).toBe(900);
  });

  it("exposes commercial metadata for ui rendering", () => {
    const professionalPlan = getPlan("PROFESSIONAL");

    expect(professionalPlan.recommendedFor).toContain("ISO 17025");
    expect(professionalPlan.isPopular).toBe(true);
    expect(PLANS.ADVANCED.name).toBe("Escala");
    expect(PLANS.ENTERPRISE.description).toBe(
      "Para grandes operações e redes.",
    );
    expect(ENTITLEMENT_METADATA.portal.name).toBe("Portal do Cliente");
  });
});
