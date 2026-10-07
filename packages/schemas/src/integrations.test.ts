import { describe, expect, it } from "vitest";

import { ContaAzulAppCredentialsSchema } from "./integrations";

describe("ContaAzulAppCredentialsSchema", () => {
  it("trims both values", () => {
    expect(
      ContaAzulAppCredentialsSchema.parse({
        clientId: "  4mh1k2client  ",
        clientSecret: "\tsecret-value\n",
      }),
    ).toEqual({ clientId: "4mh1k2client", clientSecret: "secret-value" });
  });

  it("asks for each missing value", () => {
    const result = ContaAzulAppCredentialsSchema.safeParse({
      clientId: " ",
      clientSecret: "",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Informe o Client ID.",
      "Informe o Client Secret.",
    ]);
  });

  it("refuses values with spaces inside, a sign of a bad copy", () => {
    const result = ContaAzulAppCredentialsSchema.safeParse({
      clientId: "client id",
      clientSecret: "secret",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "O Client ID não tem espaços.",
    );
  });

  it("caps the lengths", () => {
    expect(
      ContaAzulAppCredentialsSchema.safeParse({
        clientId: "c".repeat(201),
        clientSecret: "s".repeat(501),
      }).success,
    ).toBe(false);
  });
});
