import { createHash } from "node:crypto";
import { decryptPassword, encryptPassword } from "@calibra-facil/signing";
import {
  type IntegrationMappingsConfig,
  normalizeGenericFinancialErpConfig,
  type GenericFinancialErpConnectionConfig,
} from "@calibra-facil/shared";
import type { IntegrationsEnv } from "../../lib/integrations-env";
import { type IntegrationSyncPayload } from "./types";
import { stableJson } from "./utils";

export function createIntegrationPayloadFingerprint(
  payload: IntegrationSyncPayload,
) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function getMasterKey(env: IntegrationsEnv) {
  if (!env.INTEGRATIONS_MASTER_KEY) {
    throw new Error("INTEGRATIONS_MASTER_KEY não configurada");
  }

  return env.INTEGRATIONS_MASTER_KEY;
}

export function encryptIntegrationSecret(secret: string, env: IntegrationsEnv) {
  const { encryptedPassword, iv } = encryptPassword(secret, getMasterKey(env));
  return { encryptedSecret: encryptedPassword, secretIv: iv };
}

export function decryptIntegrationSecret(
  encryptedSecret: string,
  secretIv: string,
  env: IntegrationsEnv,
) {
  return decryptPassword(encryptedSecret, secretIv, getMasterKey(env));
}

export function buildGenericConnectionConfig(input: {
  baseUrl: string;
  healthPath?: string;
  customerPath?: string;
  serviceOrderPath?: string;
  billingDocumentPath?: string;
  schedules?: GenericFinancialErpConnectionConfig["schedules"];
  mappings?: Partial<IntegrationMappingsConfig>;
}) {
  return normalizeGenericFinancialErpConfig(input);
}
