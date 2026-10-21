import { describe, expect, it } from "vitest";

import {
  SoftDeleteOrganizationSchema,
  confirmationMatchesOrganizationName,
} from "./organization-lifecycle";

describe("SoftDeleteOrganizationSchema", () => {
  it("REQ-RET-3: accepts a reason and the typed confirmation, trimmed", () => {
    const parsed = SoftDeleteOrganizationSchema.parse({
      confirmName: "  Laboratório Exemplo ",
      reason: "  Encerramento das atividades do laboratório ",
    });
    expect(parsed).toEqual({
      confirmName: "Laboratório Exemplo",
      reason: "Encerramento das atividades do laboratório",
    });
  });

  it("REQ-RET-3: a reason is required and must say something", () => {
    for (const reason of [undefined, "", "   ", "curto"]) {
      expect(
        SoftDeleteOrganizationSchema.safeParse({
          confirmName: "Lab",
          reason,
        }).success,
        String(reason),
      ).toBe(false);
    }
  });

  it("REQ-RET-3: the typed confirmation is required", () => {
    expect(
      SoftDeleteOrganizationSchema.safeParse({
        reason: "Encerramento das atividades",
      }).success,
    ).toBe(false);
    expect(
      SoftDeleteOrganizationSchema.safeParse({
        confirmName: "  ",
        reason: "Encerramento das atividades",
      }).success,
    ).toBe(false);
  });
});

describe("confirmationMatchesOrganizationName", () => {
  it("REQ-RET-3: matches the organization name exactly, ignoring surrounding spaces only", () => {
    expect(
      confirmationMatchesOrganizationName(" Lab Exemplo ", "Lab Exemplo"),
    ).toBe(true);
    expect(
      confirmationMatchesOrganizationName("lab exemplo", "Lab Exemplo"),
    ).toBe(false);
    expect(confirmationMatchesOrganizationName("Lab", "Lab Exemplo")).toBe(
      false,
    );
  });
});
