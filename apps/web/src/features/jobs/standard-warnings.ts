import type { JobExecutionWarning } from '@calibra-facil/contracts'

const REASON_LABELS = {
  standard_expired: 'certificado vencido',
  standard_inactive: 'padrão inativo',
  standard_deleted: 'padrão excluído',
} satisfies Record<JobExecutionWarning['reason'], string>

export type StandardWarningItem = {
  standardId: number
  name: string
  /** The pt-BR line shown to the technician. */
  message: string
}

/**
 * The warnings a draft save answers (P1-11), one item per stale standard: a
 * standard the job already carries is no longer valid. The save went through;
 * the submit will refuse until the standard is replaced. Only standards still
 * selected are listed, so a standard the technician already removed stops
 * warning.
 */
export function standardWarningItems(
  warnings: readonly JobExecutionWarning[] | undefined,
  selectedStandardIds: readonly number[],
): StandardWarningItem[] {
  const selected = new Set(selectedStandardIds)
  const items: StandardWarningItem[] = []
  for (const warning of warnings ?? []) {
    warning.standardIds.forEach((standardId, index) => {
      if (!selected.has(standardId)) return
      const name = warning.standardNames[index] ?? `#${standardId}`
      items.push({
        standardId,
        name,
        message: `Padrão ${name} não está mais válido (${REASON_LABELS[warning.reason]}); a submissão será bloqueada até substituí-lo.`,
      })
    })
  }
  return items
}
