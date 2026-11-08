import { loadWorkerConfig, readAuthConfig } from "@calibra-facil/config";
import type { Env } from "@calibra-facil/jobs-core";
import { createJobsEnv } from "@calibra-facil/jobs-core/runtime-env";

/**
 * The handlers' `Env` (owned by jobs-core) plus what only the API's in-process
 * work reads: the Conta Azul application and the quote approval-code pepper.
 */
export type WorkerRuntimeEnv = Env & {
  // Conta Azul syncs run with this environment and may refresh a token with
  // the server-supplied application (laboratories' own come from the database).
  API_URL?: string;
  CONTA_AZUL_CLIENT_ID?: string;
  CONTA_AZUL_CLIENT_SECRET?: string;
  CONTA_AZUL_OAUTH_REDIRECT_URI?: string;
  // Pepper for public quote approval-code HMACs.
  QUOTE_APPROVAL_CODE_PEPPER?: string;
};

/**
 * The worker's environment for the work that runs in the API process (the cron
 * handlers, the development `local` runner). It cannot do any work without its
 * database, storage and keys, so a missing one throws one aggregated error.
 * The shared part is `createJobsEnv`, the one mapping the always-on worker uses.
 */
export function createWorkerRuntimeEnv(): WorkerRuntimeEnv {
  const config = loadWorkerConfig();

  return {
    ...createJobsEnv(config),
    API_URL: config.origins.apiUrl,
    CONTA_AZUL_CLIENT_ID: config.integrations.contaAzulClientId,
    CONTA_AZUL_CLIENT_SECRET: config.integrations.contaAzulClientSecret,
    CONTA_AZUL_OAUTH_REDIRECT_URI:
      config.integrations.contaAzulOauthRedirectUri,
    QUOTE_APPROVAL_CODE_PEPPER: readAuthConfig().quoteApprovalCodePepper,
  };
}
