/**
 * RFC 3161 TSA configuration from worker env (#646 / CMP-03, PAdES-T).
 *
 * - `SIGNING_TSA_URL` — the TSA endpoint. Unset => plain AD-RB signing
 *   (pre-#646 behavior, byte-identical).
 * - `SIGNING_TSA_AUTH` — optional full `Authorization` header value for a
 *   contracted ACT (e.g. `Basic …` for BRy credentials, `Bearer …` for
 *   Serpro's OAuth2 wrapper). Secret.
 * - `SIGNING_TSA_ICP_CONFORMANT` — "true" ONLY when the endpoint is a
 *   credentialed ICP-Brasil ACT. Anything else (incl. unset) records the
 *   honest `icpBrasilConformant: false` on the signature metadata, so a
 *   generic TSA (dev/preview) never masquerades as legally conformant.
 *
 * When a TSA is configured, stamping is FAIL-CLOSED (REQ-CMP-LTV-003): a TSA
 * failure fails the whole certificate job rather than silently emitting an
 * unstamped (or unsigned) PDF.
 */
import type { TimestampConfig } from "@calibra-facil/signing";

export interface TsaEnv {
  SIGNING_TSA_URL?: string;
  SIGNING_TSA_AUTH?: string;
  SIGNING_TSA_ICP_CONFORMANT?: string;
}

export function resolveTsaConfig(env: TsaEnv): TimestampConfig | null {
  const tsaUrl = env.SIGNING_TSA_URL?.trim();
  if (!tsaUrl) return null;

  const auth = env.SIGNING_TSA_AUTH?.trim();

  return {
    tsaUrl,
    ...(auth ? { headers: { Authorization: auth } } : {}),
    icpBrasilConformant: env.SIGNING_TSA_ICP_CONFORMANT?.trim() === "true",
    reason: "Carimbo do tempo - Certificado de Calibracao",
    location: "Brasil",
  };
}
