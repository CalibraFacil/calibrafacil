import { getAsaasClient } from "./client";
import type { AsaasPayment, AsaasPaymentList, CreatePaymentInput } from "./types";

export async function createPayment(
  input: CreatePaymentInput,
): Promise<AsaasPayment> {
  const client = getAsaasClient();
  return client.post<AsaasPayment>("/payments", input);
}

export async function getPayment(paymentId: string): Promise<AsaasPayment> {
  const client = getAsaasClient();
  return client.get<AsaasPayment>(`/payments/${paymentId}`);
}

export async function listPayments(options?: {
  customer?: string;
  subscription?: string;
  status?: string;
  billingType?: string;
  offset?: number;
  limit?: number;
}): Promise<AsaasPaymentList> {
  const client = getAsaasClient();
  return client.get<AsaasPaymentList>("/payments", options);
}

export async function cancelPayment(paymentId: string): Promise<AsaasPayment> {
  const client = getAsaasClient();
  return client.delete<AsaasPayment>(`/payments/${paymentId}`);
}
