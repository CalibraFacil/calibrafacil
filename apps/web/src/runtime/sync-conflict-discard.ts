import type { LocalSyncConflict } from '@calibra-facil/contracts'

/**
 * How the desktop presents what the user decides on a sync conflict.
 *
 * "Manter nuvem" used to mean "ignore": the local change was marked as sent although the cloud
 * never received it. It is now a discard: the change is given up on purpose, recorded with who
 * decided, when and why, kept for audit, and never sent. The wording says what it does.
 */

const STATUS_LABELS: Record<LocalSyncConflict['status'], string> = {
  open: 'Aberto',
  resolved: 'Mantida a alteração local',
  discarded_by_user: 'Descartado pelo usuário',
  // What older builds called the same decision.
  ignored: 'Ignorado (versão anterior)',
}

export function conflictStatusLabel(status: LocalSyncConflict['status']) {
  return STATUS_LABELS[status]
}

export type ConflictDiscardPrompt = {
  title: string
  description: string
  confirmLabel: string
  /** The change carries calibration readings: a written reason is required. */
  reasonRequired: boolean
  reasonLabel: string
}

export function getConflictDiscardPrompt(conflict: {
  regulated: boolean
}): ConflictDiscardPrompt {
  if (conflict.regulated) {
    return {
      title: 'Descartar as leituras desta calibração?',
      description:
        'As leituras ficam salvas somente neste computador e não serão enviadas à nuvem: a calibração seguirá com o que já está lá. O descarte fica registrado com seu nome, a data e o motivo, e a alteração nunca será reenviada.',
      confirmLabel: 'Descartar leituras',
      reasonRequired: true,
      reasonLabel: 'Motivo do descarte (obrigatório)',
    }
  }

  return {
    title: 'Descartar sua alteração local?',
    description:
      'A versão da nuvem é mantida e esta alteração sai da fila: ela não será reenviada. O descarte fica registrado com seu nome e a data.',
    confirmLabel: 'Descartar alteração',
    reasonRequired: false,
    reasonLabel: 'Motivo do descarte (opcional)',
  }
}

/** The message to show when the reason is not acceptable, or null when it is. */
export function validateDiscardReason(
  reason: string,
  required: boolean,
): string | null {
  if (required && reason.trim().length < 5) {
    return 'Informe o motivo do descarte (mínimo de 5 caracteres).'
  }
  if (reason.trim().length > 2000) {
    return 'O motivo pode ter no máximo 2000 caracteres.'
  }
  return null
}
