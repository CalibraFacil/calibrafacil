/**
 * Validation of a signing credential (P12) at upload (roadmap 2 B4a, REQ-B4A-3).
 *
 * Before this, only the expiry was checked: a certificate that is not valid yet,
 * that may not sign, or whose chain does not reach an ICP-Brasil root was stored
 * and only failed at the first certificate issuance. Every rejection carries a
 * stable `code` and a pt-BR message the route returns with a 422.
 *
 * The trust store is the bundled ICP-Brasil set (`trust-store/`, the ITI AC-Raiz
 * bundle). `SIGNING_TRUST_STORE_FILE` points at a PEM bundle that REPLACES it:
 * homologation roots, a private test CA, or an updated ITI bundle.
 */
import { readFileSync } from "node:fs";
import { formatInstant } from "@calibra-facil/shared/format";
import type * as pkijs from "pkijs";

import {
  getIcpBrasilTrustAnchors,
  parsePemCertificates,
  validateCertificateChain,
} from "./chain-validation.js";
import type { CertificateInfo } from "./types.js";

export type CredentialRejectionCode =
  | "CERTIFICATE_EXPIRED"
  | "CERTIFICATE_NOT_YET_VALID"
  | "INVALID_KEY_USAGE"
  | "INVALID_CHAIN"
  | "TRUST_STORE_UNAVAILABLE";

export type CredentialValidationResult =
  | { ok: true }
  | { ok: false; code: CredentialRejectionCode; message: string };

export interface CredentialValidationOptions {
  trustAnchors: pkijs.Certificate[];
  /** Validation instant (default: now). */
  now?: Date;
}

function brDate(value: Date): string {
  return formatInstant(value, "date");
}

/**
 * Key usage of the end-entity certificate. A certificate that may neither make a
 * digital signature nor commit to content (nonRepudiation / contentCommitment,
 * the MP 2.200-2 usage) cannot sign a certificate PDF, and a certificate with
 * no key usage extension is not an ICP-Brasil signing certificate.
 */
function maySign(certificate: CertificateInfo["certificate"]): boolean {
  const usage: unknown = certificate.getExtension("keyUsage");
  if (typeof usage !== "object" || usage === null) return false;
  const flag = (name: string): boolean =>
    name in usage && Reflect.get(usage, name) === true;
  return flag("digitalSignature") || flag("nonRepudiation");
}

export async function validateSigningCredential(
  info: CertificateInfo,
  options: CredentialValidationOptions,
): Promise<CredentialValidationResult> {
  const now = options.now ?? new Date();

  if (info.validUntil < now) {
    return {
      ok: false,
      code: "CERTIFICATE_EXPIRED",
      message: `Certificado expirado em ${brDate(info.validUntil)}`,
    };
  }
  if (info.validFrom > now) {
    return {
      ok: false,
      code: "CERTIFICATE_NOT_YET_VALID",
      message: `Certificado ainda não é válido: vigência a partir de ${brDate(info.validFrom)}`,
    };
  }
  if (!maySign(info.certificate)) {
    return {
      ok: false,
      code: "INVALID_KEY_USAGE",
      message:
        "O certificado não permite assinatura: falta o uso de chave de assinatura digital (digitalSignature) ou de não repúdio (nonRepudiation)",
    };
  }
  if (options.trustAnchors.length === 0) {
    return {
      ok: false,
      code: "TRUST_STORE_UNAVAILABLE",
      message:
        "A cadeia de confiança ICP-Brasil não está disponível neste servidor; o certificado não pode ser validado",
    };
  }

  const chain = await validateCertificateChain(info.certificate, {
    trustAnchors: options.trustAnchors,
    intermediates: info.chain,
    checkDate: now,
  });
  if (!chain.valid) {
    return {
      ok: false,
      code: "INVALID_CHAIN",
      message:
        "A cadeia de certificação não é confiável: o certificado não encadeia a uma AC-Raiz da cadeia de confiança configurada (ICP-Brasil)",
    };
  }
  return { ok: true };
}

export interface TrustStoreEnv {
  SIGNING_TRUST_STORE_FILE?: string | undefined;
}

/**
 * The trust anchors uploads are validated against: the PEM bundle at
 * `SIGNING_TRUST_STORE_FILE` when set (it replaces the bundled roots), else the
 * bundled ICP-Brasil set. A configured file that cannot be read or holds no
 * certificate is an error: it never degrades into "trust nothing" or "trust the
 * default" silently.
 */
export function resolveSigningTrustAnchors(
  env: TrustStoreEnv,
): pkijs.Certificate[] {
  const file = env.SIGNING_TRUST_STORE_FILE?.trim();
  if (!file) return getIcpBrasilTrustAnchors();
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(
      `SIGNING_TRUST_STORE_FILE (${file}) cannot be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  const anchors = parsePemCertificates(content);
  if (anchors.length === 0) {
    throw new Error(
      `SIGNING_TRUST_STORE_FILE (${file}) holds no PEM certificate`,
    );
  }
  return anchors;
}
