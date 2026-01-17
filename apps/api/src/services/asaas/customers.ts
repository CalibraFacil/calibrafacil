import { getAsaasClient } from "./client";
import type { AsaasCustomer, CreateCustomerInput } from "./types";

// =============================================================================
// CUSTOMER SERVICE
// =============================================================================

/**
 * Create a new customer in Asaas
 */
export async function createCustomer(
  input: CreateCustomerInput,
): Promise<AsaasCustomer> {
  const client = getAsaasClient();
  return client.post<AsaasCustomer>("/customers", input);
}

/**
 * Get a customer by ID
 */
export async function getCustomer(customerId: string): Promise<AsaasCustomer> {
  const client = getAsaasClient();
  return client.get<AsaasCustomer>(`/customers/${customerId}`);
}

/**
 * Update a customer
 */
export async function updateCustomer(
  customerId: string,
  input: Partial<CreateCustomerInput>,
): Promise<AsaasCustomer> {
  const client = getAsaasClient();
  return client.put<AsaasCustomer>(`/customers/${customerId}`, input);
}

/**
 * Find customer by CPF/CNPJ
 */
export async function findCustomerByCpfCnpj(
  cpfCnpj: string,
): Promise<AsaasCustomer | null> {
  const client = getAsaasClient();
  const response = await client.get<{
    object: "list";
    data: AsaasCustomer[];
  }>("/customers", { cpfCnpj });

  return response.data[0] ?? null;
}

/**
 * Find customer by external reference (organization ID)
 */
export async function findCustomerByExternalReference(
  externalReference: string,
): Promise<AsaasCustomer | null> {
  const client = getAsaasClient();
  const response = await client.get<{
    object: "list";
    data: AsaasCustomer[];
  }>("/customers", { externalReference });

  return response.data[0] ?? null;
}

/**
 * Delete a customer (only if no charges)
 */
export async function deleteCustomer(customerId: string): Promise<void> {
  const client = getAsaasClient();
  await client.delete(`/customers/${customerId}`);
}
