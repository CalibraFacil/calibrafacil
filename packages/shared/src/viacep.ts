/**
 * ViaCEP (https://viacep.com.br): the public CEP lookup behind the address
 * autofill in the lab app's customer form and the portal's on-site request
 * form. The URL, the response schema and the mapping onto an {@link Address}
 * live here once; each app owns only how it fetches and shows the result.
 */
import { z } from "zod";

import type { Address } from "./address";

/** The CEP's eight digits, with any mask or spacing removed. */
export function getCepDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Lookup URL for a CEP (digits are extracted first). */
export function viaCepUrl(cep: string): string {
  return `https://viacep.com.br/ws/${getCepDigits(cep)}/json/`;
}

/**
 * ViaCEP's answer (the fields the autofill reads). An unknown CEP answers
 * `{ "erro": true }` and, on some deployments, `{ "erro": "true" }`.
 */
export const ViaCepResponseSchema = z.looseObject({
  cep: z.string().optional(),
  logradouro: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  localidade: z.string().optional(),
  uf: z.string().optional(),
  erro: z.union([z.boolean(), z.string()]).optional(),
});

export type ViaCepResponse = z.infer<typeof ViaCepResponseSchema>;

/** What a CEP resolves to: the address parts ViaCEP knows. */
export type ViaCepAddress = Required<
  Pick<Address, "cep" | "street" | "neighbourhood" | "city" | "state">
>;

/** The resolved address, or null when ViaCEP does not know the CEP. */
export function mapViaCepResponse(
  response: ViaCepResponse,
): ViaCepAddress | null {
  if (response.erro === true || response.erro === "true") {
    return null;
  }

  return {
    cep: response.cep ?? "",
    street: response.logradouro ?? "",
    neighbourhood: response.bairro ?? "",
    city: response.localidade ?? "",
    state: response.uf ?? "",
  };
}

/**
 * The current address with the parts ViaCEP resolved written over it (street,
 * neighbourhood, city and state are replaced even when blank: a new CEP is a
 * new address; the CEP keeps the masked form ViaCEP answers with).
 */
export function mergeViaCepAddress<TAddress extends Address>(
  currentAddress: TAddress,
  viaCepAddress: ViaCepAddress,
): TAddress {
  return Object.assign({}, currentAddress, {
    cep: viaCepAddress.cep || currentAddress.cep,
    street: viaCepAddress.street,
    neighbourhood: viaCepAddress.neighbourhood,
    city: viaCepAddress.city,
    state: viaCepAddress.state,
  });
}
