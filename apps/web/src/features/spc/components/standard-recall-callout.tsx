import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'

import { Panel } from '@/components/instrument-panel'

/**
 * §7.10 tie-in: an out-of-control chart (or unsatisfactory PT) suggests the
 * reference standard may have issued out-of-tolerance results. Points to the
 * standard detail page, where the reverse-traceability recall panel lives.
 */
export function StandardRecallCallout({
  standardId,
  standardName,
  message,
}: {
  standardId: number
  standardName: string | null
  message: string
}) {
  return (
    <Panel className="border-l-4 border-l-amber-500 p-4">
      <div className="flex items-start gap-3">
        <HugeiconsIcon
          icon={Alert02Icon}
          className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            Validade dos resultados em risco
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {message}{' '}
            <Link
              to="/dashboard/standards/$id"
              params={{ id: String(standardId) }}
              className="font-medium text-primary hover:underline"
            >
              Abrir {standardName ?? `padrão #${standardId}`}
            </Link>
          </p>
        </div>
      </div>
    </Panel>
  )
}
