import type { JobAction, JobAllowedActions } from '@calibra-facil/contracts'

/**
 * Whether the signed-in member may take `action` on the job (roadmap 2 F1).
 * The cloud API decides it (status machine, permission, separation of duties,
 * certificate lifecycle) and sends `allowedActions`; the desktop local server
 * does not, so its jobs keep the status rule the screen applied before.
 */
export function serverAllows(
  allowedActions: JobAllowedActions | undefined,
  action: JobAction,
  fallback: boolean,
): boolean {
  const verdict = allowedActions?.[action]
  return verdict ? verdict.allowed : fallback
}

/** The pt-BR reason an approval is refused for this member, when it is. */
export function approvalBlockedMessage(
  allowedActions: JobAllowedActions | undefined,
): string | null {
  const verdict = allowedActions?.approve
  if (!verdict || verdict.allowed) return null
  if (verdict.reason === 'self_approval') {
    return 'Você executou, criou ou enviou este trabalho para revisão: outro aprovador deve liberar o certificado.'
  }
  if (verdict.reason === 'permission') {
    return 'Seu papel não permite aprovar certificados.'
  }
  return null
}
