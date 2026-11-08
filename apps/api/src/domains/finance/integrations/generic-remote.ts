import { type GenericFinancialErpConnectionConfig } from "@calibra-facil/shared";
import { createFinancialErpAdapter } from "./financial-erp-adapters";

export async function validateGenericConnection(
  config: GenericFinancialErpConnectionConfig,
  secret: string,
) {
  return createFinancialErpAdapter({
    provider: "generic_http",
    integrationId: "validation",
    organizationId: "validation",
    config,
    secret,
  }).validateConnection();
}
