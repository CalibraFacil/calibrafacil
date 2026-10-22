import { type R2Env } from "../../lib/storage";
import { type ApiKeyAuthVariables } from "../../middleware/api-key-auth";

export type PublicApiV2Env = {
  Variables: ApiKeyAuthVariables;
  Bindings: R2Env & {
    PUBLIC_API_MASTER_KEY?: string;
    INTEGRATIONS_MASTER_KEY?: string;
  };
};
