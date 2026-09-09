import { describe, expect, it } from "vitest";
import { SelfServeSignupSchema } from "@calibra-facil/schemas";
import { checkSignupEmail } from "@calibra-facil/shared";

/**
 * The public sign-up route is the only way to create an organization without a
 * human approving it, so the contract it enforces is worth pinning down
 * independently of the handler: what the schema accepts is what reaches
 * provisioning.
 */
describe("self-serve signup contract", () => {
  const valid = {
    name: "Carla Menezes",
    email: "carla@laboratorio-exemplo.com.br",
    labName: "Laboratório Exemplo",
    cnpj: "11.222.333/0001-81",
    phone: "51999998888",
    planId: "PROFESSIONAL",
    billingCycle: "YEARLY",
  };

  it("accepts a lab e-mail at its own domain and normalises the CNPJ", () => {
    const parsed = SelfServeSignupSchema.parse(valid);

    expect(parsed.email).toBe("carla@laboratorio-exemplo.com.br");
    expect(parsed.cnpj).toBe("11222333000181");
    expect(parsed.website).toBe("");
  });

  it("refuses a free-provider address with the shared policy message", () => {
    const result = SelfServeSignupSchema.safeParse({
      ...valid,
      email: "carla@gmail.com",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join(" ");
      expect(message).toContain("domínio do seu laboratório");
    }
    // And the policy the API re-checks agrees with the schema.
    expect(checkSignupEmail("carla@gmail.com").ok).toBe(false);
  });

  it("refuses an invalid CNPJ, because billing cannot be created without one", () => {
    const result = SelfServeSignupSchema.safeParse({
      ...valid,
      cnpj: "11.222.333/0001-00",
    });

    expect(result.success).toBe(false);
  });

  it("only admits paid plans a lab may contract by itself", () => {
    expect(
      SelfServeSignupSchema.safeParse({ ...valid, planId: "ENTERPRISE" })
        .success,
    ).toBe(false);
    expect(
      SelfServeSignupSchema.safeParse({ ...valid, planId: "FREE" }).success,
    ).toBe(false);
  });

  it("defaults to the annual cycle on the entry plan", () => {
    const parsed = SelfServeSignupSchema.parse({
      name: valid.name,
      email: valid.email,
      labName: valid.labName,
      cnpj: valid.cnpj,
    });

    expect(parsed.planId).toBe("STANDARD");
    expect(parsed.billingCycle).toBe("YEARLY");
  });
});
