import { describe, expect, it } from "vitest";
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
} from "@calibra-facil/schemas";

describe("customer schemas", () => {
  it("accepts address complement when creating a customer", () => {
    const result = CreateCustomerSchema.safeParse({
      name: "Cliente Exemplo",
      address: {
        cep: "01001-000",
        street: "Praça da Sé",
        number: "123",
        complement: "Sala 4",
        neighbourhood: "Sé",
        city: "São Paulo",
        state: "SP",
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.address?.complement).toBe("Sala 4");
    }
  });

  it("accepts address complement when updating a customer", () => {
    const result = UpdateCustomerSchema.safeParse({
      address: {
        complement: "Bloco B",
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.address?.complement).toBe("Bloco B");
    }
  });
});
