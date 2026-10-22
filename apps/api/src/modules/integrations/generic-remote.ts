import { type GenericFinancialErpConnectionConfig } from "@calibra-facil/shared";
import { createFinancialErpAdapter } from "../../lib/financial-erp-adapters";
import { toRecord } from "./utils";

export function buildAuthHeaders(secret: string) {
  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
}

export async function callRemoteJson(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") ?? "";

  let data: unknown = null;
  if (contentType.includes("application/json")) {
    data = await response.json().catch(() => null);
  } else {
    data = await response.text().catch(() => null);
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export function extractRemoteId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const record = toRecord(data);
  if (typeof record.remoteId === "string" && record.remoteId.trim()) {
    return record.remoteId;
  }
  if (typeof record.id === "string" && record.id.trim()) {
    return record.id;
  }
  if (typeof record.id === "number") {
    return String(record.id);
  }

  return null;
}

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
