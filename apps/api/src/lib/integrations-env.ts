/**
 * The environment bindings the integrations layer reads. Lives apart from
 * `integrations.ts` so `finance.ts` can name it without importing the module
 * that imports `finance.ts` back (an import cycle); `integrations.ts`
 * re-exports it, so existing importers are unaffected.
 */
export interface IntegrationsEnv {
  API_URL?: string;
  APP_URL?: string;
  INTEGRATIONS_MASTER_KEY?: string;
  CONTA_AZUL_CLIENT_ID?: string;
  CONTA_AZUL_CLIENT_SECRET?: string;
  CONTA_AZUL_OAUTH_REDIRECT_URI?: string;
}
