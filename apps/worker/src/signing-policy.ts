/**
 * Signing policy for certificate emission (#644 / CMP-01).
 *
 * Two failure classes, decided by Pedro 2026-07-05:
 * - Certificate CONFIGURED but signing fails => ALWAYS fail the job (REJECTED),
 *   never silently emit unsigned. (Handled at the sign call site — any error
 *   after a certificate was found is rethrown, not swallowed.)
 * - Certificate NOT configured => governed by the per-unit
 *   `organization_unit.require_signature` flag: false (default) emits unsigned
 *   with the visible UNSIGNED verdict; true fails with a named reason.
 */

export type SigningPolicyDecision =
  | { action: "SIGN" }
  | { action: "EMIT_UNSIGNED"; warning: string }
  | { action: "FAIL"; reason: string };

export function resolveSigningPolicy(input: {
  /** Platform SIGNING_MASTER_KEY present. */
  hasMasterKey: boolean;
  /** Unit has an active, valid, default signing certificate. */
  hasCertificate: boolean;
  /** organization_unit.require_signature. */
  requireSignature: boolean;
}): SigningPolicyDecision {
  const { hasMasterKey, hasCertificate, requireSignature } = input;

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

  if (!hasCertificate) {
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

  return { action: "SIGN" };
}

/**
 * Named error for signing failures that must fail the emission (both classes
 * above). The job processor's catch converts it into setJobError => REJECTED
 * with this message as rejection_reason.
 */
export class SigningPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SigningPolicyError";
  }
}
