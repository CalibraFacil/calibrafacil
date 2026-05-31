import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_METADATA,
  PLANS,
  getEnabledEntitlements,
  getPlan,
  hasEntitlement,
  hasFeature,
} from "@calibra-facil/shared";

describe("shared plan contracts", () => {
  it("keeps client portal available on Standard", () => {
    expect(hasEntitlement("STANDARD", "portal")).toBe(true);
    expect(hasFeature("STANDARD", "portal")).toBe(true);
  });

  it("exposes professional entitlements through the compatibility layer", () => {
    expect(hasEntitlement("PROFESSIONAL", "approval_workflow")).toBe(true);
    expect(hasFeature("PROFESSIONAL", "approval_workflow")).toBe(true);
    expect(hasEntitlement("PROFESSIONAL", "custom_domain")).toBe(true);
  });

  it("includes native financial ERP integrations from Professional up", () => {
    expect(hasEntitlement("FREE", "financial_integrations")).toBe(false);
    expect(hasEntitlement("STANDARD", "financial_integrations")).toBe(false);
    expect(hasEntitlement("PROFESSIONAL", "financial_integrations")).toBe(true);
    expect(hasFeature("PROFESSIONAL", "financial_integrations")).toBe(true);
    expect(hasEntitlement("ENTERPRISE", "financial_integrations")).toBe(true);
  });

  it("keeps enterprise-only scale features restricted", () => {
    expect(hasEntitlement("PROFESSIONAL", "multi_unit")).toBe(false);
    expect(hasEntitlement("ENTERPRISE", "multi_unit")).toBe(true);
    expect(hasEntitlement("ENTERPRISE", "custom_integrations")).toBe(true);
    expect(hasEntitlement("PROFESSIONAL", "sso")).toBe(false);
    expect(hasEntitlement("ENTERPRISE", "sso")).toBe(true);
  });

  it("returns enabled entitlements from the shared catalog", () => {
    const professionalEntitlements = getEnabledEntitlements("PROFESSIONAL");

    expect(professionalEntitlements).toContain("advanced_audit_trail");
    expect(professionalEntitlements).toContain("priority_support");
    expect(professionalEntitlements).not.toContain("multi_unit");
  });

  it("exposes commercial metadata for ui rendering", () => {
    const professionalPlan = getPlan("PROFESSIONAL");

    expect(professionalPlan.recommendedFor).toContain("ISO 17025");
    expect(professionalPlan.isPopular).toBe(true);
    expect(PLANS.ENTERPRISE.description).toBe(
      "Para grandes operações e redes.",
    );
    expect(ENTITLEMENT_METADATA.approval_workflow.name).toBe(
      "Fluxo de Aprovação",
    );
  });
});
