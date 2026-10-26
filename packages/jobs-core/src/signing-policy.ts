/**
 * Signing policy for certificate emission (#644 / CMP-01, P0-8).
 *
 * Failure classes:
 * - Certificate CONFIGURED but signing fails => ALWAYS fail the job (REJECTED),
 *   never silently emit unsigned. (Handled at the sign call site — any error
 *   after a certificate was found is rethrown, not swallowed.)
 * - The unit HAS EVER HAD a signing certificate (any row: expired, revoked,
 *   deactivated) and none is currently valid => ALWAYS fail (P0-8, Q44): an
 *   expired A1 must not look like "no certificate" and quietly degrade to
 *   unsigned PDFs for a lab that signs its certificates. `code:
 *   "SIGNING_CERTIFICATE_LAPSED"` lets the caller alert the lab's admins.
 * - A unit that NEVER had a certificate is governed by the per-unit
 *   `organization_unit.require_signature` flag: false (default) emits unsigned
 *   with the visible UNSIGNED verdict; true fails with a named reason.
 */

export type SigningPolicyDecision =
  | { action: "SIGN" }
  | { action: "EMIT_UNSIGNED"; warning: string }
  | {
      action: "FAIL";
      reason: string;
      /** Set when the unit signed before and cannot now: the lab's admins must be told. */
      code?: "SIGNING_CERTIFICATE_LAPSED";
    };

export function resolveSigningPolicy(input: {
  /** Platform SIGNING_MASTER_KEY present. */
  hasMasterKey: boolean;
  /** Unit has an active, valid, default signing certificate. */
  hasCertificate: boolean;
  /**
   * The unit has ever had a signing certificate: any row of
   * `organization_signing_certificate`, expired and revoked ones included.
   */
  hadCertificate: boolean;
  /** pt-BR phrase for why the last certificate is unusable ("expirou em 12/03/2026"). */
  lapse?: string;
  /** organization_unit.require_signature. */
  requireSignature: boolean;
}): SigningPolicyDecision {
  const { hasMasterKey, hasCertificate, hadCertificate, requireSignature } =
    input;

  if (hasCertificate && hasMasterKey) return { action: "SIGN" };

  // A unit that signed before never falls back to unsigned: the platform key
  // missing or the certificate lapsed is a failure to fix, not a configuration
  // to run without.
  if (hadCertificate) {
    return {
      action: "FAIL",
      code: "SIGNING_CERTIFICATE_LAPSED",
      reason: !hasMasterKey
        ? "Certificado de assinatura indisponível: a chave de assinatura da plataforma não está configurada. A emissão sem assinatura foi bloqueada."
        : `Certificado de assinatura expirado/ausente${input.lapse ? ` (${input.lapse})` : ""}: esta unidade já teve certificado de assinatura e nenhum está válido. A emissão sem assinatura foi bloqueada; envie um novo certificado A1 ICP-Brasil em Configurações > Assinatura.`,
    };
  }

  if (!hasMasterKey) {
    return requireSignature
      ? {
          action: "FAIL",
          reason:
            "Assinatura obrigatória para esta unidade: chave de assinatura da plataforma não configurada.",
        }
      : {
          action: "EMIT_UNSIGNED",
          warning: "SIGNING_MASTER_KEY not set — emitting unsigned",
        };
  }

  return requireSignature
    ? {
        action: "FAIL",
        reason:
          "Assinatura obrigatória para esta unidade: nenhum certificado de assinatura ativo configurado.",
      }
    : {
        action: "EMIT_UNSIGNED",
        warning: "No signing certificate configured — emitting unsigned",
      };
}

/**
 * Named error for signing failures that must fail the emission (both classes
 * above). The job processor's catch converts it into setJobError => REJECTED
 * with this message as rejection_reason.
 */
export class SigningPolicyError extends Error {
  /**
   * True when retrying cannot help (the unit's policy refuses to emit). False
   * for a signing attempt that failed and might succeed on redelivery.
   */
  readonly permanent: boolean;

  constructor(message: string, options: { permanent?: boolean } = {}) {
    super(message);
    this.name = "SigningPolicyError";
    this.permanent = options.permanent ?? true;
  }
}
