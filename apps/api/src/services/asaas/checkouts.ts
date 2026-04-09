import { getAsaasClient } from "./client";
import type { AsaasCheckout, CreateCheckoutInput } from "./types";

export async function createCheckout(
  input: CreateCheckoutInput,
): Promise<AsaasCheckout> {
  const client = getAsaasClient();
  return client.post<AsaasCheckout>("/checkouts", input);
}

export async function getCheckout(checkoutId: string): Promise<AsaasCheckout> {
  const client = getAsaasClient();
  return client.get<AsaasCheckout>(`/checkouts/${checkoutId}`);
}

export async function cancelCheckout(
  checkoutId: string,
): Promise<AsaasCheckout> {
  const client = getAsaasClient();
  return client.delete<AsaasCheckout>(`/checkouts/${checkoutId}`);
}
